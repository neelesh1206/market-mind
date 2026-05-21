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
| **Sentiment** | Massive news API + FinBERT on HuggingFace + Polygon per-ticker insights | Articles pre-filtered by Polygon's per-ticker relevance signal at fetch, FinBERT classification blended with Polygon's categorical sentiment, recency-weighted into a single score, cross-source agreement counter |
| **Professional** | Finnhub (analysts) + SEC EDGAR (insiders, 8-Ks) | Buy/hold/sell consensus, recent rating changes, insider transaction direction, earnings proximity |
| **Social** | StockTwits + ApeWisdom + Reddit | Bullish ratio, mention deltas, retail attention rank |

Each bucket is normalized to `[−1, +1]`. The verdict is a weighted average; the exact formula and weights live in [`pipeline/processors/verdict.py`](pipeline/processors/verdict.py). Macro context (VIX, sector ETFs from FRED) is fetched once per run and stored alongside.

### Two AI models do the parts math can't

- **[FinBERT](https://huggingface.co/ProsusAI/finbert)** reads each news article and labels it positive / neutral / negative. We use it instead of keyword matching because financial language depends on context — *"raised guidance"* is bullish, but *"raised concerns"* is bearish. FinBERT runs **locally on the pipeline runner** via `transformers` + CPU-only `torch` — no network round-trips per article, no shared rate limits. Its continuous score is then averaged with Polygon's categorical per-ticker sentiment (see [ADR 0020](docs/adr/0020-polygon-per-ticker-insights.md)) so the blended value captures both holistic article tone and ticker-specific framing.
- **Llama-3 / Mistral** turns the verdict + bucket scores into the one-sentence English explanation under the verdict chip — *"Bullish — driven by strong analyst upgrades and a constructive technical setup."* It also generates each article's TL;DR + signal-influence line, seeded with Polygon's ticker-specific reasoning when present. This still runs on HuggingFace's Inference API because 7B-param models don't fit on a free CI runner. A shared circuit breaker short-circuits to the rule-based fallback after N consecutive HF failures, so an HF outage caps the cost at a handful of calls instead of bleeding the whole run.

If either model fails, the numerical signal is never blocked. Sentiment falls back to whichever articles did score, verdict reasoning falls back to a deterministic template.

### Track record is public

MarketMind's own daily calls live in `marketmind_predictions` and are resolved at market close every day. Cumulative accuracy is shown on `/about` with sample size — small N is noisy, so the denominator is always visible alongside the percentage.

### Live prices on top of pipeline insights

The signal pipeline runs once a night, so its `prev_close` snapshot is correct but stale by intraday standards. To keep the UI honest during market hours, each stock card and detail page also fetches a **real-time quote from Finnhub** (free-tier `/quote` endpoint, US equities, no delay). The quote is cached in **Upstash Redis** with a 5-minute TTL — see [How we use the cache](#how-we-use-the-cache) — so 50 stocks × N users still cost at most ~10 Finnhub calls/minute globally, well under the free-tier 60/min limit. When Finnhub or Redis is down, the UI degrades to the pipeline's `prev_close` instead of crashing.

Built as a portfolio project demonstrating: data pipelines, financial NLP, real-time-ish UX, animation craft, and enterprise-grade engineering practices.

## Where each provider's data shows up

The pipeline aggregates from ~10 external providers. The table below maps each one to **what we pull, what it costs, and where it surfaces in the UI** — so when someone asks "where does the analyst Buy/Hold/Sell count come from?", the answer is one row away.

| Provider | What we pull | Where it surfaces | Pipeline file |
|---|---|---|---|
| **Yahoo Finance** (via `yfinance`) | 1 year of daily OHLCV bars + 20-day realized volatility | 30-day **sparkline** on stock detail page · Technical bucket (RSI, MACD, MA-20/50, Bollinger position, volume trend) · `prev_close` shown when no live quote · per-stock vol used to vol-normalize the verdict threshold per ADR 0014 | [`pipeline/fetchers/yfinance_fetcher.py`](pipeline/fetchers/yfinance_fetcher.py) |
| **Massive** (formerly Polygon.io, $29/mo Starter) | Up to ~20 recent news articles per stock — headline, body, source, publish timestamp, **plus per-ticker `insights[]`** (Polygon-LLM-generated sentiment + free-text reasoning that's specific to *our* ticker, not the article overall) | Article cards on stock detail page · top-3 articles per stock card · raw input to FinBERT for the Sentiment bucket score · **insights are the relevance gate at fetch time** — articles tagged with our ticker but missing from `insights[]` are dropped as passing mentions (ADR 0020, ~9-15% noise reduction) · per-ticker sentiment is blended with FinBERT's continuous score · per-ticker reasoning seeds the Llama TL;DR prompt | [`pipeline/fetchers/massive.py`](pipeline/fetchers/massive.py) |
| **Finnhub** (free tier — 60 calls/min) | (1) Analyst Buy/Hold/Sell consensus + price target + rating changes  (2) Earnings calendar (days until next earnings)  (3) **Real-time** US equity quote for the live-price UI | "Analyst Buy of N" detail in Professional bucket · earnings-proximity catalyst card · **live `$X.XX · +Y%`** in the header of every stock card and detail page (cached via Upstash, 5-min TTL) | [`pipeline/fetchers/finnhub.py`](pipeline/fetchers/finnhub.py), [`src/lib/live-prices.ts`](src/lib/live-prices.ts) |
| **SEC EDGAR** (free, government data) | (1) Form 4 — recent insider transactions, classified buy/sell/neutral  (2) 8-K — material events in the last 24 hours | "Insider buying" / "CEO bought $2M on Mar 15" in Professional bucket · 8-K catalyst card on stock detail page | [`pipeline/fetchers/sec_edgar.py`](pipeline/fetchers/sec_edgar.py) |
| **StockTwits** (public API, no auth) | Bullish/bearish ratio + total message count per ticker (24h window) | "79% bullish · 1.2K messages" in Social bucket · volume-damped per ADR 0013 (high message counts dilute the directional signal) | [`pipeline/fetchers/stocktwits.py`](pipeline/fetchers/stocktwits.py) |
| **ApeWisdom** (public, free) | Rank of each ticker in r/wallstreetbets mention counts (top ~500) | "ApeWisdom rank #3" surfaced in Social bucket · feeds the **herding intensity** that fades the crowd per ADR 0013 (top-ranked = negative contribution, not positive) | [`pipeline/fetchers/apewisdom.py`](pipeline/fetchers/apewisdom.py) |
| **Reddit** (via PRAW, optional) | Mention count across r/wallstreetbets, r/stocks, r/investing for each ticker, vs 7-day baseline | "+250% mentions" in Social bucket · also feeds herding intensity per ADR 0013 | [`pipeline/fetchers/reddit.py`](pipeline/fetchers/reddit.py) |
| **FRED** (Federal Reserve, free) | VIX (volatility index) + sector ETF performance | Stored as macro context in `signal_breakdown.macro` for future regime-aware scoring (currently fetched, not yet wired into the verdict — per ADR 0014's "regime layer is a separate item" note) | [`pipeline/fetchers/fred.py`](pipeline/fetchers/fred.py) |
| **HuggingFace** (free + Pro tier for Llama) | (1) **FinBERT weights** — downloaded once, cached, runs locally  (2) **Llama-3.1-8B-Instruct** in production (via HF Pro + accepted Meta license + `HUGGINGFACE_SUMMARY_MODEL` env var); ungated fallback is **Mistral-Nemo-Instruct-2407**. Used for article TL;DRs and the verdict reasoning sentence (network round-trip per call) | (1) Sentiment bucket score for every article (positive/negative classification) · (2) the 140-char article TL;DR on stock cards + the one-sentence English explanation under each verdict chip | [`pipeline/processors/sentiment.py`](pipeline/processors/sentiment.py), [`pipeline/processors/summarizer.py`](pipeline/processors/summarizer.py), [`pipeline/processors/verdict.py`](pipeline/processors/verdict.py) |
| **Supabase** (Postgres + Auth + RLS, free tier) | Database of record for everything: stocks, insights, predictions, credits, user feedback | The entire app reads from here. Pipeline is the *producer*, Supabase is the *contract*, Next.js is the *consumer* | — |
| **Upstash Redis** (free tier, serverless HTTP) | Per-user rate limit counters · shared global live-price cache | Lets 50 stocks × N concurrent users cost only ~10 Finnhub calls/min globally · prevents runaway-client double-debits on bet placement | [`src/lib/rate-limit.ts`](src/lib/rate-limit.ts), [`src/lib/live-prices.ts`](src/lib/live-prices.ts) |

### Two architectural notes on the HuggingFace dependency

Both come from [ADR 0012](docs/adr/0012-local-finbert-and-hf-breaker.md) (shipped 2026-05-19, amended 2026-05-20):

1. **FinBERT runs locally, not over the API.** The model file is downloaded once from HuggingFace Hub on the first pipeline run (~440 MB, then cached across runs via `actions/cache@v4`). Every subsequent classification happens in-process on the GitHub Actions runner via `transformers` + CPU `torch`. No per-article network calls; no shared rate limits; no cold-start tax. We pin to a specific commit SHA (`4556d130…`) so the weights never silently change under our resolved-prediction track record.

2. **The LLM (Llama-3.1-8B-Instruct in prod, Mistral-Nemo as fallback) stays on the HF API** because 8B+ parameter models don't fit on a free CI runner's RAM. Production runs Llama-3.1 via HF Pro + the `HUGGINGFACE_SUMMARY_MODEL` env var; the ungated `DEFAULT_MODEL` in code is Mistral-Nemo so local dev / fresh deploys without HF Pro still produce usable text. A shared circuit breaker (`pipeline/processors/_hf_breaker.py`) short-circuits after 5 consecutive HF failures so an outage caps the cost at a handful of timeouts instead of bleeding the whole 50-stock run. We don't pin a SHA on the LLM — display text drift is harmless, and we want the upstream improvements when Meta or Mistral ship them.

**Net effect:** the prediction math is reproducible (pinned classifier weights), the display text gets the benefit of model frontier progress (drifting LLM), and the pipeline doesn't depend on HF being healthy to produce a verdict.

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 15 (App Router), TypeScript strict, Tailwind, shadcn/ui, Framer Motion |
| Backend | Supabase (Postgres + Auth + RLS) |
| Cache | Upstash Redis |
| Pipeline | Python in GitHub Actions |
| Stock data — historical | Massive (formerly Polygon.io) Stocks Starter — daily aggregates, news |
| Stock data — live quotes | Finnhub free tier — real-time US equity prices (60/min) |
| NLP | FinBERT (local CPU, pinned SHA) + Llama-3.1-8B-Instruct via HuggingFace Pro Inference API (default fallback: Mistral-Nemo-Instruct-2407, ungated) |
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
