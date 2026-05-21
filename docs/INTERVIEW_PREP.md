# MarketMind — Interview Prep Guide

> A deep-dive companion to [CASE_STUDY.md](CASE_STUDY.md) (portfolio narrative)
> and [ARCHITECTURE.md](ARCHITECTURE.md) (high-level diagram). This doc is
> built for **interview rehearsal** — walks through every feature, the
> decisions behind it, and the tradeoffs that landed.
>
> Read top-to-bottom once. Re-read sections relevant to the role the day of.
> The "Common interview questions" at the bottom maps typical prompts to the
> sections that answer them.

---

## Table of contents

1. [The 30-second pitch](#the-30-second-pitch)
2. [The 2-minute walkthrough](#the-2-minute-walkthrough)
3. [System architecture](#system-architecture)
4. [Tech stack — every choice and why](#tech-stack--every-choice-and-why)
5. [Frontend deep dive](#frontend-deep-dive)
6. [Backend / database / RLS](#backend--database--rls)
7. [Authentication flow](#authentication-flow)
8. [Python pipeline](#python-pipeline)
9. [Data sources — 10+ feeds, fallback chains](#data-sources)
10. [AI/ML — FinBERT + Llama](#aiml--finbert--llama)
11. [Caching — Upstash Redis (two workloads)](#caching--upstash-redis)
12. [Rate limiting + security](#rate-limiting--security)
13. [Scheduling — Cloudflare Worker cron](#scheduling--cloudflare-worker-cron)
14. [Deployment — Vercel + GH Actions + CF + Supabase](#deployment)
15. [Testing strategy](#testing-strategy)
16. [Observability](#observability)
17. [Cost breakdown](#cost-breakdown)
18. [Key trade-offs (ADR highlights)](#key-trade-offs)
19. [Mistakes I made and what I learned](#mistakes-i-made-and-what-i-learned)
20. [What's next](#whats-next)
21. [Common interview questions — quick answers](#common-interview-questions)

---

## The 30-second pitch

> MarketMind is a daily stock-prediction game with a transparent signal engine
> behind it. Every weeknight a Python pipeline visits ten data sources for
> fifty stocks, scores each into four signal buckets (technical, sentiment,
> professional, social), computes a UP / DOWN / NEUTRAL verdict, and stores
> everything in Postgres. The next morning users see the signals plus my
> model's call and can place a virtual-credit bet before market close.
> Predictions are resolved against the day's actual price action, accuracy
> is published with a 95% confidence interval, and the whole loop runs
> autonomously on a $38/month budget across five free-tier services.
>
> I built it as a portfolio piece to show I can ship a full-stack product —
> not a tutorial clone — with real engineering discipline: 17 ADRs, 15
> migrations, end-to-end type safety, RLS at the database layer, and
> 88 JS unit + 7 e2e + ~40 Python pipeline tests gating CI on ~16k LOC.

**Memorize the bolded numbers.** They're the proof points interviewers respond to.

---

## The 2-minute walkthrough

If someone says "walk me through this project":

> 1. **The problem.** Prediction markets are having a moment (Polymarket, Kalshi), and stock-tracking apps are commodity. The gap I wanted to fill: a *transparent, gamified, no-money-required* prediction layer for stocks where every score links back to its source so users can audit the model.
>
> 2. **The architecture.** Three layers. The Python pipeline is the *producer* — it runs on GitHub Actions every night and writes signal data to Supabase Postgres. The database is the *contract* — every signal/verdict read goes through it. The Next.js app on Vercel is the *consumer* — it reads from Supabase via Row-Level-Security policies and presents the UI. The one exception to "no third-party calls at render time" is the live-price layer (Finnhub), and even there we go through an Upstash Redis cache with a 5-minute TTL — so on a steady-state page render most calls hit Redis, not Finnhub. The signal data — buckets, verdict, articles — is always served from Postgres. Vendor outages can't take down the website.
>
> 3. **The signal engine.** Each stock gets four bucket scores in `[-1, +1]`: technical (RSI, MACD, moving averages from yfinance), sentiment (news articles scored by FinBERT, which I run locally on the pipeline runner to avoid HuggingFace rate limits), professional (analyst consensus from Finnhub plus insider transactions from SEC EDGAR), and social (StockTwits bullish ratio plus Reddit mentions, with the social bucket deliberately damping rather than amplifying — research consistently shows retail-attention spikes precede underperformance for non-meme tickers).
>
> 4. **The verdict.** I take a weighted average of the four buckets — `0.30, 0.25, 0.30, 0.15` for technical, sentiment, professional, social — scale the threshold by 20-day realized volatility so quiet stocks like PG don't get over-called and noisy ones like NVDA don't get under-called, and produce UP / DOWN / NEUTRAL. Llama-3 turns the result into a one-sentence English explanation; if HuggingFace is down, a rule-based fallback runs the same scoring without LLM dependency.
>
> 5. **The game loop.** Users see the signals plus my verdict between 8 PM ET and 1 PM ET the next day. They place a bet for one stock — UP, DOWN, or skip — with a virtual-credit stake. The bet window stays open into market hours so users can engage with the app at lunch. After market close, a second pipeline resolves bets against the day's price action, settles credits at 1.8x payout, and updates streaks plus badges.
>
> 6. **The honest part.** Accuracy is published on `/about` with the 95% Wilson confidence interval next to it — so users can see at a glance whether to trust the number given my sample size. Small N is noisy; the page literally tells them that.
>
> 7. **The infrastructure.** Five free-tier services tied together: Vercel for hosting, Supabase for Postgres + Auth + RLS, GitHub Actions for the pipeline runtime, Cloudflare Workers for the cron triggers (more reliable than GH Actions cron, which can drift hours), and Upstash Redis for shared caching of rate limits and live prices. Sentry catches errors. Vercel Analytics tracks Web Vitals.
>
> 8. **The interesting decisions.** Seventeen ADRs walk through them. The ones I'd flag for an engineering interview: choosing Supabase over Neon for the auth-included story, moving FinBERT to local execution after watching HF rate limits kill a production run, switching the social bucket from amplifying to damping retail attention, and most recently re-thinking how mid-day bets resolve so a 12:30 PM bettor isn't held to the same bar as someone who bet the previous night.
>
> 9. **Trust-building UX.** Three concrete moves: I publish accuracy with the 95% Wilson confidence interval (sample-size honesty), the NEUTRAL chip is visually distinct from UP/DOWN so users see "we deliberately didn't make a call" instead of mistaking it for a wishy-washy third tone, and every verdict carries a thumbs-up/thumbs-down feedback widget so I can close the loop on which calls were actually useful — aggregate "X of Y people found this helpful" is public, individual votes are RLS-scoped to the voter.

That's about 90 seconds. Add or trim depending on the interviewer's attention.

---

## System architecture

```
┌─────────────────────────────────────────────────────┐
│         GitHub Actions (Python pipeline)            │
│                                                     │
│   • fetch-insights.yml   8 PM ET Mon–Fri            │
│   • resolve-predictions.yml  5:15 PM ET Mon–Fri     │
│   • compute-leaderboard.yml  7 PM ET Sun            │
│                                                     │
│   Triggers:                                         │
│     ┌─────────────────────────────────┐             │
│     │ Cloudflare Worker (CF cron)     │ ← more reliable than GH Actions
│     │ POSTs to /actions/workflows     │   schedule:; replaces it (ADR 0016)
│     │ /{file}/dispatches via PAT      │             │
│     └─────────────────────────────────┘             │
│                                                     │
│   Data sources (10+):                               │
│     • Massive / Polygon — historical OHLCV, news    │
│     • Finnhub — analyst consensus, real-time quotes │
│     • yfinance — supplemental OHLCV (fallback)      │
│     • SEC EDGAR — insider trades, 8-K filings       │
│     • StockTwits — bullish/bearish ratio            │
│     • ApeWisdom — WSB mention rank                  │
│     • Reddit (optional) — mention counts            │
│     • FRED — VIX, sector ETFs (macro context)       │
│     • FinBERT — sentiment (local CPU)               │
│     • Llama-3 / Mistral — verdict reasoning         │
└────────────────────┬────────────────────────────────┘
                     │ INSERT/UPDATE via Supabase service-role key
                     ▼
        ┌───────────────────────────────┐
        │     Supabase Postgres         │
        │  • RLS on every user table    │
        │  • SECURITY DEFINER RPCs for  │
        │    atomic mutations           │
        │  • Migrations via GH Actions  │
        │    (ADR 0006)                 │
        └────────────┬──────────────────┘
                     │ SELECT via anon JWT (RLS-respecting)
                     ▼
   ┌────────────────────────────────────────────┐
   │            Next.js on Vercel               │
   │                                            │
   │   • App Router, React Server Components    │
   │   • Server actions for mutations           │
   │     (rate-limited via Upstash)             │
   │   • Live prices fetched server-side from   │
   │     Finnhub, cached in Upstash 5min        │
   │   • Sentry + Vercel Analytics              │
   └────────────────────────────────────────────┘

   ┌────────────────────────────────────────────┐
   │            Upstash Redis                   │
   │   • mm:rl:*   — per-user rate-limit        │
   │     counters (sliding window)              │
   │   • mm:price:* — live-price cache (5min)   │
   └────────────────────────────────────────────┘
```

**Key property:** the Next.js app reads **all signal data** (verdict, buckets, articles, sparklines) from Postgres only — Pipeline → DB → app is a one-way dependency for the bulk of the page. **The one exception** is the live-price layer: `getLivePrices()` is called during page render on the home feed and stock detail page, going first to Upstash Redis (5-min TTL) and only hitting Finnhub on cache misses. Under steady-state traffic, ~99% of page renders make zero outbound third-party calls. Finnhub outages degrade gracefully to the pipeline's `prev_close` — the page renders either way.

---

## Tech stack — every choice and why

| Layer | Choice | Why this instead of the obvious alternative |
|---|---|---|
| **Frontend framework** | **Next.js 16 (App Router)** | RSC + Server Actions kill the need for a separate API layer for read paths. Mature, hireable. Alternatives considered: Remix (smaller ecosystem), SvelteKit (smaller talent pool). |
| **Language** | **TypeScript strict** (with `noUncheckedIndexedAccess`, `noImplicitOverride`) | Catches the bugs a portfolio reviewer will look for first. Strict mode adds compile time but prevents the "undefined is not a function" demo crash. |
| **Styling** | **Tailwind v4** + **shadcn/ui** (base-ui flavor) | Tailwind for velocity + design tokens. shadcn for accessible primitives without library lock-in (components are copied into my repo, not imported). |
| **Animation** | **Framer Motion** + **canvas-confetti** | Required for the result-reveal modal — gamification is a portfolio differentiator. |
| **Database** | **Supabase Postgres** | Bundles Postgres + Auth + RLS + Realtime + Storage behind one connection string. Considered Neon (cheaper but no auth). The auth product alone saved me ~2 days. See [ADR 0002](adr/0002-supabase-over-neon.md). |
| **Auth** | **Supabase Auth (Google OAuth only)** | One provider keeps the surface small. Email/password skipped — friends-only audience, every user has a Google account. |
| **Backend runtime** | **Supabase RPCs (SQL/PLpgSQL)** for mutations | Atomicity guarantees: `place_bet`, `cancel_bet`, `claim_daily_bonus` all run in a single transaction with stake validation, balance update, ledger insert, badge insert. RLS prevents users from calling RPCs against other users' data. |
| **Pipeline runtime** | **Python on GitHub Actions** | Already had to do CI; reusing the runner is free. Considered self-hosting (a $5 droplet would work but adds patching surface). Considered AWS Lambda (15-min timeout is a problem for 50-stock runs). See [ADR 0004](adr/0004-github-actions-for-pipeline.md). |
| **NLP** | **FinBERT (local)** + **Llama-3 via HF Inference** | FinBERT moved local after HF rate-limited a production run for 45 minutes. Llama stays on HF because 7B-param models don't fit on a free CI runner. Both gated by a shared circuit breaker that falls back to rule-based scoring after N consecutive failures. See [ADR 0012](adr/0012-local-finbert-and-hf-breaker.md). |
| **Stock data — historical** | **Massive (rebranded Polygon)** Starter tier | OHLCV + news at a quality bar yfinance can't match. $29/mo. |
| **Stock data — live quotes** | **Finnhub free tier** | Real-time US equity quotes at 60 calls/min. I originally used Polygon snapshots — those turned out to be paid-only, swapped to Finnhub. *(Story below in mistakes section.)* |
| **Cache** | **Upstash Redis** | HTTP-based Redis (no connection pooling needed), free tier covers 10k commands/day. Two workloads share the connection: rate limits + live-price cache. |
| **Cron** | **Cloudflare Workers** | GitHub Actions `schedule:` is best-effort, drifted ~3h on first run. CF cron is reliable to ~1 min. The Worker just POSTs to GH's `workflow_dispatch` API. See [ADR 0016](adr/0016-external-cron-via-cloudflare-worker.md). |
| **Hosting** | **Vercel Hobby** | Free; auto-deploy on push; OG image generation via `next/og` Edge runtime. |
| **Observability** | **Sentry** (errors) + **Vercel Analytics** (Web Vitals + pageviews) | Sentry for stack-traces and breadcrumbs; Vercel Analytics for "is anyone visiting" without third-party cookies. PostHog deferred until I have 30+ users — different question (behavior), different urgency. |
| **Testing** | **Vitest** (JS unit) + **Playwright** (JS e2e) + **pytest** (Python) | 80 unit tests + 7 e2e + 20 pipeline tests, all gated in CI. |
| **DNS / cron** | **Cloudflare** | Already had it for the custom domain (`marketmind.neeleshkakaraparthi.dev`). Workers piggybacks on the existing account — no new vendor. |

---

## Frontend deep dive

### App Router structure

```
src/app/
├── layout.tsx                  ← root, mounts ThemeProvider + Analytics
├── page.tsx                    ← home feed (RSC)
├── (auth)/login/page.tsx       ← unauth landing w/ preview cards
├── about/page.tsx              ← methodology + published accuracy
├── bets/page.tsx               ← bet history + credit ledger tabs
├── leaderboard/page.tsx        ← weekly snapshot
├── onboarding/page.tsx         ← stock picker grid
├── profile/page.tsx            ← stats + badges
├── stocks/page.tsx             ← browse all 50 (search + sort)
├── stock/[ticker]/page.tsx     ← detail (publicly readable for OG unfurls)
├── og/stock/[ticker]/route.ts  ← dynamic OG image via next/og + Satori
└── (api routes for auth callbacks, server actions co-located with pages)
```

### Server Components vs Client Components

Default = RSC (Server Component). Pages do their database fetches inline at the top of the function — no separate API route, no useEffect, no loading spinner on the read path. Client Components are reserved for things that genuinely need browser state: bet sheet (form), pull-to-refresh (touch events), confetti reveal (animation timing), theme toggle (localStorage).

**Interview rationale:** *"Server Components eliminate the API layer for reads. I do `await supabase.from(...)` in the page function. No tRPC, no SWR, no `useEffect` for data — the user gets HTML with the data already in it on first paint. Client Components only enter when the user has to interact."*

### State management

Zero. No Redux, no Zustand, no React Query. Server-side fetches go through RSC, mutations go through Server Actions that call Supabase RPCs and then `revalidatePath()`. The "state" lives in Postgres; React just renders it.

### Key UX components

- **`StockCard`** — the workhorse. Renders the four signal bars, verdict chip, top article TL;DR, optional live price, and bet CTA. Used on home feed, login landing, and `/stocks` browse. Accepts a `preview` prop that swaps the bet CTA for a "Sign in to bet" link on unauth surfaces.
- **`BetSheet`** — slide-in mobile-first form. Stake validation (no overbetting credits), direction picker, confirmation. Sonner toast on success with a smart-formatted resolution time.
- **`ResultRevealModal`** — auto-opens on home page load when the user has resolved-but-not-revealed bets. Framer Motion stagger + canvas confetti on WIN, restrained sympathy copy on LOSS, refund explainer on VOID.
- **`MarketScheduleBar`** — state machine UI. Three states: "pipeline running," "bet window open," "market closed, results soon." Drives all the time-sensitive copy on the home page.
- **`TrackRecordBadge`** — accuracy + Wilson CI in one inline component. Tooltip explains the math. `compact` prop strips it down for in-card use.
- **`ConvictionList`** — top 5 long + top 5 short by cross-sectional rank. Stars indicate stocks already on the user's watchlist (discovery + personalized context in one surface).
- **`VerdictChip`** — three visually distinct states. UP and DOWN render as solid colored chips with a confidence percentage; NEUTRAL renders as a dashed-border transparent chip with a HelpCircle icon and explicit "no clear read today" copy (no percentage shown). The visual distinction matters because a NEUTRAL with confidence numbers reads as "mildly indecisive" — actually it means "we deliberately did not make a call, signals were mixed." UX honesty in the smallest atomic component.
- **`PredictionFeedback`** — thumbs-up / thumbs-down on each MarketMind verdict on the stock detail page. Three display modes by sample size: `N=0` → "Be the first to weigh in"; `N<5` → "X of Y people found this helpful" (no percentage, avoiding the 1/1=100% misleading display); `N≥5` → percentage shown. Anon visitors see the aggregate count + a sign-in CTA but can't vote. Optimistic UI with state-restore on RPC failure. Closes the feedback loop on verdict quality without a separate analytics tool.
- **Stuck-bet UI** (`isStuckPrediction` helper) — purely UI-derived state for bets whose `prediction_date < today_et AND !resolved`. Covers cron failures, weekend bets, price-data hiccups. Surfaces on three places: amber banner on `/bets` history page, "Delayed" badge variant on each affected row, and the home-page chip swaps "Resolves in 3h" copy for "Resolution delayed" with an `AlertCircle` icon. No schema, no cron, no auto-VOID — pure UI derivation makes silent failures visible instead of leaving users wondering why their stake hasn't resolved.

### Mobile-first

Pixel 7 viewport was the design target. Pull-to-refresh on home (~80 LOC, no library — pointer events with damping factor 2.5, single haptic tick at threshold). Touch targets 44×44 minimum per WCAG. Side-by-side BetSheet buttons on small screens. iOS-native feel without iOS-only code.

### Accessibility

Skip-to-main-content link as the first focusable element on every page. Every `target="_blank"` carries `rel="noopener noreferrer"`. ThemeToggle, ProfileMenu, Sheet close button all have proper `aria-label` or `sr-only` text. The reveal modal's clickable area uses `role="button"` + `tabIndex` + keyboard handler. Lighthouse audit was a discrete polish pass (#110).

---

## Backend / database / RLS

### Schema (15 migrations, ~14 tables)

```
stocks                    — 50-stock universe (seeded)
user_profiles             — display_name, credit_balance, streak counters
user_watchlist            — which stocks each user follows (10-20 per user)
stock_insights            — daily aggregate row per stock (signal scores, prev_close)
insight_articles          — top-3 news articles per stock per day (TL;DR, signal_influence)
stock_insight_sources     — per-source audit log (what data succeeded/failed each run)
marketmind_predictions    — MarketMind's own daily verdict + cross-sectional rank
predictions               — user bets (UP/DOWN, stake, prediction_date, outcome)
credit_transactions       — append-only ledger (signup_bonus, daily_bonus, wager, payout, refund)
user_badges               — FIRST_BET, FIRST_WIN, STREAK_3/7/14/30
weekly_leaderboard        — Sunday-night snapshot per user (accuracy + rank)
pipeline_runs             — start/end + status of every pipeline invocation
```

### Row-Level Security (RLS)

Every user-scoped table has RLS enabled with policies of the form:

```sql
alter table predictions enable row level security;

create policy "users see own predictions"
  on predictions for select
  using (auth.uid() = user_id);

create policy "users write own predictions"
  on predictions for insert
  with check (auth.uid() = user_id);
```

The Next.js app uses the anon JWT (Supabase JS client), which respects RLS. The pipeline uses the service-role key, which bypasses RLS — that's intentional because the pipeline writes on behalf of all users (predictions resolution, badge awards, leaderboard).

**Defense in depth:** even if I have a bug in a server-side query helper that forgets to filter by `user_id`, Postgres won't return another user's rows. Same goes for accidental client-side query writes — the anon key fundamentally can't see them.

### SECURITY DEFINER RPCs for mutations

Every state-changing operation flows through a Postgres function:

- `place_bet(stock_id, direction, credits, prediction_date, price_at_placement)` — validates stake against balance, locks the bet row, inserts ledger entry, awards FIRST_BET if first bet, returns the prediction row. All atomic.
- `cancel_bet(prediction_id)` — only allowed during the bet window; refunds the stake; deletes the row.
- `claim_daily_bonus(today_date)` — once-per-ET-day enforcement, streak math, bonus amount calculation (100 + (streak-1)*20, capped at 300), STREAK_N badge insert at threshold crossings.
- `mark_predictions_revealed(prediction_ids[])` — atomic flip of `revealed_at` so the reveal modal doesn't re-fire.
- `award_badge(user_id, badge_type, metadata)` — service-role only, called by pipeline; idempotent via `ON CONFLICT DO NOTHING`.

Why RPCs over server actions doing multi-statement updates: a single RPC is one round-trip and one transaction. Server-action code doing two writes would either need explicit `BEGIN/COMMIT` (verbose) or risk leaving the DB inconsistent on partial failure.

### Migrations via GitHub Actions

The `apply-migrations.yml` workflow is the only path that touches the prod schema. It requires:

1. Manual `workflow_dispatch` trigger (cron blocked — schema changes are deliberate)
2. Confirmation input: must type the literal string `migrate` or the workflow aborts
3. Uses `supabase db push` via the Supabase CLI

This makes migrations fully traceable: every prod schema change has a corresponding GH Actions run + PR review trail. See [ADR 0006](adr/0006-migrations-via-github-actions.md).

### Graceful migration-pending degradation

When I added the `price_at_placement` column (migration #125) but hadn't applied the migration yet, code referencing the new column crashed page fetches. Now read helpers wrap their queries in try/catch on Postgres error codes `42703` ("column does not exist") and PostgREST's equivalent `PGRST204`, and fall back to a legacy SELECT shape without the new column. This pattern is used in `fetchBetsForTradingDay`, `fetchUnrevealedResolved`, `fetchUserBetHistory`, and `placeBet`. Lesson logged as task #130 for a formal ADR.

---

## Authentication flow

```
   User clicks "Sign in with Google" on /login
                  │
                  ▼
   redirect → supabase.auth.signInWithOAuth({ provider: "google" })
                  │
                  ▼
   Google consent screen
                  │
                  ▼
   Google → callback → /auth/callback (Next route handler)
                  │
                  ▼
   supabase.auth.exchangeCodeForSession()
                  │
                  ├─ writes httpOnly cookies (sb-access-token, sb-refresh-token)
                  │
                  ▼
   redirect → "/" (or "/onboarding" if user has no watchlist)
```

### Server-side claim reading

In every RSC that needs the user:

```ts
const supabase = await createClient();        // wraps cookies()
const { data, error } = await supabase.auth.getClaims();
if (error || !data?.claims) redirect("/login");
const userId = data.claims.sub as string;
```

`getClaims()` parses the JWT locally (signed by Supabase) — no round-trip to verify. Fast and cookie-safe.

### Proxy / public-crawlable routes

`src/lib/supabase/proxy.ts` defines `isPublicCrawlable` — `/login`, `/about`, `/og/*`, `/stock/*`, `/robots.txt`, `/sitemap.xml`. These bypass auth so social-card unfurlers (Twitter/LinkedIn) can fetch them without a session. Crucial after we shipped OG share cards — without this, the unfurl bot would get a 302 to `/login` and never read the `og:image` meta tag.

---

## Python pipeline

### Three workflows

| Workflow | When | Output |
|---|---|---|
| `fetch_insights.py` | 8 PM ET Mon–Fri | Fresh `stock_insights` row per stock, top-3 articles, per-source audit |
| `resolve_predictions.py` | 5:15 PM ET Mon–Fri | WIN/LOSS/VOID outcomes, credit payouts, badge awards |
| `compute_leaderboard.py` | 7 PM ET Sun | `weekly_leaderboard` snapshot |

### Orchestrator skeleton (`fetch_insights.py`)

```
for each stock in active universe (50):
    │
    ├─ price_snapshot ← YFinancePriceFetcher (OHLCV, RSI, MACD)
    ├─ articles ← MassiveNewsFetcher (news for the past 24h)
    ├─ analyst ← FinnhubAnalystFetcher (consensus + rating changes)
    ├─ insider ← SecInsiderFetcher (form-4 transactions)
    ├─ social ← StockTwitsFetcher + ApeWisdomFetcher (+ optional Reddit)
    │
    ├─ sentiment_scores ← FinBERTSentimentProcessor(articles)  # local
    ├─ tldrs ← LlamaSummarizer(articles)                       # HF API
    │
    ├─ bucket_scores ← Aggregator(price, articles, analyst, insider, social)
    │
    ├─ verdict ← compute_verdict(bucket_scores, realized_vol=20d_std)
    │   ├─ vol-normalized direction threshold (ADR 0014)
    │   ├─ Llama-generated reasoning (or rule-based fallback)
    │
    └─ write to stock_insights, insight_articles, marketmind_predictions

# After all stocks:
rank_predictions(all_marketmind_predictions)  # cross-sectional ranking
write rank_in_universe back to each row       # ADR 0015
```

### Why one orchestrator, not 50 parallel runs

Massive's Starter tier rate-limits at 100 calls/min. With 5 sources per stock × 50 stocks = 250 calls, sequential bursts violate it; semaphore-throttled parallel doesn't gain much because FinBERT is CPU-bound on the runner anyway. Net runtime ~15-25 min on a cold cache, sub-15 on a warm one. Within GH Actions' 60-min job budget with plenty of headroom.

### Failure modes — every fetcher is independent

Each fetcher returns `Result[T] | None`. The orchestrator writes whatever succeeded to `stock_insight_sources` (the audit log) and proceeds. A failed Reddit fetch doesn't kill the run; it leaves the social bucket with one fewer signal contribution and the bucket-renormalization handles it. Same for any single news article failing — top-3 might end up top-2, and the UI shows what landed.

### Resolution job (`resolve_predictions.py`)

Two-mode resolution per ADR 0017:

1. **Pre-market user bets** (placed before 9:30 AM ET on the trading day): scored `sign(close − open)`.
2. **In-market user bets** (placed 9:30 AM–1 PM ET): scored `sign(close − entry)` where entry is the live Finnhub price at placement.
3. **MarketMind's own verdict**: scored `sign(close − prev_close)` — different window because the verdict was made the night before (the overnight gap is part of the prediction).

Each prediction's reference price comes from `_choose_reference_price(bet, open, prediction_date)`. A hardcoded `RESOLUTION_V2_CUTOFF` grandfathers all bets placed before the model change — old contracts honored.

Resolution updates the bet row, inserts a credit-ledger entry, bumps `user_profiles.correct_predictions` / `total_predictions`, fires badges. All inside a single transaction per bet via the `mark_resolved` flow.

---

## Data sources

| Source | Cost | What it contributes | Failure handling |
|---|---|---|---|
| **Massive (Polygon Starter)** | $29/mo | Historical OHLCV, news articles, ticker reference | Pipeline-wide rate-limit; fails the run if 429s persist |
| **Finnhub free** | $0 | Real-time quotes (live price), analyst consensus | Cache to Upstash 5min; UI falls back to `prev_close` on failure |
| **yfinance (Yahoo)** | $0 | Supplemental OHLCV, fallback when Massive has stale data | Uses `curl_cffi` to impersonate Chrome — Yahoo blocks default UA. No SLA |
| **SEC EDGAR** | $0 | Insider transactions (form-4), 8-K filings | Soft-skip; missing CIK means `tech=None` flag in the source audit |
| **StockTwits** | $0 | Bullish/bearish message ratio over 24h | Returns null on rate-limit; bucket renormalizes |
| **ApeWisdom** | $0 | r/wallstreetbets mention rank | Same null-tolerant handling |
| **Reddit (PRAW)** | $0 | General-stocks subreddit mention counts | Optional — missing creds = silent skip |
| **FRED** | $0 | VIX, sector ETF aggregates (macro context) | One call per run, not per stock |
| **MarketWatch (scrape)** | $0 | Headline summaries (deprecated tier, kept as fallback) | Session cookie expires; treated as graceful miss |
| **HuggingFace Inference** | Free + Pro | Llama-3 / Mistral for verdict reasoning | Circuit breaker after N failures → rule-based fallback |

### Why so many sources?

The transparency promise is the differentiator. A user can click any bucket score and see exactly which sources contributed and what each one said. The technical bucket alone doesn't decide a verdict — it has to agree (or disagree explicitly) with sentiment + professional + social, and the per-source audit log proves it.

### Cross-source agreement

Each insight row carries `cross_source_agreement_count` — how many of the four buckets pointed the same way. UI surfaces this as a quality indicator: a 4-of-4 agreement bet is shown with a "strong signal" badge; a 2-of-4 mixed-signal bet gets a NEUTRAL chip with explicit "mixed signals" copy rather than a forced UP/DOWN.

---

## AI/ML — FinBERT + Llama

### FinBERT — local CPU inference

`ProsusAI/finbert` (HuggingFace) labels each article positive / neutral / negative. We *used* to call HuggingFace's Inference API for each article — which produced a 45-min timeout on free tier due to cold-start latency × hundreds of articles. Now FinBERT loads once per pipeline run via `transformers` + CPU-only `torch`, batches all of a stock's articles into a single forward pass, and runs in ~30s on warm cache. The model files (~440MB) live in a GH Actions cache keyed on `sentiment.py` + `requirements.txt` so a code change to the processor invalidates it but a routine workflow run reuses the cache.

**Interview talking point:** *"This was the single biggest reliability win in the pipeline. I watched a 45-minute run get killed by `ReadTimeoutError`s coming back from HF's free-tier inference endpoint. Moving FinBERT local trades ~200MB of CPU-only torch download for full control over latency. Same model, same scores, no shared rate limit. The CI runner is plenty powerful for batched inference on 50 stocks × ~10 articles each."*

### Llama-3 / Mistral — verdict reasoning

The LLM produces the one-sentence English explanation under each verdict chip. Output is consumed verbatim by the UI:

> *"Bullish — driven by strong analyst upgrades and a constructive technical setup."*

We can't run a 7B-param model on a free CI runner, so this stays on HF Inference. A shared circuit breaker (`pipeline/processors/_hf_breaker.py`) tracks consecutive failures across both Llama (for reasoning) and the summarizer (for article TL;DRs). After `TRIP_THRESHOLD = 5` consecutive failures, subsequent HF calls short-circuit to:

- For verdict reasoning: a rule-based fallback that enumerates the top driving buckets in plain English ("Bullish — 12 of 14 analysts rate Buy, recent upgrade; oversold RSI, MACD bullish crossover.").
- For article TL;DRs: skip the field entirely; UI shows the article title without an abstract.

Self-healing: a single successful call resets the counter. A transient wobble doesn't permanently disable the LLM path.

### Richer rule-based fallback reasoning

The fallback isn't generic. Each bucket has a `_describe_*` helper in `pipeline/processors/verdict.py` that turns the underlying signal data into a concrete phrase:

- *"12 of 14 analysts rate Buy, recent upgrade"* — from `breakdown.professional`
- *"oversold RSI, MACD bullish crossover"* — from `breakdown.technical`
- *"news positive 8 / negative 2"* — from `breakdown.sentiment`
- *"high herding intensity, damped social signal"* — from `breakdown.social`

So a NEUTRAL verdict with LLM down still produces *"Mixed — 10 of 14 analysts rate Buy pulling up, overbought RSI pulling down. No clear read."* — instead of the older generic *"Bullish — driven primarily by professional and technical signals."* Backwards compatible: callers without a breakdown attached fall through to the old name-based phrasing.

**Interview talking point:** *"NLP gracefully degrades. Sentiment is the only AI-dependent bucket, and even there FinBERT runs locally as the primary path — the LLM-via-HF is reasoning text on top of already-computed scores. If HuggingFace is completely down, users see verdicts with rule-based reasoning that's still specific and useful — '12 of 14 analysts rate Buy, oversold RSI, MACD bullish crossover' — not just 'driven by professional and technical.' The math is unchanged."*

---

## Caching — Upstash Redis

Two unrelated workloads share one Upstash database via distinct key prefixes. See [README.md → "How we use the cache"](../README.md#how-we-use-the-cache).

### Workload 1 — Rate limiting (`mm:rl:*`)

`@upstash/ratelimit` sliding-window per user:

```ts
const { ok, retryAfter } = await rateLimit("placeBet", userId);
if (!ok) return { ok: false, error: `Slow down — retry in ${retryAfter}s` };
```

Limits are intentionally generous — 10 bets/min, 3 daily-claim attempts/min — to make "runaway useEffect / stale fetch on a tap" non-destructive, not to enforce business logic (the RPCs themselves have stronger invariants). Fails open: missing Upstash creds → `{ ok: true }`. A misconfigured cache shouldn't lock everyone out.

### Workload 2 — Live-price cache (`mm:price:*`)

```ts
const livePrices = await getLivePrices(watchlist.map((s) => s.ticker));
```

1. `MGET` all tickers' cache keys in one round-trip
2. For misses, fetch Finnhub `/quote` in parallel via `Promise.allSettled`
3. Write fresh values back: 300s TTL for successful quotes, 60s TTL for nulls (negative cache so we don't hammer a failing ticker)

**Why shared Redis instead of Next's `unstable_cache`:** Vercel's serverless model spins up multiple function instances under load. `unstable_cache` is per-instance — with cold starts, 50 stocks × N instances could blow through Finnhub's 60/min limit. Shared Upstash gives us O(stocks / TTL) calls per cache window regardless of user count: ~10 Finnhub calls/min worst case at 50 stocks + 5-min TTL.

---

## Rate limiting + security

### Mutation surface

Every server action that writes:

1. Calls `rateLimit(name, userId)` first
2. Awaits the Supabase RPC (which is RLS-protected — can't write on another user's behalf)
3. On success, `revalidatePath()` to refresh the affected pages

The mutation surface is small and explicit: `placeBet`, `cancelBet`, `claimDailyBonus`, `markPredictionsRevealed`, `updateWatchlist`. Every other interaction is a read.

### Secret hygiene

- **Service role key** — GitHub Actions secret + Vercel env var, never in client code. Bypasses RLS, full DB write. Pipeline uses it; the website uses the anon key (RLS-respecting) by default and only escalates to service role for specific server actions that need cross-user reads (e.g. leaderboard).
- **PATs** — fine-grained, repo-scoped, 1-year expiry. The Cloudflare Worker uses one to dispatch workflows. Rotation is `wrangler secret put GITHUB_PAT` — atomic, no redeploy needed.
- **Database password** — used only by `apply-migrations.yml` (`supabase db push`). The website + pipeline both use connection-string-free Supabase REST.
- **AGENTS.md rule** — Claude has read-only DB access for diagnostics via `psql "$SUPABASE_DB_URL"`. Writes go through migrations, never direct psql. Cuts down "let me ask the user to paste console output" friction for me without expanding the blast radius.

### Defense in depth

| Layer | Protection |
|---|---|
| **Network** | Vercel TLS, Supabase TLS, both behind their respective CDNs |
| **Auth** | OAuth-only, no password handling, JWTs signed by Supabase |
| **Authorization** | RLS at the database — even if the API leaks, Postgres refuses to return other users' rows |
| **Mutations** | Atomic RPCs with `SECURITY DEFINER`; rate-limited per user; revalidate cache on success |
| **CSP** | Default-strict via Vercel + Next |

---

## Scheduling — Cloudflare Worker cron

Original design: `schedule:` blocks in three GitHub Actions YAMLs. Observed: 3-hour drift on first eligible run, plus GH's own docs admit schedules can be delayed hours during high load and occasionally skipped.

Replacement: a tiny Cloudflare Worker (~80 LOC) declares three CF cron triggers and POSTs to GH's `workflow_dispatch` API on each fire. The Worker is the single source of truth for pipeline timing; the GH workflows now only expose `workflow_dispatch:` (rock-solid trigger).

**Interview talking point:** *"GitHub Actions cron is best-effort. Cloudflare Workers cron is reliable to about one minute, and I already had a Cloudflare account for DNS so the new vendor surface was zero. Eighty lines of TypeScript replaced an unreliable native feature with one that meets the SLA my product implicitly promises."*

Full ADR rationale + alternatives matrix in [ADR 0016](adr/0016-external-cron-via-cloudflare-worker.md).

---

## Deployment

### Push-to-main flow

```
git push origin main
   │
   ├─→ Vercel detects push, builds Next.js, deploys to marketmind.neeleshkakaraparthi.dev (~60s)
   │
   └─→ GitHub Actions runs:
         • test.yml      (lint + typecheck + vitest + pytest)
         • playwright.yml (e2e against the deployed Vercel build)
         • [no schema change] no migration runs unless apply-migrations is dispatched manually
```

### Schema changes (manual)

```
1. Author migration file → supabase/migrations/<timestamp>_name.sql
2. Open PR → validate-migrations.yml runs (CI catches syntax errors)
3. Merge to main
4. Trigger apply-migrations.yml from GH Actions UI with confirmation="migrate"
5. supabase db push applies it
6. Confirm with a manual SELECT against schema_migrations
```

### Custom domain

`marketmind.neeleshkakaraparthi.dev` — Cloudflare DNS (proxy off, so Vercel handles TLS directly). Vercel Deployment Protection is enabled on `*.vercel.app` preview URLs but the custom domain is publicly reachable. Playwright on push targets the custom domain to bypass the protection.

### Cloudflare Worker deploy

Manual: `npx wrangler deploy` from `workers/cron-trigger/`. Doesn't change often (only when adding or shifting cron schedules), so manual is fine. Could be CI'd in the future if the cadence increases.

---

## Testing strategy

| Layer | Tool | Count | What it locks in |
|---|---|---|---|
| **Frontend unit** | Vitest + jsdom | 88 (9 files) | Pure helpers — market schedule, verdict computation, bet math (incl. resolution-mode mirroring), badges, bonus math, live-price cache, Wilson interval, prediction-feedback RPC mapping |
| **Frontend e2e** | Playwright | 7 | Public-surface smoke (login, about, og/og-404, anon stock detail, skip-link first tab, custom-domain reachability) |
| **Pipeline unit** | pytest | ~40 (6 files) | Verdict scoring (incl. richer fallback reasoning), social bucket fade-the-crowd, cross-sectional ranking, ticker normalization (BRK.B → BRK-B), resolution-mode discriminator (incl. DST boundaries) |

### Coverage gates

`vitest.config.ts` enforces minimum thresholds — currently **10% lines / 7% functions / 5% branches / 10% statements**. They're floors, not ceilings, set just below current measured coverage so a routine drop doesn't red CI but a major regression would. As more helpers gain coverage we ratchet up.

### CI integration

`.github/workflows/test.yml` runs two parallel jobs:

- **js** — `npm ci → lint → typecheck → vitest run --coverage` (HTML report uploaded as 14-day artifact)
- **python** — `pip install → pytest --cov=pipeline` (XML + HTML coverage uploaded)

Both fire on every PR and on push to main.

`.github/workflows/playwright.yml` runs after Vercel finishes deploying (via `patrickedqvist/wait-for-vercel-preview` on PR, custom domain on push). Targets Pixel 7 mobile + Desktop Chrome viewports. Failure artifacts (traces + screenshots) uploaded for 7 days.

### What I don't test

- **Component rendering** — Vitest doesn't run jsdom against my full RSC tree (Next would need a custom setup). Playwright covers the rendered output end-to-end.
- **Live API calls** — fetchers are mocked in unit tests. The pipeline's real-world behavior is verified by the actual nightly run + Sentry.
- **RLS policies** — Supabase doesn't have a great unit-test story for RLS. Manually tested via `psql` as different roles; not regression-locked.

---

## Observability

### Errors — Sentry

Three runtimes wired (`@sentry/nextjs@10`):

- `sentry.server.config.ts` — Node.js server-side
- `sentry.edge.config.ts` — Edge runtime (OG images)
- `instrumentation-client.ts` — Browser

Dormant by default — without `NEXT_PUBLIC_SENTRY_DSN` set, Sentry no-ops. Activates on a flip when we have real users (gated on 30+ users per the PostHog/Sentry deferral).

`SentryUserIdentifier` (client component in root layout) attaches the current user's display name + id to every event after auth resolves. Stack traces in the dashboard carry user context.

### Pageviews + Web Vitals — Vercel Analytics

`@vercel/analytics`'s `<Analytics />` mounted in root layout. First-party, no DSN needed, auto-detects the Vercel deployment env. Captures pageviews, top pages, referrers, devices, and Core Web Vitals (LCP/CLS/INP/FCP/TTFB — the same metrics Google uses for SEO ranking). Free on Hobby up to 2,500 events/month.

### Pipeline observability

Every run inserts a row into `pipeline_runs` with start/end timestamps + status (success/failed/partial). Per-stock source success/failure goes into `stock_insight_sources`. So I can answer "did NVDA's SEC fetch succeed in last night's run?" with a single `SELECT`.

Cloudflare Workers logs every dispatch via `wrangler tail` — useful for debugging "did the cron actually fire?".

### Future — task #122

`/admin/pipeline-health` will surface "last successful run was N hours ago, expected within 24h" as an in-app diagnostic. Pending.

---

## Cost breakdown

| Service | Tier | Monthly cost |
|---|---|---|
| Vercel | Hobby | $0 |
| Supabase | Free | $0 |
| GitHub Actions | Free (public repo) | $0 |
| Cloudflare | Free (Workers + DNS) | $0 |
| Upstash Redis | Free | $0 |
| Massive (Polygon) Stocks Starter | Paid | $29 |
| HuggingFace Pro | Paid | $9 |
| **Total** | | **~$38/mo** |

Free-tier ceiling is comfortable for current scale (3 users, 50 stocks). The two paid services are deliberate — Massive's news + EOD prices and HF's Llama inference are both unavailable at the free tier with usable quality.

---

## Key trade-offs

These are the ADRs I'd point to in an interview as "the interesting decisions." Each has a full alternatives matrix in `docs/adr/`.

### [ADR 0002 — Supabase over Neon](adr/0002-supabase-over-neon.md)

**Decision:** Supabase, not Neon-plus-auth0-plus-realtime-plus-storage.
**Why:** the auth product alone saves 2 days. RLS is the killer feature for a multi-user app. Cost roughly equal at free tier. Trade-off accepted: less control over Postgres version, slightly more vendor lock-in.

### [ADR 0006 — Migrations via GitHub Actions](adr/0006-migrations-via-github-actions.md)

**Decision:** all schema changes flow through a manually-confirmed GH Actions workflow.
**Why:** prevents accidental prod schema changes via local CLI; PR review for migration code; auditable run history. Trade-off accepted: ~30s slower than `supabase db push` from a dev's terminal.

### [ADR 0008 → ADR 0017 — Bet window + resolution math](adr/0017-entry-vs-close-resolution-for-in-market-bets.md)

**Decision history:** originally `open → close` for all bets to keep math simple (ADR 0008). After watching real users place mid-day bets, moved to a two-mode model: pre-market bets keep `open → close`, in-market bets use `entry → close` where entry is the live price at placement (ADR 0017).
**Why the change:** a 12:30 PM bettor with the stock already up 2% only needed close to stay above open — a much easier bar than the 8 PM bettor who had to predict the whole day. Fairness > simplicity once the live-price layer was in place.

### [ADR 0012 — Local FinBERT + HF circuit breaker](adr/0012-local-finbert-and-hf-breaker.md)

**Decision:** FinBERT runs locally on the pipeline runner; HF stays only for the LLM reasoning text, gated by a shared circuit breaker.
**Why:** HF rate limits caused a 45-min production timeout. Moving FinBERT local eliminated the shared-resource dependency for the highest-frequency NLP call.

### [ADR 0013 — Social bucket "fade the crowd"](adr/0013-social-bucket-fade-the-crowd.md)

**Decision:** social signals (Reddit, ApeWisdom rank) contribute **negatively** when crowd intensity is high. StockTwits sentiment is damped (not inverted) when herding is detected.
**Why:** academic literature (Barber & Odean 2008; Da-Engelberg-Gao 2011) consistently finds retail-attention spikes precede underperformance for non-meme tickers. Default-amplifying social signals was actively misleading.

### [ADR 0014 — Vol-normalized direction threshold](adr/0014-vol-normalize-direction-threshold.md)

**Decision:** the threshold for calling UP/DOWN (vs NEUTRAL) scales with each stock's 20-day realized volatility.
**Why:** flat 0.15 threshold under-called quiet names (PG, σ≈0.9%) and over-called noisy ones (NVDA, σ≈3.5%). Same combined-score magnitude means very different things at different vol regimes.

### [ADR 0015 — Cross-sectional ranking](adr/0015-cross-sectional-ranking.md)

**Decision:** every prediction gets a `rank_in_universe` (1 = strongest bullish, N = strongest bearish) plus a `combined_score` column.
**Why:** absolute signal magnitudes are noisy across the universe; the actionable info lives in *relative ordering*. Top-quintile vs bottom-quintile is the unit that translates to a long-short factor framework. Powers the "Highest conviction long / short" UI on the home page.

### [ADR 0016 — External cron via Cloudflare Worker](adr/0016-external-cron-via-cloudflare-worker.md)

**Decision:** Cloudflare Worker dispatches GH workflows instead of `schedule:` triggers.
**Why:** GH Actions cron drifted multi-hour on first eligible run. CF cron is reliable to ~1 min. Worker is ~80 LOC, code lives in repo, $0 cost.

---

## Mistakes I made and what I learned

These are the ones I'd talk about candidly — interview signal for self-awareness.

### 1. Polygon snapshot tier confusion

I built the live-price feature against Polygon's `/v3/snapshot` endpoint based on "free tier provides 15-min delayed quotes" in their marketing copy. Shipped, opened the page, prices still showed yesterday's close. Diagnosed with a single curl: endpoint returns `403 NOT_AUTHORIZED` on free tier, gated to the $29/mo Starter plan. Swapped to Finnhub's `/quote` endpoint (free, real-time, 60/min) in ~40 minutes.

**Lesson logged:** when an API tier is load-bearing for a design decision, verify with one curl call before shipping. Marketing copy is not a substitute for hitting the endpoint.

### 2. Badge migration missed a backfill

Shipped the badges migration that added `FIRST_BET` award logic to `place_bet`. Worked correctly for new users. Didn't fire for the user (me) who had already placed 5 bets before the migration applied — `v_total_after = 1` only holds on the *first ever* prediction. Wrote a backfill migration to retroactively award `FIRST_BET` to any user with predictions but no badge.

**Lesson logged:** when a migration adds a "trigger on first event" check, also include a backfill for users who already passed that event. Filed task #130 to write an ADR + lint rule.

### 3. The "wait, why did I lose?" UX gap

Users place a bet, the day goes by, the resolution job fires, and... no signal in the UI about what actually happened. Closed it in three layers: capture `price_at_placement` at bet time; show "open $X → close $Y · ±Z%" subline on resolved rows; reveal modal opens the next time the user lands on home with new resolved bets, with confetti on WIN and entry-vs-open-vs-close prices all visible.

**Lesson logged:** the result-reveal moment is the most important user-facing feedback loop in the app. Got it wrong in v1 (just a toast); got it right after watching myself bet and feeling the gap.

### 4. GH Actions schedule reliability assumption

Assumed `schedule:` in a workflow YAML would fire on time. Caught the drift watching the first cron run land 3 hours late. Moved to Cloudflare Workers for cron, GH only for runner execution.

**Lesson logged:** infrastructure SLAs are real — don't outsource the reliability story to a tier that doesn't promise it.

### 5. Original verdict resolution window

Resolved MarketMind's own verdicts against `open → close` initially, same as user bets. Realized the verdict was *frozen at 8 PM the previous day* — measuring it against `open → close` discards the overnight gap, which is where most pre-open news gets priced in. Fixed to `prev_close → close`. Documented in [ADR 0011](adr/0011-signal-quality-p0-fixes.md).

**Lesson logged:** scoring windows must match the prediction-decision time. Different actors (user vs model) made decisions at different times — they need different windows.

### 6. PostgREST inner joins silently filter to empty when joined table has no SELECT policy

Shipped the promo-code redemption feature. Tables: `promo_codes` (admin catalog — deny-all RLS, writes via service-role, reads via SECURITY DEFINER RPC) and `promo_code_redemptions` (per-user ledger — own-read RLS). Redemption RPC worked perfectly: credits landed, ledger row inserted, daily-cap counter incremented correctly.

But the "Recent redemptions" list in the credits dialog rendered empty after the sheet was reopened. The optimistic in-memory entry showed for a moment (the local `setData` after a successful redeem) and then vanished on the next lazy-fetch.

**Root cause.** The history query lived in `fetchRecentRedemptions`:

```typescript
.from("promo_code_redemptions")
.select("credits, redeemed_at, promo_codes!inner(code)")
.eq("user_id", userId)
```

The `promo_codes!inner(code)` is PostgREST embed syntax for an inner join. PostgREST evaluates RLS on **both sides** of an embedded join — on `promo_code_redemptions` (own-read policy, OK) and on `promo_codes` (no SELECT policy, deny-all). With no policy granting the authenticated role read access, every joined `promo_codes` row got filtered out. Because `!inner` requires the joined row to exist, every parent row was filtered too. Result: empty list, no error.

This isn't a Postgres-specific weirdness — it's how RLS interacts with row visibility everywhere. The mental model is: an RLS policy doesn't "deny" the query; it **filters** what's visible. With no policy, nothing is visible. A normal `SELECT … FROM promo_code_redemptions JOIN promo_codes …` query through a regular client would behave identically: zero rows, no error, no log line.

The daily-cap counter (which sums `credits` from `promo_code_redemptions` only — no join) worked correctly because that query never touches `promo_codes`. So the bug surface was narrow to anything joining to the catalog table.

**Fix.** Migration `20260521000002` added a narrow SELECT policy on `promo_codes`:

```sql
create policy "promo_codes_redeemed_read" on promo_codes
  for select
  using (
    exists (
      select 1 from promo_code_redemptions
      where code_id = promo_codes.id and user_id = auth.uid()
    )
  );
```

Users can now read code text **only for codes they've redeemed**. Catalog enumeration is still blocked — listing all active codes still requires service-role.

**Why this is a *good* interview story.** It touches several non-obvious things at once:

1. **PostgreSQL Row-Level Security is a *visibility* primitive, not an *access denial* primitive.** No error, no exception, just rows that don't exist from the caller's perspective. The same SQL runs successfully — it just returns different row counts depending on who's asking.

2. **PostgREST embed joins respect RLS on both tables.** This is sometimes counterintuitive — you might think "I have a read policy on the parent, that's enough." It isn't.

3. **Test against real RLS, not service-role.** Service-role bypasses RLS entirely, so a service-role test would have shown the join working perfectly. The bug only manifests for the authenticated role the actual user is running with. Tests that use Supabase fixtures with service-role can paper over this entire class of bug.

4. **Lint, typecheck, build, and unit tests all passed.** The failure mode is a runtime interaction between schema + policies + query shape. The only thing that catches it is end-to-end manual or e2e testing — which is exactly how I found it (user smoke test of the redeem flow).

5. **The cleanest fix is a narrow policy, not a denormalization.** I considered storing `code text` directly on `promo_code_redemptions` so the join goes away. That works but couples the schema to a UI concern (the dialog needs the code string) and creates a denormalization that has to be kept in sync if codes are ever renamed (they aren't, but the principle bites elsewhere). The narrow policy is the simpler fix and aligns the data model with the access policy.

**Lesson logged:** for any Supabase read path, enumerate the tables it touches (direct + every PostgREST embed), and confirm the calling role has a SELECT policy that resolves to non-empty rows on each. When in doubt, test the read path against a logged-in browser session, not service-role.

---

## What's next

Filed but not yet shipped:

- **#119 — Activate Sentry on prod** (gated on 30+ users)
- **#120 — Wire PostHog** (different question from Vercel Analytics; gated on user count)
- **#122 — `/admin/pipeline-health` view** — surfaces "last successful run N hours ago" so silent failures don't bite
- **#130 — ADR + lint rule for graceful migration-pending degradation** — codify the try/catch fallback pattern
- **#133 — Python tests for `resolve_predictions` + `compute_leaderboard`** — symmetry with the JS test coverage
- **#134 — CI block PR merge on test/lint/typecheck failure** — requires a PR flow (currently solo-direct-to-main)

---

## Common interview questions

### "Walk me through this project."

→ [The 2-minute walkthrough](#the-2-minute-walkthrough)

### "Why X over Y?" (Supabase, Next.js, etc.)

→ [Tech stack — every choice and why](#tech-stack--every-choice-and-why)

### "How does authentication work?"

→ [Authentication flow](#authentication-flow) — Google OAuth via Supabase Auth, JWT in httpOnly cookies, RLS at the DB layer for defense in depth. Public crawlable routes bypass auth for OG unfurlers.

### "How do you ensure data integrity on mutations?"

→ [Backend — SECURITY DEFINER RPCs](#backend--database--rls). Every state-changing operation is a single Postgres transaction. Server actions call the RPC and then `revalidatePath()`. Rate-limit gate runs before the RPC call.

### "How does the pipeline scale?"

→ [Python pipeline](#python-pipeline). One orchestrator, 50 stocks, ~10 sources each. Bottleneck is Massive's rate limit, not compute. Each fetcher is independent and failure-isolated. Net runtime 15-25 min.

### "What's your testing strategy?"

→ [Testing strategy](#testing-strategy). Vitest for unit (~80 cases), Playwright for e2e (~7 cases), pytest for pipeline (~50 cases). Coverage thresholds gate CI.

### "How do you handle failures in the data pipeline?"

→ Each fetcher is independent. Failure of one source writes a row to `stock_insight_sources` audit log and the orchestrator continues. The bucket renormalization step in `compute_verdict` handles missing inputs gracefully. HF Inference has a circuit breaker that falls back to rule-based reasoning after N failures. The numerical signal is never blocked by an AI service outage.

### "What's the most interesting technical decision?"

→ Take your pick from [Key trade-offs](#key-trade-offs). My personal favorite is the social bucket "fade the crowd" rewrite (ADR 0013) because it actually changed the model's behavior in a measurable way grounded in academic literature.

### "How do you handle secrets?"

→ [Rate limiting + security](#rate-limiting--security). Service role key only on the pipeline runner + Vercel env. Database password only used by the migration workflow. Fine-grained PATs with 1-year expiry. `.env.local` for local dev, `.gitignore`'d.

### "Walk me through a feature end-to-end."

→ Pick any. The bet placement flow is a good one: `BetSheet` (client) → `placeBet` server action → `rateLimit()` → `supabase.rpc("place_bet", ...)` → atomic txn (validate balance, lock bet, insert ledger entry, maybe award FIRST_BET) → return prediction row → server action calls `revalidatePath` → home feed RSC re-renders with the locked-in bet chip. Sonner toast on success.

### "What would you do differently?"

→ Three things: (1) Verify API tier capabilities before designing around them (the Polygon mistake). (2) Backfill on every migration that adds a first-event check (the badges mistake). (3) Don't rely on GH Actions `schedule:` for anything with an SLA (the cron drift).

### "Where would this break under load?"

→ The Massive Starter tier rate limit (100/min) is the hardest cap. At ~50 stocks × 10 sources per pipeline run, we use roughly 30/min sustained — 3x headroom. A 10x stock universe (500 stocks) would saturate it. Solutions: parallel batched workers, or move to Polygon's Developer tier ($79/mo, unlimited).

### "What's the most error-prone part?"

→ The pipeline's HTTP fetchers. Each one is a different API with different rate limits, auth schemes, and failure modes. We mitigate with consistent timeouts + retry + circuit breaker patterns, but new vendors (and existing vendors changing API shape) are the most common cause of pipeline failures.

### "How do you handle deployments?"

→ [Deployment](#deployment). Push-to-main auto-deploys to Vercel + runs CI. Schema changes are explicit (manual workflow_dispatch with confirmation). Worker deploys are manual. Production deploys have never required a rollback — when one was wrong I shipped a forward-fix within an hour.

### "Tell me about a tricky bug you debugged."

→ The promo-code redemption RLS-join bug. Short story: after a successful code redemption, the credits were applied correctly and the daily-cap counter updated correctly, but the "Recent redemptions" history list rendered empty after the user reopened the dialog. Root cause: PostgreSQL Row-Level Security is a row-visibility filter, not an access-denial mechanism, and PostgREST embed inner-joins respect RLS on **both** tables — so my history query that joined the deny-all `promo_codes` catalog table came back with zero rows even though the redemption rows existed. Lint, typecheck, build, and unit tests all passed because the failure mode is a runtime interaction between schema + policies + query shape. Found via manual smoke test. Fixed with a narrow SELECT policy: users can read `promo_codes` rows IFF they have a redemption against them. The deep section: see ["6. PostgREST inner joins…"](#6-postgrest-inner-joins-silently-filter-to-empty-when-joined-table-has-no-select-policy).

### "How does Postgres RLS actually work?"

→ RLS rewrites the query plan: every `SELECT` against a table with RLS effectively gets an `AND <policy_expression>` appended for the calling role. Policies are *filters*, not *deny lists* — with no policy, the implicit filter is `false`, so the visible row count for that role is zero (no error, just empty). Service-role bypasses RLS entirely (that's why we use it for admin/pipeline writes). The non-obvious piece: when a query joins two RLS-protected tables (via SQL join or PostgREST embed), the policies on **each table** filter independently before the join. So if you have a strict policy on one side and a loose policy on the other, the strict side gates the result. This is why a working own-read policy on `promo_code_redemptions` wasn't enough — the joined `promo_codes` table also needed a (narrow) policy for the user's redemption-history query to return rows.

---

*Last updated: 2026-05-21 (Day 4, in progress).*
