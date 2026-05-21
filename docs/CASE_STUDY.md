# MarketMind — Case Study

> A portfolio narrative on design choices, tradeoffs, and lessons.
> Intended for inclusion on [neeleshkakaraparthi.dev](https://neeleshkakaraparthi.dev).

---

## TL;DR

MarketMind is a stock prediction app built in 5 days as a portfolio project. It aggregates 10+ financial data sources into transparent per-stock signal breakdowns, runs daily insights through a FinBERT + Llama-3 NLP pipeline, and ships polished gamification (streaks, badges, animated result reveals, shareable cards) on top of an enterprise-grade architecture (RLS, type safety end-to-end, observability from day one).

The interesting engineering story isn't the stack — it's the deliberate constraints and the calls that made them work.

---

## The problem space

Prediction markets are having a moment (Polymarket, Kalshi). Stock-tracking apps are commodity. The gap: a **trustworthy, social, gamified prediction layer** for stocks that doesn't require real money and doesn't masquerade as investment advice.

Audience: friends + portfolio reviewers. Not commercial.

## Hard constraints going in

| Constraint | Implication |
|------------|-------------|
| **5-day build** (40-50 focused hours) | Cut anything that doesn't ship the core loop |
| **$40/mo budget cap** | Pick paid services surgically; lean on free tiers |
| **Friends-only audience** | No real-money mechanics, no compliance burden |
| **Must showcase frontend taste** | Gamification + animations are non-negotiable |
| **Insights must feel valuable** | Multi-source data, transparent attribution, no black-box verdict |

These constraints **created the product**, they didn't just bound it.

---

## Design choices and the reasoning

### 1. No aggregate UP/DOWN verdict, only signal breakdown

The instinct is to combine all signals into one "UP, HIGH confidence" recommendation. I chose not to.

**Why:**
- A verdict homogenizes user behavior — everyone bets the same direction → no game
- A verdict looks like investment advice → legal/positioning risk
- A verdict feels like a black box → reduces perceived value of the data
- A breakdown forces users to *interpret* → makes the insights feel valuable (the stated product goal)

This single choice unlocked the trust UI patterns (cross-source agreement counters, source attribution, methodology page) — none of which would have made sense alongside a one-line verdict.

→ [ADR 0003](adr/0003-no-aggregate-verdict.md)

### 2. Supabase over Neon (despite using Neon on the portfolio)

The portfolio site runs on Neon. Consistency would say "use Neon here too." I picked Supabase anyway.

**Why:**
- Multi-tenant data with hard isolation needs (user A must never see user B's bets)
- Database-level RLS > app-layer security — fewer footguns
- Auth + DB sharing a JWT trust boundary saves real time
- Day-1 budget tight: Supabase saves 3-4 hours on auth/RLS plumbing

The case-study lesson: **using two stacks is fine when each is the right tool**. Using one stack everywhere is a junior heuristic.

→ [ADR 0002](adr/0002-supabase-over-neon.md)

### 3. GitHub Actions for the pipeline, not a Python service

Conventional wisdom for a Python data pipeline: stand up FastAPI on Fly.io. I rejected that.

**Why:**
- The pipeline is a batch job running ~15 minutes per day
- An always-on service for a daily cron is operational waste
- GitHub Actions: free 2k min/month, version-controlled workflows, secrets management built in
- Zero additional infrastructure to monitor, deploy, scale

The case-study lesson: **architecture should match access patterns**. A cron job is not a service.

→ [ADR 0004](adr/0004-github-actions-for-pipeline.md)

### 4. Massive (formerly Polygon.io) as primary data source

Picked one paid data API over a fan-out of cheaper sources.

**Why:**
- Reliability of core data (prices, technicals, news) beats quantity
- Massive's $29 Starter tier covers prices + news + technicals in one
- Free APIs (Finnhub, SEC EDGAR, StockTwits, Reddit, ApeWisdom, FRED) fill the rest
- 10+ sources total, but one is the reliable foundation
- Beyond the price/news data: each article also ships with Polygon's LLM-generated
  **per-ticker `insights[]`** (sentiment + reasoning specific to *our* ticker, not the
  article overall). We use it as a relevance gate at fetch (drops ~9-15% of off-topic
  noise), as a sentiment input that gets blended with our local FinBERT score, and as
  a seed for the Llama TL;DR prompt. See [ADR 0020](adr/0020-polygon-per-ticker-insights.md).

This is the "boring tech" principle: one professional API > five flaky scrapers.

→ [ADR 0005](adr/0005-massive-as-primary-data-source.md)

### 5. Gamification as a separate dedicated day, not bolted on

I initially planned to sprinkle gamification across the build. Cut it. Day 4 is reserved for nothing but gamification + animation polish.

**Why:**
- The difference between "yeah, streaks" and "Duolingo moment" is hours of polish
- Polish doesn't survive context-switching with backend work
- The result reveal animation is the most portable showcase artifact in the whole project — needs focused attention
- Animation tooling (Framer Motion, canvas-confetti, @vercel/og) deserves to be learned cohesively, not in 20-min stints

The case-study lesson: **showcase moments need protected time**. Treating them as polish-at-the-end is how they become forgettable.

---

## What I deliberately deferred

| Cut | Why | When |
|-----|-----|------|
| Backtest harness | Best done after MVP signals are stable | Week 2 (its own showcase piece) |
| Push notifications | iOS PWA support is shaky | Week 2 |
| Crowd-split odds | Requires a user base to be meaningful | Week 3 |
| Premium scraped sources (Seeking Alpha, TipRanks, Zacks) | Free APIs cover analyst data adequately | Conditional Week 2+ |
| Real-money mechanics | Compliance burden + ethics | Maybe never |

The deferrals are themselves a design choice — saying no is harder than saying yes.

---

## Engineering practices applied

- **Documentation discipline**: README, CHANGELOG, ADRs, runbook, setup guide maintained alongside code from Day 1
- **Type safety end-to-end**: TypeScript strict, Supabase-generated types, Zod validation at API boundaries
- **Row-Level Security**: every user-data table has RLS policies, even where data is currently public (practice the pattern)
- **Observability from Day 1**: Sentry + PostHog wired up before the first feature ships
- **Resilient pipeline patterns**: retry with backoff, circuit breakers, graceful degradation per fetcher
- **Audit trails**: `pipeline_runs` + `stock_insight_sources` tables track every execution and source response
- **Performance budgets**: Lighthouse >90, FCP <1.2s, bundle <150KB gzipped

---

## Lessons (filled in post-launch)

*To be written after MVP ships. Will cover: what shipped vs. what slipped, what data quality looked like in practice, what users actually engaged with, what I'd do differently.*

---

## Tech I touched (for the resume)

Next.js 15 · TypeScript strict · Tailwind · shadcn/ui · Framer Motion · @vercel/og · Supabase (Postgres + Auth + RLS) · Upstash Redis · Python · pandas · yfinance · ta-lib · HuggingFace Inference API · FinBERT · Llama-3 · GitHub Actions · Sentry · PostHog · Vercel · Zod
