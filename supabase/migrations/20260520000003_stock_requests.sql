-- ============================================================================
-- Stock requests — users can vote on tickers they want added to the universe.
--
-- The curated 50-stock universe will rotate weekly (see Phase 2 / ADR 0018):
-- the most-requested tickers get promoted, replacing demoted ones (zero
-- watchlists AND zero recent bets). This migration is the *collection*
-- side — Phase 2 will add the rotation pipeline.
--
-- One vote per (user, ticker). Re-clicking is a no-op (idempotent upsert).
-- Removing a vote = deleting the row. company_name is captured at request
-- time so we can show it on /requests even if Finnhub's profile2 endpoint
-- is down later (and so the display doesn't depend on a network call per
-- ticker to render the page).
-- ============================================================================

create table public.stock_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  ticker          text not null,                    -- upper-case, validated
  company_name    text,                              -- captured at request time
  market_cap_usd  bigint,                            -- captured at validation
  created_at      timestamptz not null default now(),
  unique (user_id, ticker)
);

create index stock_requests_ticker_idx on public.stock_requests (ticker);
create index stock_requests_user_idx
  on public.stock_requests (user_id, created_at desc);

alter table public.stock_requests enable row level security;

-- Users see only their own requests. Aggregate listings go through
-- the SECURITY DEFINER `get_top_stock_requests` function below.
create policy "stock_requests_own_select"
  on public.stock_requests
  for select using (auth.uid() = user_id);

-- Writes go through RPCs (validation lives there).


-- ============================================================================
-- submit_stock_request — idempotent upsert. The validation that the ticker
-- is real, market-cap-qualifying, and not already in the universe lives in
-- the server action (it requires Finnhub network calls; not appropriate to
-- duplicate in Postgres). This RPC just stores the validated record.
--
-- Errors:
--   not_authenticated   - auth.uid() is null
--   already_in_universe - this ticker is currently in public.stocks
--                          (defensive — server action should already gate)
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
  v_user_id  uuid := auth.uid();
  v_ticker   text := upper(trim(p_ticker));
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if v_ticker is null or length(v_ticker) = 0 then
    raise exception 'invalid_ticker' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.stocks where upper(ticker) = v_ticker and is_active
  ) then
    raise exception 'already_in_universe' using errcode = 'P0001';
  end if;

  insert into public.stock_requests (user_id, ticker, company_name, market_cap_usd)
  values (v_user_id, v_ticker, nullif(trim(p_company_name), ''), p_market_cap)
  on conflict (user_id, ticker) do update
    set company_name   = excluded.company_name,
        market_cap_usd = excluded.market_cap_usd;
end;
$$;


-- ============================================================================
-- remove_stock_request — delete the caller's vote for a ticker. No-op if no
-- such vote exists (safer than raising — UI may double-click the button).
-- ============================================================================

create or replace function public.remove_stock_request(p_ticker text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_ticker  text := upper(trim(p_ticker));
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  delete from public.stock_requests
   where user_id = v_user_id
     and ticker = v_ticker;
end;
$$;


-- ============================================================================
-- get_top_stock_requests — public list of requested tickers sorted by vote
-- count desc. Returns (ticker, company_name, vote_count, latest_request_at).
-- SECURITY DEFINER so anon visitors can read aggregates despite the own-only
-- RLS policy on the underlying rows.
-- ============================================================================

create or replace function public.get_top_stock_requests(
  p_limit integer default 100
)
returns table (
  ticker            text,
  company_name      text,
  vote_count        integer,
  latest_request_at timestamptz
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    r.ticker,
    -- Pick the most-recent non-null company_name (sometimes profile2 returns
    -- a different display name; the latest is most likely correct).
    (array_agg(r.company_name order by r.created_at desc)
        filter (where r.company_name is not null))[1] as company_name,
    count(*)::integer as vote_count,
    max(r.created_at) as latest_request_at
  from public.stock_requests r
  -- Hide rows whose ticker has since been promoted into the universe.
  -- The auto-rotation pipeline (Phase 2) will delete those rows, but
  -- in the meantime we filter defensively at the read site.
  left join public.stocks s on upper(s.ticker) = r.ticker and s.is_active
  where s.id is null
  group by r.ticker
  order by vote_count desc, latest_request_at desc
  limit greatest(p_limit, 0);
$$;

grant execute on function public.submit_stock_request(text, text, bigint)
  to authenticated;
grant execute on function public.remove_stock_request(text) to authenticated;
grant execute on function public.get_top_stock_requests(integer)
  to anon, authenticated;
