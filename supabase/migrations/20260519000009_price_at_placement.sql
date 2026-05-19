-- ============================================================================
-- price_at_placement — capture the live price at the moment of bet placement.
--
-- Context: bets resolve from `open_price → close_price` per ADR 0008. But a
-- user can place a bet any time between 8 PM ET (prior day) and 1 PM ET
-- (trading day), so the price they actually saw when committing can be
-- meaningfully different from the open price the resolution uses. Without
-- capturing it, "why did I lose? I bet at $254 and it closed at $254" is
-- unanswerable.
--
-- This column is **informational only** — the resolution job doesn't read
-- it. NULL is acceptable (live-price fetch can fail or time out; we don't
-- want to block bet placement on a non-essential lookup).
-- ============================================================================

alter table public.predictions
  add column if not exists price_at_placement numeric(10, 2);

comment on column public.predictions.price_at_placement is
  'Live price (from Massive) at the moment the bet was placed. Informational only — resolution uses open_price → close_price. NULL when the live-price fetch failed.';

-- ----------------------------------------------------------------------------
-- place_bet — extended to accept the optional price_at_placement.
--
-- New param at the end so any caller still passing the 4-arg shape gets a
-- friendly "function not found" error rather than a silent data loss. We
-- update both callers (the server action) in the same change.
-- ----------------------------------------------------------------------------

create or replace function public.place_bet(
  p_stock_id uuid,
  p_direction text,
  p_credits integer,
  p_prediction_date date,
  p_price_at_placement numeric default null
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
    user_id, stock_id, prediction_date, direction, credits_wagered, price_at_placement
  )
  values (
    v_user_id, p_stock_id, p_prediction_date, p_direction, p_credits, p_price_at_placement
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

  -- FIRST_BET badge: still triggered when this is the user's first prediction.
  if v_total_after = 1 then
    insert into public.user_badges (user_id, badge_type, metadata)
    values (v_user_id, 'FIRST_BET', jsonb_build_object('prediction_id', v_pred.id))
    on conflict (user_id, badge_type) do nothing;
  end if;

  return v_pred;
end;
$$;
