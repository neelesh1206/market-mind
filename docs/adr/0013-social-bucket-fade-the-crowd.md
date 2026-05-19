# ADR 0013 — Social bucket: fade the crowd, weight informed sentiment

**Status:** Accepted
**Date:** 2026-05-19

## Context

The signal review (ADR 0011 motivation) flagged the social bucket as
the most clearly *miscalibrated* part of the model: a sign-error
relative to the academic literature on retail attention.

The prior implementation in `pipeline/processors/aggregator.py::social_score`
treated every positive social signal as bullish:

```python
if s.reddit_mention_delta > 200:  score += 0.5
if s.apewisdom_rank <= 10:        score += 0.3
score += (s.stocktwits_bullish - 50) / 100
```

The reasoning would have been: *"if retail traders are excited about
the stock, the stock should go up."* This is not what the empirical
literature finds for non-meme single names.

The relevant papers:

- **Barber & Odean (2008), "All That Glitters: The Effect of Attention
  and News on the Buying Behavior of Individual and Institutional
  Investors."** Retail investors are net buyers of attention-grabbing
  stocks (extreme returns, abnormal volume, news mentions). The
  *subsequent* returns on those stocks underperform, consistent with
  retail-driven price pressure pushing prices above fundamental value.

- **Da, Engelberg & Gao (2011), "In Search of Attention."** Direct
  measurement using Google search volume: attention spikes predict
  positive returns over the next 1-2 weeks (the buying pressure
  arriving) followed by *reversals* and underperformance over the
  following months. For a daily prediction horizon the dominant
  observable effect is the reversal portion, not the brief initial
  push.

- Subsequent literature (Engelberg-Sasseville-Williams 2012;
  Gao-Ren-Zhang 2020) is consistent in the cross-section: attention
  is a fade signal for non-meme equities once the news that caused
  the attention is already priced.

Two structurally different things were being conflated:

1. **Herding** — abnormal mention spikes (Reddit delta > 200%),
   top-of-WSB rank, viral attention. These almost always *follow*
   the news; latecomers add buying pressure that mean-reverts.

2. **Informed sentiment** — StockTwits bullish ratio at *normal*
   discussion volume. A 60% bullish ratio with 50 messages is a
   meaningful directional read; the same ratio with 5,000 messages
   is just the meme tide.

The old code applied the same positive sign to both.

## Decision

Rewrite `social_score` to make the two components explicit and signed
correctly. The new logic:

### 1. Herding component (Reddit delta + ApeWisdom rank)

Contributes NEGATIVELY to the score, with magnitude scaling on intensity.
Also produces a 0..1 `herding_intensity` that gates the directional
component.

| Trigger | Score contribution | `herding_intensity` |
|---|---|---|
| Reddit mention delta > 500% | −0.4 | 0.9 |
| Reddit mention delta > 200% | −0.2 | 0.6 |
| Reddit mention delta < −50% | +0.1 | — |
| ApeWisdom rank ≤ 3 | −0.3 | 1.0 |
| ApeWisdom rank ≤ 10 | −0.15 | 0.7 |
| ApeWisdom rank 11-25 | — | 0.4 |

The mild positive when reddit delta is strongly negative captures
"crowd losing interest" — a modest tailwind for fundamentals-driven
holders when attention had been masking the signal.

### 2. Informed sentiment component (StockTwits bullish ratio)

Directional in sign, but **volume-damped** (the ratio degrades to
crowd noise as message count rises) and **herding-damped** (when
herding intensity is high, even a non-loud StockTwits ratio is
suspect because the same people may be cross-posting).

```
bullish_signal = (stocktwits_bullish_pct − 50) / 100   # -0.5..+0.5

volume_weight =
    0.3 if messages > 2000      # viral
    0.7 if messages > 500       # active discussion
    1.0 otherwise               # quiet conviction

herding_damping = max(0, 1 − 0.7 × herding_intensity)  # 1.0 → 0.3

score += bullish_signal × volume_weight × herding_damping
```

### What we explicitly did NOT do: invert the StockTwits sign at peak herding

A more aggressive design would *invert* the StockTwits contribution
when herding intensity is at 1.0 — "everyone's bullish on the same
ticker" becomes itself a fade signal. The literature partially
supports this but the magnitude is uncertain and the sign-flip is
sharp enough to mask other parts of the model when it fires. We
chose to damp toward zero instead. Reconsider inversion if and when
we have enough resolved verdicts to estimate the empirical lift.

## Alternatives considered

- **Drop the social bucket entirely.** Defensible — if a bucket has
  the wrong sign on net, zero is better than negative weight on
  truth. Rejected because the informed-sentiment component has
  real (modest) directional value at low message volume, and
  dropping the bucket would also remove information about *attention
  state* which is useful as a confidence modulator.

- **Apply the inversion only at extreme thresholds.** Hybrid of the
  damp-only approach and full inversion. More complex without clear
  empirical justification for where the threshold should sit.
  Defer until track-record data accumulates.

- **Keep the old sign but reduce the bucket weight in the verdict
  from 0.15 → 0.05.** Treats the symptom, not the cause. Rejected
  because the *direction* was wrong; reducing magnitude only mutes
  the bug.

- **Use Google Trends as the attention proxy instead of Reddit.**
  Da-Engelberg-Gao actually use Google search volume. Our pipeline
  has a `google_trend_score` field already (currently unwired). When
  the wiring lands, this can supplement or replace Reddit delta —
  but Google Trends has its own quirks (daily aggregation, sample
  variance, no per-stock guarantee) and Reddit delta is sufficient
  for now.

## Consequences

**Easier:**
- Verdicts on attention-spiked meme tickers will swing toward
  bearish/neutral instead of bullish. Better aligned with the
  literature; we expect modest accuracy improvement.
- The bucket's two intentions (herding vs informed) are now visible
  in the `breakdown.social` JSON (`herding_intensity`,
  `herding_damping`, `stocktwits_volume_weight`), so future tuning
  has an audit trail.

**Harder:**
- Old `marketmind_predictions` rows used the prior implementation;
  pre- vs post-2026-05-19 accuracy aren't strictly comparable.
  This is the second time we've made a change of this kind (ADR
  0011 was the first); the resolution job's `weights_version`
  column captures the model lineage, and the social bucket change
  is now identifiable by `weights_version >= v1` together with
  the ADR date.
- Magnitudes for herding penalties (-0.4 / -0.2 / -0.3 / -0.15) are
  heuristic. They're picked to be similar in scale to the old
  positive contributions so the bucket retains comparable
  expressiveness, but they should be retuned against resolved-verdict
  data once we have a few hundred rows.

**Tradeoffs accepted:**
- The model is now actively contrarian on retail-attention spikes.
  Occasional meme rallies will have us calling DOWN when the
  ticker continues UP for a few more days; we accept this as the
  natural noise around a positive-edge signal, not a bug.

## Notes

This is a "free" model-quality improvement in the sense that it
costs nothing in dependencies or infrastructure — it's a 60-line
change in `aggregator.py` — but it's the highest-leverage free
fix on the table because it corrects a sign error rather than
just refining a magnitude. Future P1 items in the same vein
(volatility normalization, cross-sectional ranking, splitting
short-horizon reversal from medium-horizon momentum in the technical
bucket) are listed in ADR 0011's notes.
