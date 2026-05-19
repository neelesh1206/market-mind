# ADR 0011 — Signal-quality P0 fixes (resolution window, PIT filter, weight renormalization)

**Status:** Accepted
**Date:** 2026-05-19

## Context

An end-to-end review of the signal engine (framed as a hedge-fund analyst
auditing the alpha model before allocating capital) surfaced three structural
issues that, individually, were each enough to invalidate any track-record
claim the product publishes. They share a single root cause: **the math was
implemented before the implications of *when* and *what* we were measuring
were fully worked out.**

### Issue 1 — outcome window did not match prediction window

The MarketMind verdict is computed at the 8 PM ET T-1 pipeline run on data
available at that moment. The resolution job (`pipeline/resolve_predictions.py`)
was scoring it against `open → close` on day T, which discards the overnight
gap — the period where most pre-open news, earnings reactions, and after-hours
flow get priced in. The verdict was being judged against an *intraday* move it
was not designed to predict, and the published accuracy number was a noisy
proxy for "MarketMind's call agreed with the intraday drift after the
gap-fill," not "MarketMind's call predicted the next-session direction."

User predictions are a different story (see ADR 0008): they can be placed up
to 1 PM ET on the trading day, so they *should* be scored against
`open → close` — that window matches the latest time at which a user could
have placed the bet.

### Issue 2 — no point-in-time discipline on news ingestion

`NewsArticle.published_at` is provided by the upstream sources (Massive,
Finnhub) and is occasionally either:

- **In the future** — publisher timestamp bugs / timezone errors. Trusting
  a future timestamp is technically look-ahead at the data layer.
- **Older than the recency-weighting cutoff** — these articles already get
  zero weight in `aggregate_sentiment`, but they still leak into
  `cross_source_agreement` counts and into the top-3 articles displayed on
  the stock card (sorted by `|sentiment|`, not recency).

Both cases polluted the sentiment bucket and the displayed evidence in ways
that didn't crash anything but quietly degraded signal quality.

### Issue 3 — None bucket scores silently coerced to zero

`compute_verdict` previously did `score = 0.0 if score is None else score`.
A missing bucket then contributed `weight × 0`, which looks harmless but is
not: a +0.4 technical score with no professional read got combined as
`0.30 × 0.4 + 0.30 × 0 = 0.12`, which fell below the `0.15` direction
threshold and produced NEUTRAL. The presence of *no evidence* on the
professional bucket was being treated as *evidence of zero* — a strong,
unintended bearish prior on every signal that lacked corroborating data.

## Decision

Three changes ship together. Each is small in isolation; together they make
the track-record metric defensible enough to publish without a footnote.

### 1. MarketMind verdict resolution: `prev_close → close`

`_resolve_marketmind` in `pipeline/resolve_predictions.py` now fetches the
previous trading day's close in addition to today's open/close, and scores
the verdict against `(prev_close, close)`. A new helper
`_fetch_mm_prices(ticker, target_date)` pulls a 10-calendar-day window and
returns the last two daily bars; if the previous bar isn't available
(insufficient history, or the supplied date is not actually a trading day)
the verdict is VOIDed.

The `marketmind_predictions.open_price` column continues to store the
session's actual open — the column name still means what it says, and the
display contract is preserved. The previous close used for outcome scoring
is logged at resolution time (`mm_resolve_scored ticker=X prev_close=Y
close=Z outcome=W`) but not yet persisted as a column; a dedicated
`reference_price` column is deferred to a later schema bump, to keep this
ADR's change set free of migration coordination.

`_evaluate` (user predictions) is unchanged: user bets still score
`open → close` per ADR 0008. The two paths are now distinguished:

| Path | Window | Where computed |
|---|---|---|
| MarketMind verdict (track record) | `prev_close → close` | `_outcome_against_reference` |
| User predictions (bet payouts) | `open → close` | `_evaluate` |

### 2. PIT filter for news

A new `_apply_pit_filter` runs in `pipeline/fetch_insights.py` immediately
after the news fetch and before FinBERT, sources_agree, or top-3 display.
It drops articles whose `published_at` is:

