-- ============================================================================
-- Weekly universe rotation audit table — Phase 2 of ADR 0018.
--
-- Every Sunday at 12:00 UTC, the rotation pipeline:
--   1. Demotes stocks with zero watchlists AND no bets in last 30 days
--   2. Promotes top-voted requests (>=3 unique-user votes) that pass
--      Finnhub validation
--   3. Always maintains exactly 50 active stocks (promote N = demote N)
--
-- This table records every rotation event for auditability + future
-- "what changed this week" UI surfaces. Public-read so anon visitors
-- can see the rotation history.
-- ============================================================================

create table public.stock_rotations (
  id               uuid primary key default gen_random_uuid(),
  rotated_at       timestamptz not null default now(),
  stock_id         uuid not null references public.stocks(id) on delete cascade,
  ticker           text not null,                  -- denormalized for read convenience
  action           text not null check (action in ('promote', 'demote')),
  votes_at_action  integer,                         -- only set on promote
  reason           text                             -- e.g. 'zero_watchlists_and_no_bets_30d'
);

create index stock_rotations_rotated_at_idx
  on public.stock_rotations (rotated_at desc);
create index stock_rotations_stock_idx
  on public.stock_rotations (stock_id, rotated_at desc);
create index stock_rotations_ticker_idx
  on public.stock_rotations (ticker, rotated_at desc);

alter table public.stock_rotations enable row level security;

create policy "stock_rotations_public_read"
  on public.stock_rotations
  for select using (true);

-- Writes go through the service-role key in the rotation pipeline.
-- No user-facing writes.
