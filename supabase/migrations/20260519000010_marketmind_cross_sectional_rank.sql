-- ============================================================================
-- Cross-sectional ranking on marketmind_predictions.
--
-- See ADR 0015. The verdict score in isolation says how strong the signal is
-- for one stock; the rank says how strong it is *relative to today's
-- universe*. Top quintile vs bottom quintile is the unit of information that
-- actually translates to a long-short factor framework.
--
-- combined_score    — the raw weighted+renormalized score from compute_verdict
--                     *before* the direction-threshold check. Stored so that
--                     resolved-prediction analysis can re-rank by alternative
--                     orderings without re-computing from bucket scores.
-- rank_in_universe  — 1-based, where 1 is the strongest bullish (most
--                     positive combined_score) and N (typically 50) is the
--                     strongest bearish. NULL for any row not yet
--                     post-processed by the ranking pass.
--
-- Both columns are nullable + additive; existing rows stay valid and get
-- backfilled by the next pipeline run.
-- ============================================================================

alter table public.marketmind_predictions
  add column if not exists combined_score   numeric(5, 3),
  add column if not exists rank_in_universe integer;

create index if not exists marketmind_predictions_rank_idx
  on public.marketmind_predictions (prediction_date, rank_in_universe)
  where rank_in_universe is not null;

create index if not exists marketmind_predictions_combined_score_idx
  on public.marketmind_predictions (prediction_date, combined_score desc)
  where combined_score is not null;

-- No RLS change — existing public-read policy on marketmind_predictions
-- covers the new columns (the verdict + track record are publicly
-- accountable per ADR 0007).
