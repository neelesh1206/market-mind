-- ============================================================================
-- Revert: drop universe_eligible_stocks + restore Finnhub-based submit RPC.
--
-- Context (see ADR 0018's 2026-05-20 "Reversed" amendment):
-- The pre-loaded eligibility table architecture was over-engineering at
-- our scale. With the 5-per-week request cap acting as a structural
-- rate-limiter, per-request Finnhub validation is ~250-400 calls/week
-- total — comfortably under the 60/min quota and not meaningfully
-- competing with live-prices traffic.
--
-- This migration:
--   1. Drops `universe_eligible_stocks` table (CASCADE — no FK
--      dependencies expected since we only added the table 3 commits
--      ago and nothing else references it).
--   2. Restores `submit_stock_request` RPC to its arg-validated form
--      (company_name + market_cap come from the server action's Finnhub
--      check, not from a Postgres lookup).
--   3. KEEPS the 5-per-rolling-7d limit — that's the actual rate
--      limiter and the reason we can roll back the table.
--   4. KEEPS `get_user_weekly_request_count` — UI uses it.
--
-- IDEMPOTENT against partial state: `DROP TABLE IF EXISTS` means it's
-- safe whether or not the prior migration was applied to a given env.
-- ============================================================================

drop table if exists public.universe_eligible_stocks cascade;


-- ============================================================================
-- submit_stock_request — restore Phase 1 shape + keep 5/week limit
--
-- Errors:
--   not_authenticated      - auth.uid() is null
--   invalid_ticker         - empty/blank ticker after trim
--   already_in_universe    - ticker is already in public.stocks active
--   weekly_limit_reached   - user has 5 unique-ticker requests in last 7d
--
-- Removed since the 2026-05-20 amendment:
--   ticker_not_eligible    - no longer enforced at the RPC layer; the
--                            server action's Finnhub /profile2 validation
--                            is the only gate. Less defense in depth,
--                            but the surface area we lost is the table
--                            we just dropped.
-- ============================================================================

create or replace function public.submit_stock_request(
  p_ticker        text,
  p_company_name  text,
  p_market_cap    bigint default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id        uuid := auth.uid();
  v_ticker         text := upper(trim(p_ticker));
  v_recent_unique  integer;
  v_is_new_ticker  boolean;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if v_ticker is null or length(v_ticker) = 0 then
    raise exception 'invalid_ticker' using errcode = 'P0001';
  end if;

  -- Defensive: server action already checks, but a race could land here.
  if exists (
    select 1 from public.stocks where upper(ticker) = v_ticker and is_active
  ) then
    raise exception 'already_in_universe' using errcode = 'P0001';
  end if;

  -- Rolling 7-day cap on UNIQUE-TICKER requests. Re-voting an existing
  -- (user, ticker) row is idempotent and shouldn't consume budget.
  v_is_new_ticker := not exists (
    select 1 from public.stock_requests
     where user_id = v_user_id and ticker = v_ticker
  );
  if v_is_new_ticker then
    select count(*) into v_recent_unique
      from public.stock_requests
     where user_id = v_user_id
       and created_at > now() - interval '7 days';
    if v_recent_unique >= 5 then
      raise exception 'weekly_limit_reached' using errcode = 'P0001';
    end if;
  end if;

  insert into public.stock_requests (user_id, ticker, company_name, market_cap_usd)
  values (
    v_user_id,
    v_ticker,
    nullif(trim(p_company_name), ''),
    p_market_cap
  )
  on conflict (user_id, ticker) do update
    set company_name   = excluded.company_name,
        market_cap_usd = excluded.market_cap_usd;
end;
$$;
