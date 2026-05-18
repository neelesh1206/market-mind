# ADR 0003 — No UP/DOWN verdict, show signals only

**Status:** Accepted
**Date:** 2026-05-18

## Context

MarketMind aggregates 4 signal buckets (technical, sentiment, professional, social) for each stock. The natural product instinct is to combine them into a single verdict — "UP, HIGH confidence" — and show that as the primary call-to-action on each stock card.

There are real reasons not to:

1. **Homogenizes user behavior.** If MarketMind says "UP, HIGH confidence" on NVDA, 80%+ of users will bet UP. The platform is now just betting on its own accuracy, which kills the prediction-market dynamic.
2. **Looks like investment advice.** Even with virtual currency, a confidence-scored directional call positions the app as a robo-advisor. That has compliance and trust implications.
3. **Reduces perceived insight value.** A black-box verdict hides the data. Users skim the verdict and skip the breakdown. The data feels less valuable because they don't engage with it.
4. **Requires validated backtesting.** Showing "HIGH confidence" creates an accuracy expectation. Without a backtest harness validating the engine, the claim is irresponsible.

## Decision

The MVP shows **four bucket scores** (technical, sentiment, professional, social) on a -1 to +1 scale, with source attribution and cross-source agreement counters. **No combined verdict, no confidence label, no recommendation text.**

Users interpret the signals themselves. Their bet is their interpretation.

The verdict may return post-MVP after a backtest harness validates accuracy and the language can be calibrated honestly (e.g., "Our engine historically gets calls like this right 62% of the time").

## Alternatives considered

- **Show verdict + breakdown**: still homogenizes behavior. The breakdown becomes vestigial.
- **Show verdict, hide breakdown**: even worse — pure black-box advice positioning.
- **Show breakdown + computed direction score**: this is just the verdict with a different label. Users will treat any aggregate as a recommendation.
- **Defer all signals to a stock detail page, show only price on cards**: undersells the differentiator. The signal breakdown *is* the product.

## Consequences

**Easier:**
- Trust UI patterns (cross-source agreement, source attribution, methodology page) become the focus instead of fighting against a verdict
- No accuracy claims to defend
- Lower legal/positioning risk
- The product feels more like a Bloomberg terminal than a Robinhood — premium positioning

**Harder:**
- Some users will find the breakdown overwhelming and want a single answer
- "Did MarketMind predict X correctly?" becomes a harder question (it didn't predict — it presented data)
- Marketing-friendly stats are harder to compute

**Tradeoffs accepted:**
- Lower friction onboarding (verdict-driven) traded for higher data engagement and lower compliance surface
- "MarketMind's Call" feature deferred to post-backtest validation (Week 3+ at earliest)
