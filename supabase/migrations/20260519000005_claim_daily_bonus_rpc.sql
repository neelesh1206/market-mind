-- ============================================================================
-- claim_daily_bonus RPC — one click per ET day, increments streak.
--
-- The daily ritual hook: log in, claim, see streak go up. Bonus scales with
-- consecutive days so users who keep showing up get progressively more for
-- their visit (capped to avoid runaway inflation).
--
--   Day 1:   100 credits
--   Day 2:   120
--   Day 3:   140
--   ...
--   Day 10+: 300 (cap)
--
-- Race safety: FOR UPDATE on user_profiles, same pattern as place_bet — two
-- near-simultaneous claims can't both succeed.
--
-- Trading day vs calendar day: bonus is per *calendar* ET day, not per
-- *trading* day. The caller passes p_today_date computed from the same
-- MarketSchedule helper the bet flow uses, so it stays in ET regardless of
-- the server's local timezone.
--
-- Errors:
--   already_claimed_today  - last_login_date == p_today_date
--   not_authenticated      - no auth.uid()
-- ============================================================================

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

  -- Streak math: if last claim was yesterday, continue the streak.
  -- Otherwise (null = first ever, or > 1 day gap) reset to 1.
  if v_profile.last_login_date = p_today_date - interval '1 day' then
    v_new_streak := coalesce(v_profile.current_streak, 0) + 1;
  else
    v_new_streak := 1;
  end if;

  v_new_longest := greatest(coalesce(v_profile.longest_streak, 0), v_new_streak);

  -- Bonus: 100 base + 20 per day of streak, capped at 300.
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

  return query select v_bonus, v_new_balance, v_new_streak, v_new_longest;
end;
$$;

revoke all on function public.claim_daily_bonus(date) from public;
grant execute on function public.claim_daily_bonus(date) to authenticated;

comment on function public.claim_daily_bonus(date) is
  'Daily login bonus: awards 100+streak*20 credits (cap 300), bumps streak. One claim per ET calendar day.';
