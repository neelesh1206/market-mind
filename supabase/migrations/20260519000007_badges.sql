-- ============================================================================
-- Badges v1 — catalog detection points:
--
--   FIRST_BET    awarded inside place_bet RPC (this migration extends it)
--   FIRST_WIN    awarded by resolution job (Python) via award_badge() RPC
--   STREAK_N     awarded by resolution job + claim_daily_bonus RPC (N=3/7/14/30)
--
-- The user_badges table already exists from initial schema (badge_type +
-- unique constraint). This migration adds the write surface:
--
--   1. Extends place_bet to insert FIRST_BET on the user's first prediction
--   2. New award_badge() RPC (service-role only) for pipeline-driven awards
--   3. Extends claim_daily_bonus to award STREAK_N badges
--
-- All inserts use ON CONFLICT DO NOTHING on the unique(user_id, badge_type)
-- constraint, so re-running detection is safe.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- award_badge — server-side helper for the resolution job.
--
-- Callable only by service_role (pipeline) and not authenticated users —
-- users shouldn't be able to grant themselves badges via the client.
-- Returns true if the badge was newly inserted, false if it already existed.
-- ----------------------------------------------------------------------------

create or replace function public.award_badge(
  p_user_id uuid,
  p_badge_type text,
  p_metadata jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted boolean := false;
begin
  insert into public.user_badges (user_id, badge_type, metadata)
  values (p_user_id, p_badge_type, p_metadata)
  on conflict (user_id, badge_type) do nothing
  returning true into v_inserted;

  return coalesce(v_inserted, false);
end;
$$;

revoke all on function public.award_badge(uuid, text, jsonb) from public;
revoke all on function public.award_badge(uuid, text, jsonb) from authenticated;
grant execute on function public.award_badge(uuid, text, jsonb) to service_role;

comment on function public.award_badge(uuid, text, jsonb) is
  'Pipeline-only badge award. Idempotent via unique(user_id, badge_type).';

-- ----------------------------------------------------------------------------
-- place_bet — extended to award FIRST_BET on the user's first prediction.
--
-- The check `total_predictions = 1 after increment` is the cheap detector —
-- we just bumped it inside this transaction, so if it now equals 1 this is
-- definitionally the first bet ever.
-- ----------------------------------------------------------------------------

create or replace function public.place_bet(
  p_stock_id uuid,
  p_direction text,
  p_credits integer,
  p_prediction_date date
)
returns public.predictions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id     uuid := auth.uid();
  v_balance     integer;
  v_pred        public.predictions;
  v_total_after integer;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_direction not in ('UP', 'DOWN') then
    raise exception 'invalid_direction' using errcode = 'P0001';
  end if;

  if p_credits < 50 or p_credits > 500 or (p_credits % 50) <> 0 then
    raise exception 'invalid_credits' using errcode = 'P0001';
  end if;

  select credit_balance
    into v_balance
    from public.user_profiles
   where id = v_user_id
   for update;

  if v_balance is null then
    raise exception 'profile_missing' using errcode = 'P0001';
  end if;

  if v_balance < p_credits then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;

  insert into public.predictions (
    user_id, stock_id, prediction_date, direction, credits_wagered
  )
  values (
    v_user_id, p_stock_id, p_prediction_date, p_direction, p_credits
  )
  returning * into v_pred;

  update public.user_profiles
     set credit_balance     = credit_balance - p_credits,
         total_predictions  = total_predictions + 1
   where id = v_user_id
   returning total_predictions into v_total_after;

  insert into public.credit_transactions (
    user_id, amount, type, reference_id, balance_after
  )
  values (
    v_user_id, -p_credits, 'WAGER', v_pred.id, v_balance - p_credits
  );

  -- FIRST_BET badge: if this is the user's first ever prediction.
  if v_total_after = 1 then
    insert into public.user_badges (user_id, badge_type, metadata)
    values (v_user_id, 'FIRST_BET', jsonb_build_object('prediction_id', v_pred.id))
    on conflict (user_id, badge_type) do nothing;
  end if;

  return v_pred;
end;
$$;

-- ----------------------------------------------------------------------------
-- claim_daily_bonus — extended to award STREAK_N when threshold crossed.
--
-- We just computed v_new_streak inside the txn; if it equals 3/7/14/30 this
-- is the first claim that brought them to that threshold (since the only
-- way to hit, say, 7 is to first hit 6 the day before).
-- ----------------------------------------------------------------------------

create or replace function public.claim_daily_bonus(
  p_today_date date
)
returns table (
  credits_awarded   integer,
  new_balance       integer,
  new_streak        integer,
  new_longest       integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id      uuid := auth.uid();
  v_profile      public.user_profiles;
  v_new_streak   integer;
  v_new_longest  integer;
  v_bonus        integer;
  v_new_balance  integer;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_profile
    from public.user_profiles
   where id = v_user_id
   for update;

  if v_profile.id is null then
    raise exception 'profile_missing' using errcode = 'P0001';
  end if;

  if v_profile.last_login_date = p_today_date then
    raise exception 'already_claimed_today' using errcode = 'P0001';
  end if;

  if v_profile.last_login_date = p_today_date - interval '1 day' then
    v_new_streak := coalesce(v_profile.current_streak, 0) + 1;
  else
    v_new_streak := 1;
  end if;

  v_new_longest := greatest(coalesce(v_profile.longest_streak, 0), v_new_streak);
  v_bonus := least(100 + (v_new_streak - 1) * 20, 300);
  v_new_balance := v_profile.credit_balance + v_bonus;

  update public.user_profiles
     set credit_balance   = v_new_balance,
         current_streak   = v_new_streak,
         longest_streak   = v_new_longest,
         last_login_date  = p_today_date
   where id = v_user_id;

  insert into public.credit_transactions (
    user_id, amount, type, reference_id, balance_after
  )
  values (
    v_user_id, v_bonus, 'DAILY_BONUS', null, v_new_balance
  );

  -- Streak badges — fire on the exact day the threshold is reached.
  if v_new_streak in (3, 7, 14, 30) then
    insert into public.user_badges (user_id, badge_type, metadata)
    values (
      v_user_id,
      'STREAK_' || v_new_streak,
      jsonb_build_object('streak_day', v_new_streak)
    )
    on conflict (user_id, badge_type) do nothing;
  end if;

  return query select v_bonus, v_new_balance, v_new_streak, v_new_longest;
end;
$$;
