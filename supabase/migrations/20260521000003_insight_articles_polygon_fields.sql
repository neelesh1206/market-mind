-- ============================================================================
-- ADR 0020 — Persist Polygon's per-ticker insight alongside our blended values.
--
-- Two new columns on insight_articles capture the raw signal coming out of
-- Polygon's /v2/reference/news `insights` array:
--
--   massive_sentiment            text  -- 'positive' | 'negative' | 'neutral'
--   massive_sentiment_reasoning  text  -- Polygon's free-text per-ticker note
--
-- These are AUDIT/DEBUG fields. The blended sentiment lands in the existing
-- `sentiment` column; the LLM-refined TL;DR lands in the existing `tldr`
-- column. Storing Polygon's raw values separately lets us:
--   - tune the FinBERT-vs-Polygon blend weight later with calibration data
--   - debug "why did the score swing?" by comparing the two sources
--   - retroactively compute alternative blending strategies on history
--
-- Nullable, no default — articles fetched before this migration applied
-- will have NULL on both fields; that's correct (we didn't capture the
-- data at the time).
-- ============================================================================

alter table public.insight_articles
  add column if not exists massive_sentiment            text,
  add column if not exists massive_sentiment_reasoning  text;

-- Constrain the categorical column at the database level so a future
-- pipeline bug can't push unexpected values through.
alter table public.insight_articles
  add constraint insight_articles_massive_sentiment_chk
  check (
    massive_sentiment is null
    or massive_sentiment in ('positive', 'negative', 'neutral')
  );
