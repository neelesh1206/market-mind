-- ============================================================================
-- revealed_at column + mark_predictions_revealed RPC.
--
-- Tracks whether the user has seen the reveal animation for a resolved bet.
-- See ADR 0010 for why this lives in Postgres (durable user state) rather
-- than Redis (ephemeral cache) or localStorage (no cross-device).
--
-- The index is partial — only rows we'd actually need to look up (resolved
-- but unrevealed). On a 100k-row predictions table, that's a tiny fraction.
-- ============================================================================

alter table public.predictions
  add column if not exists revealed_at timestamptz;

create index if not exists predictions_unrevealed_idx
  on public.predictions (user_id, prediction_date desc)
  where resolved and revealed_at is null;

comment on column public.predictions.revealed_at is
  'When the user first saw the resolution reveal animation. NULL until viewed.';

-- ----------------------------------------------------------------------------
-- mark_predictions_revealed: marks N predictions as seen for the caller.
--
-- Bulk so the result-reveal modal can flush all viewed bets in one round-trip
-- when the user closes it. Returns the count of rows actually updated — UI
-- can decide whether to trust the optimistic close or refetch.
--
-- Authorization-safe: silently skips rows not owned by auth.uid() (vs. the
-- alternative of failing loud on the first non-owner, which could leak
-- existence of other users' prediction IDs).
-- ----------------------------------------------------------------------------

create or replace function public.mark_predictions_revealed(
  p_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_count   integer;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  update public.predictions
     set revealed_at = now()
   where id = any(p_ids)
     and user_id = v_user_id
     and resolved = true
     and revealed_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_predictions_revealed(uuid[]) from public;
grant execute on function public.mark_predictions_revealed(uuid[]) to authenticated;

comment on function public.mark_predictions_revealed(uuid[]) is
  'Marks the caller''s resolved predictions as seen. Returns affected row count. See ADR 0010.';
