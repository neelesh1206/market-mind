# ADR 0014 — Vol-normalize the verdict's direction threshold

**Status:** Accepted
**Date:** 2026-05-19

## Context

ADR 0011's analyst review flagged the absence of volatility normalization
as a P1 issue. The earlier code applied the same `DIRECTION_THRESHOLD =
0.15` to every stock when deciding whether a combined bucket score was
strong enough to flip directional (UP/DOWN) vs NEUTRAL.

The problem this creates: a `combined = +0.20` score on NVDA (daily
realized vol ≈ 3.5%) is informationally very different from `+0.20` on
PG (daily vol ≈ 0.9%). NVDA's day-to-day noise routinely produces
larger signal artifacts — a +0.20 from RSI / MACD / mention-deltas
could plausibly emerge from random walk on that name. PG's same +0.20
is much less likely to be noise because PG itself barely moves
day-to-day; the bucket scores reaching that magnitude on a quiet stock
is a stronger statement.

For a binary directional bet, what matters is **signal-to-noise**, not
just absolute score magnitude. The flat threshold was implicitly
under-calling the quiet stocks and over-calling the noisy ones.

The fix lives at the right layer: not in any individual bucket scorer
(those continue to do what they do — RSI is RSI, FinBERT is FinBERT)
but in the *meta* decision about when the aggregate signal is strong
enough to claim direction. That's `compute_verdict`'s job.

## Decision

Add a `realized_vol_20d` parameter to `compute_verdict`. It's the
20-day realized vol (stddev of daily returns), expressed as a decimal
(0.035 = 3.5% daily). Compute it in
`YFinancePriceFetcher._build_snapshot` from the same 1-year OHLCV
dataframe already pulled for the technical indicators — no extra
network calls.

The threshold is then scaled per-stock:

```python
REFERENCE_VOL = 0.02
VOL_FACTOR_MIN = 0.5
VOL_FACTOR_MAX = 2.5

def _vol_factor(realized_vol_20d):
    if realized_vol_20d is None or realized_vol_20d <= 0:
        return 1.0   # fall back to flat threshold — no regression
    raw = realized_vol_20d / REFERENCE_VOL
    return clamp(raw, VOL_FACTOR_MIN, VOL_FACTOR_MAX)

adjusted_threshold = DIRECTION_THRESHOLD * vol_factor
```

Worked examples on the current universe:

| Ticker | Daily σ | `vol_factor` | Threshold |
|---|---|---|---|
| PG (low vol) | ≈ 0.9% | 0.5 (clamped) | 0.075 |
| MSFT (typical) | ≈ 1.6% | 0.8 | 0.12 |
| AAPL (typical) | ≈ 2.0% | 1.0 | 0.15 |
| NVDA (volatile) | ≈ 3.5% | 1.75 | 0.26 |
| COIN (very volatile) | ≈ 5.0% | 2.5 (clamped) | 0.375 |

`Verdict` carries the actual applied `vol_factor` and `adjusted_threshold`
on the row so resolved-prediction analysis can attribute outcomes to a
specific threshold cohort (the `weights_version` column captures the
*weights*; these two new fields capture the *threshold scaling*). The
log line at end of stock processing also emits these for run-time visibility.

### Why a fixed reference vol instead of universe-median

`REFERENCE_VOL = 0.02` is hard-coded as a stable prior. The alternative
is to compute the median across the day's universe and scale relative
to that. We rejected this because:

1. The universe is curated (50 stocks); when the universe changes — adding
   or dropping tickers — every stock's threshold would shift, even though
   nothing about that stock changed. That's not a property we want.
2. The median fluctuates day-to-day with market regime (VIX spikes lift
   everyone), which we'd be embedding into the threshold rather than
   *expressing* in a separate regime layer. A regime layer is a separate
   P2 item.
3. 2% is empirically close to the median large-cap daily vol over the
   last decade. Future retuning is one constant change away.

### Why clamp factor at [0.5, 2.5]

Without clamping, a freshly-IPO'd ticker with three days of available
data might compute a 12% realized vol and get a 9× threshold — pushing
its score above virtually any plausible aggregate. Conversely, a halted
or stalled ticker could compute near-zero vol and get an 0.01× threshold
where any non-zero signal flips directional.

The clamp keeps the adjustment within a sensible range without
hand-coding ticker-specific exceptions. The range (0.5×, 2.5×) is
heuristic — picked to cover the natural vol range of large-cap equities
(roughly 0.7% to 5%) without going wild on outliers.

## Alternatives considered

- **Vol-scale the bucket scores themselves**, not the threshold. E.g.
  multiply `technical` by `1 / vol_factor`. Rejected because (a) it
  conflates two different fixes — bucket-level vol adjustment is its own
  call, and (b) it produces inconsistent confidence numbers between
  stocks (a +0.10 technical on PG would report as +0.20 after scaling,
  which is confusing to display).

- **Vol-scale only the technical bucket**, since vol is most relevant
  to price-driven signals. Rejected — the *aggregate* call is what
  matters for the threshold decision, and analyst / insider / social
  bucket noise is also vol-correlated for the same name.

- **Use implied vol (options-derived)** instead of realized vol. More
  forward-looking but requires options chain data we don't have on
  Starter tier. Realized vol is a defensible proxy until/unless we
  upgrade.

- **Make the threshold a function of confidence instead of vol** (i.e.,
  high-magnitude signals get an automatic pass). Already implicit in
  the threshold-vs-magnitude comparison; vol normalization is the
  *orthogonal* axis to this.

- **Store the vol factor in a new column on `marketmind_predictions`**
  for first-class audit. Would require a migration. Deferred — for now,
  the value lives on the `Verdict` dataclass at compute time and gets
  logged. When we add a `model_meta` JSONB column for these audit
  fields, the vol stuff joins it.

## Consequences

**Easier:**
- Quiet stocks (PG, KO, T) will call directional more often — when our
  4 signals agree even mildly, that's now considered actionable. Prior
  code under-called these.
- Noisy stocks (NVDA, COIN, RIVN, GME) will call directional less
  often — same magnitude of signal is treated as more likely to be
  noise. Prior code over-called these. Aligns with the intuition that
  predicting NVDA's daily direction is genuinely hard.
- The implementation cost is roughly 20 lines of code; the audit trail
  cost is one log line + two extra fields on the in-memory `Verdict`.

**Harder:**
- The verdict can flip vs prior-code behavior on stocks whose factor is
  far from 1.0. Pre-2026-05-19 `marketmind_predictions` rows are now
  on a different threshold than post-rows; resolved-accuracy comparisons
  across that boundary aren't apples-to-apples. The `weights_version`
  column captures part of this; future schema work could add an explicit
  `threshold_version` for full disambiguation.
- A small handful of low-vol stocks now sit closer to the directional
  edge — when we ship calibration (Platt scaling) later, we'll need to
  re-fit per vol bucket since the cohorts have systematically different
  threshold cohorts.

**Tradeoffs accepted:**
- The fixed reference vol (2%) and clamp range ([0.5, 2.5]) are
  heuristic. Better than a flat 0.15 for every ticker, worse than an
  empirical universe-conditional fit. We will retune once track-record
  data permits.

## Notes

This is the second free-improvement item from ADR 0011's analyst-review
follow-up (the first was ADR 0013 — social bucket fade). Remaining
items in the queue: cross-sectional ranking (requires schema +
coordinated UI surface), splitting short-horizon reversal from
medium-horizon momentum in the technical bucket, and probability
calibration. None of those require subscriptions.
