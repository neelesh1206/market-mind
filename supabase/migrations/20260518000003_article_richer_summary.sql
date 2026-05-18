-- ============================================================================
-- Richer per-article summaries for the trust UI.
--
-- `tldr` stays as the 1-sentence card-glance string (max ~140 chars).
-- Two new columns add depth without bloating the card view:
--   - `summary`          : 2-3 sentence neutral-tone summary (paragraph)
--   - `signal_influence` : 1 sentence on how this article shapes the signal
--                          (e.g., "Bullish — analyst upgrade ahead of earnings")
--
-- Both nullable — existing rows from earlier runs are unaffected.
-- ============================================================================

alter table public.insight_articles
  add column if not exists summary text,
  add column if not exists signal_influence text;
