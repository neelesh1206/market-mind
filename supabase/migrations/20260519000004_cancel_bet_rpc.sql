-- ============================================================================
-- cancel_bet RPC — atomic cancellation of an unresolved bet.
--
-- Symmetric counterpart to place_bet. Same rationale: the three writes
-- (delete prediction, refund balance, append REFUND ledger row) must move
-- together. A concurrent resolution job that fires at 4:15 PM ET while a
-- user is mid-cancel would be the worst-case failure — we'd refund a bet
-- that's already been settled. The FOR UPDATE lock on the prediction row
-- plus the `resolved=false` re-check inside the transaction makes that
-- race impossible: either we get the lock first (cancel wins), or
-- resolution gets it first and we read `resolved=true` (cancel rejected).
--
-- Window gate: the server action checks MarketSchedule.betWindowOpen
-- before calling. The RPC trusts that gate — it doesn't independently
-- recompute the 1 PM ET cutoff. Defense in depth comes from the
-- resolved=false check (resolution can't run before 4:15 PM, well after
-- the bet window closes).
--
-- Errors surfaced:
--   prediction_not_found         - row doesn't exist (or RLS hid it)
--   not_owner                    - prediction belongs to a different user
--   prediction_already_resolved  - resolution job got there first
--
-- See ADR 0009 (Cancellation section) for the full rationale.
-- ============================================================================

create or replace function public.cancel_bet(
  p_prediction_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id   uuid := auth.uid();
  v_pred      public.predictions;
  v_balance   integer;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Lock the prediction row so a concurrent resolution can't settle it
  -- mid-cancel. If it's missing, RLS scoped it out or the id is bogus.
  select *
    into v_pred
    from public.predictions
   where id = p_prediction_id
   for update;

  if v_pred.id is null then
    raise exception 'prediction_not_found' using errcode = 'P0001';
  end if;

  if v_pred.user_id <> v_user_id then
    -- Should be unreachable under RLS, but defensive — never silently
    -- ignore a request that fell through into the function body.
    raise exception 'not_owner' using errcode = '42501';
  end if;

  if v_pred.resolved then
    raise exception 'prediction_already_resolved' using errcode = 'P0001';
  end if;

  delete from public.predictions where id = p_prediction_id;

  update public.user_profiles
     set credit_balance     = credit_balance + v_pred.credits_wagered,
         total_predictions  = greatest(total_predictions - 1, 0)
   where id = v_user_id
   returning credit_balance into v_balance;

  insert into public.credit_transactions (
    user_id, amount, type, reference_id, balance_after
  )
  values (
    v_user_id, v_pred.credits_wagered, 'REFUND', v_pred.id, v_balance
  );
end;
$$;

revoke all on function public.cancel_bet(uuid) from public;
grant execute on function public.cancel_bet(uuid) to authenticated;

comment on function public.cancel_bet(uuid) is
  'Atomic bet cancellation: locks prediction, deletes it, refunds balance, appends REFUND ledger row. See ADR 0009.';
