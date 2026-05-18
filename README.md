# MarketMind

> Multi-source stock intelligence platform with daily prediction mechanic.
> 50 curated stocks · 10+ data sources · real signal breakdown · gamified daily ritual.

🔗 **Live:** [marketmind.neeleshkakaraparthi.dev](https://marketmind.neeleshkakaraparthi.dev) *(coming soon)*
📖 **Case study:** [docs/CASE_STUDY.md](docs/CASE_STUDY.md)
🏗️ **Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## What it does

MarketMind aggregates **10+ financial data sources** (market data, news, analyst ratings, insider activity, social sentiment) into a transparent **per-stock signal breakdown**. Users predict UP/DOWN on stocks before market open using virtual credits, results resolve at close, and gamification (streaks, badges, weekly leaderboards) drives a daily return ritual.

Built as a portfolio project demonstrating: data pipelines, NLP (FinBERT + Llama-3), real-time-ish UX, animation craft, and enterprise-grade engineering practices.

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
