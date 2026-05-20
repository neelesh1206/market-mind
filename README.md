# MarketMind

> Multi-source stock intelligence platform with daily prediction mechanic.
> 50 curated stocks · 10+ data sources · real signal breakdown · gamified daily ritual.

🔗 **Live:** [marketmind.neeleshkakaraparthi.dev](https://marketmind.neeleshkakaraparthi.dev) *(coming soon)*
📖 **Case study:** [docs/CASE_STUDY.md](docs/CASE_STUDY.md)
🏗️ **Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## What it does

MarketMind is a daily stock prediction game built on top of a transparent signal engine.

Every weeknight at 8 PM ET, a Python pipeline runs on GitHub Actions and behaves like a research analyst: it visits **~10 data sources** for each of 50 curated stocks, scores everything it finds into four signal buckets per stock, and produces a single UP/DOWN/NEUTRAL verdict with a one-sentence explanation. The next morning users open the app, see the signals + verdict, and place a virtual-credit bet before the window locks at 1 PM ET. At 4:15 PM the resolution job scores everyone's bets — and MarketMind's own call — against the day's close.

The app itself never calls the data sources. The pipeline is the *producer*, the database (Supabase) is the *contract*, the website is the *consumer*.

### What goes into a single stock's daily reading

| Bucket | Where the data comes from | What gets computed |
|---|---|---|
| **Technical** | yfinance OHLCV | RSI, MACD crossover, distance from 20/50-day moving averages, Bollinger position, volume trend |
| **Sentiment** | Massive news API + FinBERT on HuggingFace | Per-article sentiment classification, recency-weighted into a single score, cross-source agreement counter |
| **Professional** | Finnhub (analysts) + SEC EDGAR (insiders, 8-Ks) | Buy/hold/sell consensus, recent rating changes, insider transaction direction, earnings proximity |
| **Social** | StockTwits + ApeWisdom + Reddit | Bullish ratio, mention deltas, retail attention rank |

Each bucket is normalized to `[−1, +1]`. The verdict is a weighted average; the exact formula and weights live in [`pipeline/processors/verdict.py`](pipeline/processors/verdict.py). Macro context (VIX, sector ETFs from FRED) is fetched once per run and stored alongside.

### Two AI models do the parts math can't

- **[FinBERT](https://huggingface.co/ProsusAI/finbert)** reads each news article and labels it positive / neutral / negative. We use it instead of keyword matching because financial language depends on context — *"raised guidance"* is bullish, but *"raised concerns"* is bearish. FinBERT runs **locally on the pipeline runner** via `transformers` + CPU-only `torch` — no network round-trips per article, no shared rate limits.
- **Llama-3 / Mistral** turns the verdict + bucket scores into the one-sentence English explanation under the verdict chip — *"Bullish — driven by strong analyst upgrades and a constructive technical setup."* This still runs on HuggingFace's Inference API because 7B-param models don't fit on a free CI runner. A shared circuit breaker short-circuits to the rule-based fallback after N consecutive HF failures, so an HF outage caps the cost at a handful of calls instead of bleeding the whole run.

If either model fails, the numerical signal is never blocked. Sentiment falls back to whichever articles did score, verdict reasoning falls back to a deterministic template.

### Track record is public

MarketMind's own daily calls live in `marketmind_predictions` and are resolved at market close every day. Cumulative accuracy is shown on `/about` with sample size — small N is noisy, so the denominator is always visible alongside the percentage.

### Live prices on top of pipeline insights

The signal pipeline runs once a night, so its `prev_close` snapshot is correct but stale by intraday standards. To keep the UI honest during market hours, each stock card and detail page also fetches a **real-time quote from Finnhub** (free-tier `/quote` endpoint, US equities, no delay). The quote is cached in **Upstash Redis** with a 5-minute TTL — see [How we use the cache](#how-we-use-the-cache) — so 50 stocks × N users still cost at most ~10 Finnhub calls/minute globally, well under the free-tier 60/min limit. When Finnhub or Redis is down, the UI degrades to the pipeline's `prev_close` instead of crashing.

Built as a portfolio project demonstrating: data pipelines, financial NLP, real-time-ish UX, animation craft, and enterprise-grade engineering practices.

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 15 (App Router), TypeScript strict, Tailwind, shadcn/ui, Framer Motion |
| Backend | Supabase (Postgres + Auth + RLS) |
| Cache | Upstash Redis |
| Pipeline | Python in GitHub Actions |
| Stock data — historical | Massive (formerly Polygon.io) Stocks Starter — daily aggregates, news |
| Stock data — live quotes | Finnhub free tier — real-time US equity prices (60/min) |
| NLP | FinBERT + Llama-3 via HuggingFace Pro |
| Observability | Sentry + PostHog |
| Hosting | Vercel (Hobby) |

**Monthly cost: ~$38** ([cost breakdown](docs/ARCHITECTURE.md#cost))

## How we use the cache

[Upstash Redis](https://upstash.com) is a serverless, HTTP-API Redis. We use it for two unrelated workloads that share the same connection — one secret, one set of env vars, two distinct key prefixes so there's never a collision:

### 1. Per-user rate limiting on mutations — prefix `mm:rl:*`

Every mutation server action (`placeBet`, `cancelBet`, `claimDailyBonus`, `watchlist` toggles) gates on a sliding-window limiter (`@upstash/ratelimit`) before touching the database. The limits are conservative — 10 bets/min, 3 daily-claim attempts/min, 20 watchlist toggles/min — and exist to make "runaway useEffect" or "stale fetch on a tap" non-destructive, not to enforce business logic (the RPCs themselves have stronger invariants). Implementation in [`src/lib/rate-limit.ts`](src/lib/rate-limit.ts).

**Fail-open by design**: when Redis is unconfigured (local dev) or unreachable (network blip), `rateLimit()` returns `{ ok: true }` and the action proceeds. A misconfigured cache should never lock everyone out of the app.

### 2. Shared live-price cache — prefix `mm:price:*`

The home feed and stock detail page each call `getLivePrices(tickers[])` which:

1. **`MGET`** all tickers' cache keys in a single Redis round-trip
2. For misses, fetches Finnhub's `/quote` endpoint in parallel via `Promise.allSettled` (one bad ticker can't break the page)
3. Writes fresh values back with **300s TTL for successful quotes**, **60s TTL for nulls** (negative cache stops us hammering a temporarily-failing ticker without committing a 5-min black mark)

Implementation in [`src/lib/live-prices.ts`](src/lib/live-prices.ts).

**Why shared Redis instead of Next's `unstable_cache`:** Vercel runs each request on potentially a different function instance, each with its own in-memory cache. With per-instance caches, 50 stocks × N cold-started instances would multiply Finnhub calls past the 60/min free-tier limit. A shared global cache gives us **O(stocks / TTL) calls per minute regardless of user count** — ~10/min worst case at our 50-stock universe + 5-min TTL.

**Failure modes, all graceful**: no Upstash creds → direct Finnhub on every request (works, slow); no Finnhub key → all-null responses (UI shows "—"); Finnhub 4xx/5xx/timeout → cached null entry; Redis network blip → fall through to direct Finnhub.

### Footprint

- **One Upstash database**, region matched to Vercel's primary deploy region (~5ms median read)
- **Free tier covers it**: 10k commands/day, 256 MB. Our actual draw: ~3k commands/day at current traffic, ~2 MB used
- **No persistence needed**: rate-limit counters expire naturally, price cache is short-TTL — losing the entire DB just means one slow page load while we re-fetch

## Quick start

See [docs/SETUP.md](docs/SETUP.md) for the full setup walkthrough including:
- Local development environment
- Supabase project creation
- API keys and secrets
- Running the pipeline locally
- Deploying to Vercel

## Documentation map

| Doc | Purpose |
|-----|---------|
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Master build plan, schema, signal engine, day-by-day execution |
| [CHANGELOG.md](CHANGELOG.md) | Feature-by-feature shipping log |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | High-level architecture, diagrams, data flow |
| [docs/CASE_STUDY.md](docs/CASE_STUDY.md) | Portfolio narrative — design choices, tradeoffs, lessons |
| [docs/SETUP.md](docs/SETUP.md) | Manual setup steps, env vars, third-party config |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Vercel deploy walkthrough, env vars, OAuth wiring, smoke checklist |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Ops procedures: re-run pipeline, debug failures, rotate keys |
| [docs/adr/](docs/adr/) | Architecture Decision Records — one decision per file |

## Documentation discipline

Every shipped feature updates:
1. **CHANGELOG.md** with a one-line entry
2. **README.md** if setup or capability changed
3. **docs/adr/** if a design choice was made

Every manual step encountered updates **docs/SETUP.md** or **docs/RUNBOOK.md**.

This is enforced as a rule for this project — see [docs/adr/0001-documentation-as-rule.md](docs/adr/0001-documentation-as-rule.md).

## Disclaimer

> MarketMind is for educational and entertainment purposes only. Signals shown are derived from public market data and do not constitute investment advice. All bets use virtual credits with no real-money value.

## License

MIT
