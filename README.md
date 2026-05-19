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

- **[FinBERT](https://huggingface.co/ProsusAI/finbert)** reads each news article and labels it positive / neutral / negative. We use it instead of keyword matching because financial language depends on context — *"raised guidance"* is bullish, but *"raised concerns"* is bearish.
- **Llama-3 / Mistral** turns the verdict + bucket scores into the one-sentence English explanation under the verdict chip — *"Bullish — driven by strong analyst upgrades and a constructive technical setup."*

Both run on HuggingFace's Inference API. If either fails, the pipeline degrades gracefully: sentiment falls back to whichever articles did score, and the verdict reasoning falls back to a rule-based template. The numerical signal is never blocked by an LLM hiccup.

### Track record is public

MarketMind's own daily calls live in `marketmind_predictions` and are resolved at market close every day. Cumulative accuracy is shown on `/about` with sample size — small N is noisy, so the denominator is always visible alongside the percentage.

Built as a portfolio project demonstrating: data pipelines, financial NLP, real-time-ish UX, animation craft, and enterprise-grade engineering practices.

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 15 (App Router), TypeScript strict, Tailwind, shadcn/ui, Framer Motion |
| Backend | Supabase (Postgres + Auth + RLS) |
| Cache | Upstash Redis |
| Pipeline | Python in GitHub Actions |
| Stock data | Massive (formerly Polygon.io) Stocks Starter |
| NLP | FinBERT + Llama-3 via HuggingFace Pro |
| Observability | Sentry + PostHog |
| Hosting | Vercel (Hobby) |

**Monthly cost: ~$38** ([cost breakdown](docs/ARCHITECTURE.md#cost))

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
