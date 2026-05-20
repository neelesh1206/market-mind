-- ============================================================================
-- Eligible-universe table — pre-loaded weekly, source of truth for stock
-- search + request validation. See ADR 0018's 2026-05-20 amendment for the
-- design rationale.
--
-- WHY a table (vs. caching Finnhub responses, vs. Redis JSON blob):
--   - search needs multi-attribute filtering with relevance scoring;
--     SQL with indexes is the natural fit, Redis blobs require O(n)
--     in-app filtering on every keystroke
--   - we already pay Finnhub for live prices (60/min, shared quota); moving
--     search off that critical-path lane gives quota isolation
--   - Phase 2 rotation pipeline joins this with stock_requests cleanly;
--     can't join Redis
--   - auditability: refreshed_at per row answers "what market cap did we
--     use to validate this request?"
--
-- Populated by `pipeline/refresh_eligible_universe.py` on a weekly schedule
-- (Sunday 04:00 UTC) via the Cloudflare Worker cron. Table starts empty on
-- migration; first refresh run (manual via workflow_dispatch right after
-- migration applies, then weekly cron thereafter) populates it.
-- ============================================================================

create table public.universe_eligible_stocks (
  ticker          text primary key,
  company_name    text not null,
  exchange        text,
  market_cap_usd  bigint not null,
  refreshed_at    timestamptz not null default now()
);

-- Btree on (ticker) is the primary key — already indexed.
-- For "starts-with" matching on ticker prefix in search:
create index universe_eligible_ticker_pattern_idx
  on public.universe_eligible_stocks (ticker text_pattern_ops);

-- For case-insensitive substring matching on company_name in search:
create index universe_eligible_company_lower_idx
  on public.universe_eligible_stocks (lower(company_name) text_pattern_ops);

-- For top-N-by-market-cap displays and the "default sort" fallback:
create index universe_eligible_market_cap_idx
  on public.universe_eligible_stocks (market_cap_usd desc);

-- Public-read: anon visitors can see the universe (it powers the search
-- dropdown on /stocks → Request tab). Writes go through the refresh job
-- using the service-role key (bypasses RLS).
alter table public.universe_eligible_stocks enable row level security;

create policy "universe_eligible_public_read"
  on public.universe_eligible_stocks
  for select using (true);


-- ============================================================================
-- submit_stock_request — replaces the prior implementation. Now:
--
--   1. Validates the ticker is in universe_eligible_stocks (no more
--      Finnhub round-trip during submit; the gate happens at refresh time).
--   2. Enforces a rolling-7-day limit of 5 unique-ticker requests per user.
--      Re-voting on an existing request is idempotent and does NOT count
--      against the limit (it's a no-op upsert).
--   3. Rejects if the ticker is already in the active universe (defensive;
--      shouldn't be requestable since the refresh would have skipped it).
--
-- Errors (all P0001 with named tags so the server action can map specific
-- copy):
--   not_authenticated      - no auth.uid()
--   ticker_not_eligible    - ticker isn't in universe_eligible_stocks
--   already_in_universe    - ticker is in public.stocks AND active
--   weekly_limit_reached   - user has 5 unique-ticker requests in last 7d
-- ============================================================================

create or replace function public.submit_stock_request(
  p_ticker        text,
  p_company_name  text default null,   -- ignored now (we use the eligibility table)
  p_market_cap    bigint default null  -- ignored now
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id          uuid := auth.uid();
  v_ticker           text := upper(trim(p_ticker));
  v_eligible         public.universe_eligible_stocks;
  v_recent_unique    integer;
  v_is_new_ticker    boolean;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if v_ticker is null or length(v_ticker) = 0 then
    raise exception 'invalid_ticker' using errcode = 'P0001';
  end if;

  -- Already in the curated universe? Defensive guard — search shouldn't
  -- have offered it, but if a race happens we surface a clear error.
  if exists (
    select 1 from public.stocks where upper(ticker) = v_ticker and is_active
  ) then
    raise exception 'already_in_universe' using errcode = 'P0001';
  end if;

  -- Look up the ticker in the eligibility table. If not present, this is
  -- either a stale UI submission, a sub-$2B name, or a non-US-listed
  -- ticker. We don't try to disambiguate; the message is the same.
  select * into v_eligible
    from public.universe_eligible_stocks
   where ticker = v_ticker;
  if v_eligible.ticker is null then
    raise exception 'ticker_not_eligible' using errcode = 'P0001';
  end if;

  -- Rolling 7-day limit. Only ENFORCED for genuinely new (user, ticker)
  -- pairs — re-voting on an existing request is a no-op upsert and shouldn't
  -- consume budget.
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

  -- Idempotent upsert. We capture company_name and market_cap from the
  -- eligibility table so they're frozen at request time (display will
  -- reflect what the user actually requested, not what shifted later).
  insert into public.stock_requests (user_id, ticker, company_name, market_cap_usd)
  values (v_user_id, v_ticker, v_eligible.company_name, v_eligible.market_cap_usd)
  on conflict (user_id, ticker) do update
    set company_name   = excluded.company_name,
        market_cap_usd = excluded.market_cap_usd;
end;
$$;


-- ============================================================================
-- get_user_weekly_request_count — for the "X of 5 used" UI badge.
-- Returns the number of UNIQUE-TICKER requests this user has made in the
-- last 7 days (rolling window). SECURITY DEFINER so it doesn't need to
-- pierce RLS — the caller passes their own auth.uid() implicitly.
-- ============================================================================

create or replace function public.get_user_weekly_request_count()
returns integer
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_count   integer;
begin
  if v_user_id is null then
    return 0;
  end if;
  select count(*) into v_count
    from public.stock_requests
   where user_id = v_user_id
     and created_at > now() - interval '7 days';
  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.get_user_weekly_request_count() to authenticated;
