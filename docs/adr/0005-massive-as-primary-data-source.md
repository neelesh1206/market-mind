# ADR 0005 — Massive (formerly Polygon.io) as primary paid data source

**Status:** Accepted
**Date:** 2026-05-18

## Context

The pipeline needs reliable, professional-grade market data: real-time-ish prices, OHLCV history, technical indicators, and news headlines. Multiple options exist at the $20-50/mo entry tier:

- Polygon.io / Massive (rebranded in 2025/2026)
- Alpha Vantage Premium
- Finnhub Personal
- IEX Cloud
- Tiingo

Each has strengths and weaknesses. Some are stronger on news, some on historical depth, some on real-time feeds. Picking one means accepting tradeoffs.

The temptation is to fan out across 3-4 cheap sources for "more data." That instinct is wrong: **reliability of core data matters more than quantity**. A few flaky sources is worse than one solid one.

## Decision

Use **Massive Stocks Starter ($29/mo)** as the primary paid data source for:
- Real-time / 15-min delayed prices and OHLCV
- Technical indicators (RSI, MACD, moving averages, Bollinger Bands)
- Aggregated news headlines
- All US exchanges including dark pools and OTC

Free sources fill remaining gaps:
- Finnhub Free — earnings calendar, analyst consensus
- SEC EDGAR — insider Form 4, 8-K material events (official)
- StockTwits API — bullish/bearish ratio
- Reddit API + ApeWisdom — social sentiment
- FRED API — macro context (VIX, treasury yields)
- yfinance — fallback prices if Massive fails

Net: 10+ sources, one of which is the reliable foundation.

## Alternatives considered

- **Multiple paid sources** (Massive + Benzinga + Marketaux): ~$250/mo. Higher source diversity but disproportionate cost for a portfolio project.
- **Free-only stack** (yfinance + Finnhub + Tiingo free): viable but fragile. yfinance is unofficial and breaks periodically. Hitting rate limits across multiple free tiers requires careful queue management.
- **Alpha Vantage Premium**: $50/mo, weaker news API than Massive.
- **Finnhub Personal**: $30/mo, smaller universe coverage than Massive.

## Consequences

**Easier:**
- Prices, technicals, and news come from one API with one rate limit budget
- Quality of the foundational data is professional-grade (used by hedge funds)
- News API includes article URLs, allowing follow-on FinBERT processing of full text where licensing permits

**Harder:**
- Vendor lock-in for the most-rendered data on every screen
- If Massive has an outage, the pipeline degrades to free sources (yfinance) which are less reliable
- Rate limits on Starter tier require batched requests (mitigated by 50-stock scope)

**Tradeoffs accepted:**
- Single point of partial failure for core data (mitigated by yfinance fallback path)
- $29/mo recurring cost for what could otherwise be free (worth it for reliability)
- Massive rebrand from Polygon.io means some older documentation/StackOverflow answers reference the old name (minor friction)

## Notes

Polygon.io rebranded to Massive in 2025/2026. The domain `polygon.io` now 301-redirects to `massive.com`. The Starter tier price ($29) and feature set remain unchanged.
