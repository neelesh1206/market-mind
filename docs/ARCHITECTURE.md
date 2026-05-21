# Architecture

High-level technical architecture for MarketMind. For implementation details, see [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md). For the *why* behind specific decisions, see [adr/](adr/).

---

## System overview

```
                   ┌─────────────────────────────────────┐
                   │       GitHub Actions (cron)         │
                   │                                     │
                   │  8 PM ET → fetch-insights.yml       │
                   │  4:15 PM → resolve-predictions.yml  │
                   │                                     │
                   │  Python orchestrator:               │
                   │   • Massive (prices, news)          │
                   │   • Free APIs (10+ sources)         │
                   │   • FinBERT sentiment               │
                   │   • Llama-3 TL;DRs                  │
                   │   • Signal aggregator               │
                   └────────────────┬────────────────────┘
                                    │ writes
                                    ▼
                         ┌──────────────────────┐
                         │  Supabase Postgres   │
                         │  • Auth + RLS        │
                         │  • Type generation   │
                         └──────────┬───────────┘
                                    │
                          reads via │
                                    ▼
                         ┌──────────────────────┐
                         │   Upstash Redis      │
                         │   • Rate limits      │
                         │   • Hot insights     │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │  Next.js on Vercel   │
                         │  + Sentry + PostHog  │
                         └──────────┬───────────┘
                                    │
                                    ▼
                              friends 🚀
```

---

## Component responsibilities

### GitHub Actions Pipeline
- Runs Python on cron (no always-on infrastructure)
- Two workflows: `fetch-insights.yml` (8 PM ET) and `resolve-predictions.yml` (4:15 PM ET)
- Parallel processing across 50 stocks
- Resilience built in: retry, circuit breaker, graceful degradation
- All runs logged to `pipeline_runs` table for observability

→ ADR [0003-github-actions-for-pipeline](adr/0003-github-actions-for-pipeline.md)

### Supabase
- Postgres for everything: stocks, insights, predictions, credits, badges
- Built-in Auth (Google Sign-In)
- Row-Level Security ensures user isolation
- TypeScript types auto-generated from schema

→ ADR [0001-supabase-over-neon](adr/0001-supabase-over-neon.md)

### Upstash Redis
- Per-user API rate limiting (60 req/min)
- Hot path cache for current-day insights (read-heavy)
- Bet window state ("is the window open right now?")

### Next.js Frontend
- App Router, TypeScript strict
- Mobile-first via Tailwind
- Framer Motion for the gamification animations
- shadcn/ui as the component primitive layer
- All API routes type-safe via Zod
- Sentry + PostHog instrumented from day one

---

## Data flow: a single prediction lifecycle

```
8:00 PM (T-1)      Pipeline runs → stock_insights for tomorrow populated
8:00 PM – 9:15 AM  User opens app, sees insight cards, places UP/DOWN bet
                     - debit user_profiles.credit_balance
                     - insert into predictions
                     - log to credit_transactions
9:15 AM            Bet window closes (enforced server-side)
9:30 AM            Market opens — open_price captured by resolution job later
4:00 PM            Market closes
4:15 PM            resolve-predictions job runs:
                     - for each unresolved user prediction:
                         compare open_price → close_price  (matches bet-lock at 1 PM ET)
                         set outcome = WIN/LOSS
                         credit payout if WIN (1.8x stake)
                         log to credit_transactions
                         award any newly-unlocked badges
                     - for each unresolved MarketMind verdict (track record):
                         compare prev_close → close_price  (matches 8 PM T-1 prediction time)
                         set outcome = WIN/LOSS/VOID
                     (Two windows — see ADR 0011)
4:16 PM            User opens app → result reveal animation fires
```

---

## Signal engine

Each insight has **4 bucket scores** (technical, sentiment, professional, social), each on a -1 to +1 scale. No combined verdict — users see the buckets and decide.

→ ADR [0002-no-aggregate-verdict](adr/0002-no-aggregate-verdict.md)

| Bucket | Inputs |
|--------|--------|
| Technical | RSI, MACD, moving averages, volume trend (Massive + ta-lib) |
| Sentiment | Polygon-filtered news from Massive blended with FinBERT (local CPU) — Polygon's per-ticker `insights[]` field gates relevance at fetch, then FinBERT's continuous score is averaged with Polygon's categorical sentiment (ADR 0020) |
| Professional | Finnhub analyst consensus, SEC EDGAR Form 4 (insider) |
| Social | StockTwits, Reddit, ApeWisdom |

Each signal in the breakdown shows its source — the trust UI patterns leverage this for "4 of 5 sources agree" indicators.

---

## Trust through transparency

Users see source attribution under every signal: which sources contributed, when data was fetched, agreement counters across sources. The `/methodology` page explains the full scoring in plain English. Source data lineage is preserved via the `stock_insight_sources` audit table.

This is the moat against "robo-advisor" framing — users feel the data is shown to them, not interpreted for them.

---

## Cost

| Service | Tier | Cost/mo |
|---------|------|---------|
| Massive Stocks | Starter | $29 |
| HuggingFace | Pro | $9 |
| Supabase | Free | $0 |
| Upstash Redis | Pay-per-request | <$2 |
| Vercel | Hobby | $0 |
| GitHub Actions | Free tier | $0 (well under 2k min/mo) |
| Sentry | Free | $0 |
| PostHog | Free | $0 |
| Domain | already owned | $0 |
| **Total** | | **~$40/mo** |

Scaling triggers:
- Supabase Pro ($25) at 50K MAU or 500MB DB
- Vercel Pro ($20) only if monetized (Hobby is non-commercial only)
- HuggingFace Inference Endpoints (dedicated) at >100k inferences/day

---

## Decision index

For the reasoning behind each design choice, see the ADRs:

| ADR | Decision |
|-----|----------|
| [0001](adr/0001-documentation-as-rule.md) | Documentation discipline as a project rule |
| [0002](adr/0002-supabase-over-neon.md) | Supabase over Neon for this project |
| [0003](adr/0003-no-aggregate-verdict.md) | No UP/DOWN verdict — show signals, not conclusions |
| [0004](adr/0004-github-actions-for-pipeline.md) | GitHub Actions over FastAPI/Modal for the pipeline |
| [0005](adr/0005-massive-as-primary-data-source.md) | Massive as primary paid data source |
| [0011](adr/0011-signal-quality-p0-fixes.md) | Signal-quality P0 fixes (resolution window, PIT filter, weight renormalization) |
| [0020](adr/0020-polygon-per-ticker-insights.md) | Polygon's per-ticker insights[] as relevance gate + sentiment blend + LLM seed |
