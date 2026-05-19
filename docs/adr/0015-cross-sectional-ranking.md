# ADR 0015 — Cross-sectional ranking of MarketMind verdicts

**Status:** Accepted
**Date:** 2026-05-19

## Context

ADR 0011's analyst review highlighted that MarketMind scored every
stock in **isolation**: NVDA's verdict has no awareness of how its
signal compares to AMD's. But the strongest equity-market signals
are **relative**, not absolute. "NVDA's combined score is in the
top decile of our universe today" carries more actionable
information than "NVDA's combined score is +0.34."

Most published equity-alpha results are reported as *top quintile
minus bottom quintile* returns precisely because that's how a
long-short factor model converts a signal into P&L: go long the
top, short the bottom, neutralize beta/sector exposure. Even for
single-name bets — like a daily direction prediction — the relative
ordering carries more information than the absolute level, because
the absolute level is sensitive to whatever scaling the bucket
formulas happen to produce.

The current `marketmind_predictions` row stores `direction`,
`confidence`, and `bucket_scores`, but **does not store the raw
weighted-renormalized combined score** that determined the
direction. Without that, we can't rank across stocks even
post-hoc. Adding it unlocks both today's ranking surface and
future "top quintile vs bottom quintile" backtesting.

## Decision

Two new columns on `marketmind_predictions` (additive, nullable for
back-compat):

- `combined_score numeric(5, 3)` — the raw weighted score AFTER
  bucket renormalization, BEFORE the direction threshold check.
  Range typically [-1, +1]. Persisting it means resolved-prediction
  analysis can re-rank by alternative orderings, or compare
  combined-score magnitude as a calibration signal, without
  recomputing from bucket scores.
- `rank_in_universe integer` — 1-based, populated by the
  post-processing pass after all stocks finish. Rank 1 = strongest
  bullish (most positive `combined_score`); rank N = strongest
  bearish. Indexed for fast `where rank_in_universe <= 5` style
  queries (top-long / top-short surfaces).

Both columns are NULL on the old rows that existed before the
migration; the next nightly run backfills via the ranking pass.

### Where the ranking happens

`fetch_insights.py` orchestrator runs all per-stock work first
(price fetch, FinBERT, verdict compute, upsert), then — only when
processing the *full* universe (not `--ticker X` or `--limit N`
runs, which would produce a misleading rank) — invokes a
`_rank_universe` post-pass:

1. Query today's `marketmind_predictions` rows where
   `combined_score IS NOT NULL`.
2. Sort descending by `combined_score`.
3. Assign ranks 1..N, update each row.
4. Log the top 5 long and bottom 5 short — the conviction surface
   that a future UI component will render directly from these
   ranks.

The pure-math ranking helper lives in `pipeline/processors/ranking.py`
(separated from the orchestrator so tests can import it without
dragging in dotenv/supabase/HF deps).

### Why ranks, not percentiles

The universe is small (~50 stocks). Percentiles add a layer of
abstraction without adding information — rank 1 of 50 *is*
"top 2%" — and integer ranks are easier to reason about in queries
and UI ("show me the top 5") than continuous percentiles.

### Why no UI in this ADR

Backend ships now; UI is deferred. The user is mid-cycle on other
UI work, so this lands as the *data* surface for a future
component (working title: "MarketMind's conviction list"). Schema
+ data are stable contracts; the UI can be designed against them
independently. The log output (`top_long … top_short …`) lets us
see the value of the surface immediately in run logs without
needing a deployment.

## Alternatives considered

- **Percentile-rank instead of integer-rank.** Symmetric across
  universe sizes, more sortable in some downstream contexts.
  Rejected because of the small-universe argument above; can be
  computed from integer rank trivially.

- **Sector-relative ranking** (rank within each sector). More
  principled for a factor framework (sector beta should be
  neutralized), but the universe is too small to support
  meaningful intra-sector ranks (some sectors have only 3-4
  stocks). Universe-wide rank is the right starting point.

- **Rank by `confidence` instead of `combined_score`.**
  `confidence = |combined|`, so confidence-ranking would put
  strongly-bullish and strongly-bearish stocks adjacent to each
  other at the top. The directional ranking we want puts strongly
  bullish at rank 1 and strongly bearish at rank N — that's what
  `combined_score`-ranking gives.

- **Run the ranking inline per-stock as each verdict computes.**
  Doesn't work — you need the full universe to assign ranks
  meaningfully. Has to be a post-pass.

- **Use a Postgres view that computes ranks on read.** Simpler
  schema, but means every read pays the cost of ranking. We rank
  ~50 stocks once per day; persisting is cheaper.

## Consequences

**Easier:**
- Backtesting can stratify by rank cohort (does the top-decile
  consistently outperform the bottom-decile? — the canonical
  factor question).
- Future UI surface (top-N conviction list) reads
  `where rank_in_universe <= 5` and `>= N - 5` — clean indexed
  queries.
- The ranking pass log emits `top_long ... top_short ...` per
  run — a useful operational read on which way the model is
  leaning today.
- Provides infrastructure for the next P1 item (probability
  calibration) — once we have enough resolved verdicts, we can
  Platt-scale `combined_score` to win-probability per rank cohort.

**Harder:**
- One more post-pass to fail. Wrapped in try/except + Sentry capture
  so a ranking-pass failure doesn't fail the whole run; per-stock
  rows still committed correctly.
- Partial runs (single ticker, limited count) deliberately skip
  ranking — the rank wouldn't reflect the actual universe. The
  log makes the skip visible.
- Pre-migration rows have NULL ranks until they're backfilled
  by re-running the pipeline for that date. We don't auto-backfill
  historical rows — they're effectively stale for ranking
  purposes. A future cleanup script could re-rank historical days.

**Tradeoffs accepted:**
- Universe-wide ranks tie our conviction surface to the curated
  50-stock universe. If we ever ship multi-universe support (e.g.
  separate watchlists for tech vs financials), the ranking will
  need to scope per universe.
- The combined_score we rank by uses our specific weights (v1)
  and our specific bucket implementations — so ranks shift when
  the model evolves (e.g. after ADR 0013 social changes, after
  ADR 0014 vol normalization). The `weights_version` column on
  the same table provides the audit handle for "rank N as of
  weights v1" comparisons over time.

## Notes

This is the third P1 item from ADR 0011's analyst-review queue to
ship today (after ADR 0013 social bucket and ADR 0014 vol
normalization). The remaining items are: probability calibration
(needs ~300+ resolved verdicts), splitting short-horizon mean-
reversion from medium-horizon momentum in the technical bucket,
and an eventual UI surface for the conviction list.
