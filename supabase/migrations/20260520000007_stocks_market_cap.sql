-- ============================================================================
-- Add `market_cap_usd` to `stocks` for rotation-ordering purposes.
--
-- Phase 2 of ADR 0018 lands a "smallest-market-cap-first" tie-breaker when
-- there are more demotion-eligible stocks than promotion candidates. The
-- rotation script fetches Finnhub market caps lazily — existing rows without
-- a value get populated on the first Sunday rotation, then re-checked on
-- subsequent rotations (the underlying market cap drifts over time).
--
-- nullable on purpose: the original 50 stocks were inserted before this
-- column existed and have no market_cap data yet. Lazy backfill fills them
-- in. Sort uses NULLS LAST so unbackfilled rows aren't accidentally
-- selected for demotion until we know their cap.
-- ============================================================================

alter table public.stocks
  add column if not exists market_cap_usd bigint;

-- Index for the rotation's "lowest market cap first" sort. Partial — only
-- meaningful for active stocks; we don't sort by market cap on inactive ones.
create index if not exists stocks_market_cap_idx
  on public.stocks (market_cap_usd asc) where is_active;
