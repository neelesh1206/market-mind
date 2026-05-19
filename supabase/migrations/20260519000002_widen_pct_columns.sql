-- ============================================================================
-- Widen percentage columns from numeric(5,2) → numeric(8,2).
--
-- numeric(5,2) caps absolute values at 999.99 — too tight for:
--   - YTD percent changes on volatile stocks (can exceed ±1000%)
--   - Reddit mention deltas (a small base + viral spike easily yields >999%)
--   - Sector ETF changes during crisis days
--
-- Pipeline run on 2026-05-19 failed on CRM with:
--   '22003 numeric field overflow — precision 5, scale 2 must round to
--    absolute value less than 10^3'
--
-- numeric(8,2) caps at ±99,999.99 — comfortably covers any realistic
-- percentage. Cheap to widen now; harder once we have N rows.
-- ============================================================================

alter table public.stock_insights
  alter column day_change_pct        type numeric(8, 2),
  alter column week_change_pct       type numeric(8, 2),
  alter column month_change_pct      type numeric(8, 2),
  alter column ytd_change_pct        type numeric(8, 2),
  alter column reddit_mention_delta  type numeric(8, 2),
  alter column sector_etf_change_pct type numeric(8, 2);

-- rsi_14, stocktwits_bullish, vix_level stay numeric(5,2) — those are
-- bounded by definition (0-100 range).