- After `now() + PIT_FUTURE_TOLERANCE` (15 min, to absorb clock skew), OR
- Before `now() - PIT_MAX_AGE_DAYS` (7 days, the existing recency floor).

Articles with `published_at = None` are kept (we cannot classify them and
the upstream fetchers do their own sanity filtering). Per-ticker drop
counts are logged so we can spot a misbehaving publisher.

### 3. Weight renormalization over present buckets

`compute_verdict` now excludes `None` buckets entirely and renormalizes the
remaining weights over `total_weight = sum(WEIGHTS_V1[k] for k in present)`.
A single +0.4 technical with everything else missing now produces
`combined = 0.4` and a directional UP call. All-missing returns
`Verdict(direction="NEUTRAL", confidence=0.0)`.

Test coverage lives in `pipeline/tests/test_verdict.py` and explicitly
encodes the regression cases that motivated the change (one/two/three
present buckets, threshold boundary, all-None safe default).

## Alternatives considered

- **Add a new `reference_price` column to `marketmind_predictions`** instead
  of relying on the resolution log for prev_close. The right long-term
  answer, deferred to avoid coordinating a schema change with concurrent
  UI work. When it lands the migration is one column + a backfill from
  yfinance for already-resolved rows.

- **Filter news only on the future-dated case; leave staleness alone.** The
  recency weighting in `aggregate_sentiment` does already zero out stale
  articles for the sentiment math, so this is defensible in narrow scope.
  Rejected because stale articles still leaked into the displayed top-3
  (sorted by absolute sentiment magnitude, not by recency) and into
  `cross_source_agreement` counts — both reach the user.

- **Apply Bayesian shrinkage to a sector prior when buckets are missing**
  instead of pure renormalization. Theoretically more honest (a missing
  bucket should pull toward the prior, not toward the surviving buckets'
  mean), but requires a prior we don't yet have. Renormalization is the
  zero-prior special case; we can layer shrinkage on later without
  re-litigating this ADR.

- **Score MarketMind verdicts against `prev_close → close` AND user bets
  against `prev_close → close` for consistency.** Rejected because ADR
  0008 deliberately set user-bet scoring to match the bet-locking time
  (1 PM ET), which is informationally closer to `open` than `prev_close`.
  Keeping the two paths separate is the right answer; the change here is
  to make the MM path match the *prediction* time, not to homogenize.

## Consequences

**Easier:**

- The published track record now measures what the verdict actually
  predicts. When we ship more honest backtests in P2/P3, they'll be
  directly comparable to the live accuracy number.
- One less "yes but actually..." footnote on the methodology page.
- Single-bucket signals (often the case for less-covered tickers where
  Finnhub or social data is missing) now make calls instead of getting
  silently neutralized.

**Harder:**

- Two resolution paths in the same job (verdict path uses prev_close;
  user-bet path uses open). The split is documented in
  `_resolve_marketmind`'s docstring and surfaces clearly via the named
  helpers (`_outcome_against_reference` vs `_evaluate`).
- Renormalization makes verdicts on partial data swing harder. A
  single-bucket score of +0.5 used to dilute to confidence 0.15 and
  produce UP at the margin; it now produces UP with confidence 0.5. This
  is more honest but might surprise users who anchored on the previous
  numerical scale. The About page formula block is updated to reflect
  the new behavior.

**Tradeoffs accepted:**

- Prev-close is not persisted on the verdict row yet (deferred to a
  schema migration). The audit trail lives in the resolution log until
  then.
- The renormalization treats absent evidence as equivalent to "trust the
  remaining buckets as if they were the full picture." A Bayesian-prior
  approach is more rigorous; we accept the simpler version pending
  enough resolved verdicts to estimate the prior empirically.

## Notes

The motivating analysis (a deeper review of signal engineering issues
including vol normalization, regime awareness, cross-sectional ranking,
calibration, and inverted social signal) identified additional P1 and P2
work that requires schema changes or new product surfaces. Those are
intentionally out of scope for this ADR — the three changes here are the
ones that could ship without coordinating a migration or touching the UI.
