-- ============================================================================
-- place_bet RPC — atomic bet placement.
--
-- Why an RPC instead of three sequential calls from the server action:
--   - Concurrent double-click race: without a single transaction, two
--     near-simultaneous calls can both pass the credit check and both
--     debit the balance, leaving it negative.
--   - Partial failure: if `predictions` insert succeeds but the credit
--     debit fails, we owe the user a refund. One transaction = one fate.
--   - Locking: we take an explicit FOR UPDATE row lock on the user's
--     profile so the balance check and debit see each other.
--
-- The function is SECURITY DEFINER so it can write to credit_transactions
-- (whose RLS denies user inserts — the ledger is meant to be tamper-proof
-- from the client). All writes still scope to auth.uid().
--
-- Trading day (prediction_date) is passed in by the caller, computed from
-- the same MarketSchedule helper that drives the UI. We don't want to
-- recompute ET-aware "trading day" in PL/pgSQL — the server action is the
-- single source of truth for "which day is this bet for".
--
-- Errors surfaced (caller maps to UX copy):
--   insufficient_credits   - balance < requested stake
--   invalid_direction      - direction not in (UP, DOWN)
--   invalid_credits        - stake out of [50, 500] range
--   23505 (unique_violation) - already bet on this stock for this date
-- ============================================================================

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
  v_user_id   uuid := auth.uid();
  v_balance   integer;
  v_pred      public.predictions;
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

  -- Lock the user's profile row for the duration of the txn so concurrent
  -- bet attempts see a consistent balance.
  select credit_balance
    into v_balance
    from public.user_profiles
   where id = v_user_id
   for update;

  if v_balance is null then
    -- profile row missing — signup trigger should have created it
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
   where id = v_user_id;

  insert into public.credit_transactions (
    user_id, amount, type, reference_id, balance_after
  )
  values (
    v_user_id, -p_credits, 'WAGER', v_pred.id, v_balance - p_credits
  );

  return v_pred;
end;
$$;

revoke all on function public.place_bet(uuid, text, integer, date) from public;
grant execute on function public.place_bet(uuid, text, integer, date) to authenticated;

comment on function public.place_bet(uuid, text, integer, date) is
  'Atomic bet placement: validates + locks profile + inserts prediction + debits balance + writes ledger row. See ADR 0009.';
