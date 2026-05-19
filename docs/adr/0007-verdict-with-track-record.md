# ADR 0007 — Verdict with published track record (supersedes 0003)

**Status:** Accepted
**Date:** 2026-05-19
**Supersedes:** [ADR 0003 — No aggregate verdict, show signals only](0003-no-aggregate-verdict.md)

## Context

ADR 0003 (May 2026) committed to *not* showing a single UP/DOWN verdict. The reasoning at the time was sound:

1. Without a backtest, claiming "HIGH confidence UP" would be irresponsible
2. A verdict could homogenize all user bets (kills the prediction-market dynamic)
3. Looks like investment advice / robo-advisor positioning
4. Hides the data behind a black box

After running the product for one day with the no-verdict approach, two problems emerged:

- **The app feels like a dashboard, not an intelligence layer.** Users open it, see numbers, and ask "OK so what do you think?" The signals tell you *what's true*; users still want to know *what we think happens next*.
- **The original concerns assumed we'd never have accuracy data.** That assumption is wrong — we have a resolution job that can score MarketMind's calls daily, building a real track record over time.

The honest version of a verdict is **a prediction published alongside its track record.** If we say "MarketMind predicts UP" and also publish "MarketMind has been right 62% of the time over the last 30 days," users can calibrate their trust appropriately.

## Decision

MarketMind will publish a per-stock daily verdict (`UP` / `DOWN` / `NEUTRAL`) with a confidence score and a 1-sentence reasoning. The verdict is computed alongside the four signal buckets and stored in a new `marketmind_predictions` table. The resolution job evaluates it at market close exactly like a user prediction.

Track record is **always shown with sample size** ("3/5 correct so far") so users can see when we're in low-sample-noise territory. As more days accumulate, the number becomes more credible.

### Verdict computation

Weighted sum of the 4 bucket scores:

```
combined_score = 0.30 * technical
               + 0.25 * sentiment
               + 0.30 * professional
               + 0.15 * social

direction = "UP"      if combined_score >  0.15
          | "DOWN"    if combined_score < -0.15
          | "NEUTRAL" otherwise

confidence = clamp(abs(combined_score), 0, 1)
```

Initial weights are heuristic — biased slightly toward technical + professional because those are the most-cited signals in equity research. We'll tune them based on which combinations correlate with WIN outcomes as track record accumulates.

The weights are versioned in the row (`weights_version` column) so we can compare cohorts after retuning.

### Reasoning generation

Llama-3 (already in the pipeline for article TL;DRs) generates a 1-sentence reasoning from the top 2 highest-magnitude buckets:

> "Bullish on strong analyst upgrades and a constructive technical setup ahead of next-week's earnings."

This is the human-readable layer over the math — not a separate model.

### Resolution

The existing `resolve_predictions.py` job already fetches the day bar per ticker. It now also iterates `marketmind_predictions` for the same `prediction_date` and applies the same WIN/LOSS/VOID logic.

### Display rules (the new contract)

1. **Signals are still the hero.** The 4 SignalBars remain the primary content on every card.
2. **Verdict sits in a labeled chip** at the top of each card: "🎯 MarketMind's read: UP · 64% confidence".
3. **Reasoning is one sentence**, shown on hover or below the chip.
4. **Track record is always visible** on `/about` and adjacent to the verdict chip: "Right 18 of 27 days · 67%".
5. **NEUTRAL is a legitimate verdict.** When signals are mixed we say so — "MarketMind doesn't have a clear read today."

## Alternatives considered

- **Keep ADR 0003 unchanged.** Stay defensive about claims. Rejected: the app loses meaningful value, users perceive it as "just data without conclusions."
- **Show verdict but hide track record.** Common in robo-advisor apps. Rejected: opaque, exactly the thing ADR 0003 was right to want to avoid.
- **Only show verdict on the stock detail page, not on cards.** Less prominent but more accurate to the "users have to read the details" philosophy. Rejected: friction kills it; if it's worth showing, surface it where users look first.
- **Compute verdict client-side from already-stored bucket scores.** Saves a column. Rejected: we need to freeze the weights at prediction time for accuracy comparison.

## Consequences

**Easier:**
- Product has a clear value proposition again ("predict the market")
- Track record becomes a daily-updating credibility metric
- We can A/B-test different weight schemes by versioning the row
- Real backtest emerges naturally from production resolutions

**Harder:**
- Schema needs a new table + migration
- Resolution job grows in scope (still small)
- Have to be careful with track-record presentation early on (small sample sizes are noisy — "Always show with N" mitigates)
- Users may anchor on early lucky-streak accuracy or get discouraged by early bad luck

**Tradeoffs accepted:**
- Verdict-driven UI in exchange for higher product clarity
- Honest "we got it wrong N times" instead of safe silence
- More moving parts in the pipeline for a feature that defines the app's value proposition

## Notes

This ADR explicitly supersedes 0003. The original ADR file is preserved in the repo (not deleted) — design history is part of the story. Future readers should see both ADRs in sequence to understand the evolution.
