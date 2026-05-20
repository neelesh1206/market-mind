-- ============================================================================
-- Thumbs feedback on MarketMind verdicts.
--
-- One vote per (user, marketmind_prediction). Re-submitting overwrites the
-- previous vote so users can change their mind. Comment is optional.
--
-- This is feedback on the VERDICT (the model's call), not on the bet
-- outcome — users can vote any time they look at a stock, before or after
-- resolution. The intended question is "did this verdict help you think
-- about this stock?", not "was the model right" (the outcome itself
-- answers that).
--
-- Why a separate table from `predictions`:
--   - `predictions` is user *bets* (stake + direction); feedback is meta
--   - Tracks even users who didn't bet
--   - Decouples accuracy tracking from product-quality signal
--
-- Display contract: aggregate counts are public-read (so anon visitors
-- to /stock/[ticker] see "9 of 13 users found this helpful"). The
-- per-user vote is read via the user's own session.
-- ============================================================================

create table public.prediction_feedback (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  marketmind_prediction_id uuid not null references public.marketmind_predictions(id) on delete cascade,
  helpful                  boolean not null,
  comment                  text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (user_id, marketmind_prediction_id)
);

create index prediction_feedback_prediction_idx
  on public.prediction_feedback (marketmind_prediction_id);

create index prediction_feedback_user_idx
  on public.prediction_feedback (user_id, created_at desc);

-- RLS: users see only their own rows. Aggregate counts go through the
-- SECURITY DEFINER `get_feedback_summary` function below.
alter table public.prediction_feedback enable row level security;

create policy "prediction_feedback_own_select"
  on public.prediction_feedback
  for select using (auth.uid() = user_id);

-- Writes go through the RPC (which validates auth + enforces the upsert).
-- Direct INSERT/UPDATE/DELETE are not exposed to clients.

-- ============================================================================
-- submit_prediction_feedback RPC — idempotent upsert.
--
-- Re-calling with a different `helpful` value flips the user's vote;
-- timestamps reflect last-modified. Passing the same value is a no-op
-- (`updated_at` still bumps, harmless).
--
-- Errors:
--   not_authenticated  - no auth.uid()
--   verdict_missing    - the prediction id doesn't exist (or RLS hides it)
-- ============================================================================

create or replace function public.submit_prediction_feedback(
  p_prediction_id uuid,
  p_helpful       boolean,
  p_comment       text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Confirm the verdict actually exists. Public-readable via ADR 0007,
  -- so no RLS guard needed; this is just a friendly error rather than
  -- a foreign-key violation that surfaces as "23503" in the client.
  if not exists (select 1 from public.marketmind_predictions where id = p_prediction_id) then
    raise exception 'verdict_missing' using errcode = 'P0001';
  end if;

  insert into public.prediction_feedback (
    user_id, marketmind_prediction_id, helpful, comment, updated_at
  ) values (
    v_user_id, p_prediction_id, p_helpful, nullif(trim(p_comment), ''), now()
  )
  on conflict (user_id, marketmind_prediction_id) do update
    set helpful = excluded.helpful,
        comment = excluded.comment,
        updated_at = now();
end;
$$;

-- ============================================================================
-- get_feedback_summary RPC — public aggregate count.
--
-- Returns (helpful_count, total_count) for one verdict. SECURITY DEFINER
-- so it can see rows across users despite the own-only RLS policy above.
-- Returns zeros (not null) when there's no feedback yet, so callers can
-- render a "Be the first to weigh in" affordance.
-- ============================================================================

create or replace function public.get_feedback_summary(
  p_prediction_id uuid
)
returns table (
  helpful_count integer,
  total_count   integer
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    coalesce(count(*) filter (where helpful), 0)::integer as helpful_count,
    coalesce(count(*), 0)::integer as total_count
  from public.prediction_feedback
  where marketmind_prediction_id = p_prediction_id;
$$;

-- Allow anon + authenticated to call both functions.
grant execute on function public.submit_prediction_feedback(uuid, boolean, text) to authenticated;
grant execute on function public.get_feedback_summary(uuid) to anon, authenticated;
