# MarketMind — Implementation Plan

> Multi-source stock intelligence platform with daily prediction mechanic.
> Enterprise-grade build, friends-first launch, showcase-quality engineering.
> Production URL: **https://marketmind.neeleshkakaraparthi.dev**

---

## Project Rules (enforced from Day 1)

- **Documentation discipline:** Every feature shipped must update CHANGELOG.md, README.md (if user-facing), and add an ADR if a design choice was made. Every manual step encountered goes into docs/SETUP.md or docs/RUNBOOK.md. A feature is not "done" until docs are updated. See [ADR 0001](docs/adr/0001-documentation-as-rule.md) for the reasoning.
- **No half-finished work:** Either ship a feature complete (code + tests + docs) or don't merge it.
- **ADRs for non-obvious choices:** If a future reader might wonder "why did they do this?", write an ADR.

## Decisions Locked

| Question | Decision |
|----------|----------|
| Build philosophy | Enterprise-grade architecture, trust-through-transparency UI, gamification as frontend showcase |
| Timeline | **5 days** (~50 focused hours) |
| Paid data stack | **Lean ($38/mo)**: Massive Starter ($29, formerly Polygon.io) + HuggingFace Pro ($9) |
| Show verdict (UP/DOWN call)? | **No** — signal breakdown only, user interprets |
| Article TL;DRs | **Yes** — Llama-3 via HuggingFace Pro for 1-sentence summaries |
| Pipeline runtime | GitHub Actions (Python cron) |
| Backtest harness | **Week 2** post-MVP (great showcase piece) |
| MarketWatch | Best-effort scrape with subscription cookie (no proxies in MVP) |
| Domain | marketmind.neeleshkakaraparthi.dev (subdomain) |
| Payout odds | Fixed 1.8x for MVP (crowd-split post-launch) |
| Stock pool | 50 curated tickers |
| Legal | Disclaimer footer (no lawyer needed for friends-only + virtual currency + no verdict) |

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Architecture](#architecture)
3. [Data Sources](#data-sources)
4. [Database Schema](#database-schema)
5. [Insights Pipeline](#insights-pipeline)
6. [Signal Engine](#signal-engine)
7. [Trust UI Patterns](#trust-ui-patterns)
8. [API Routes](#api-routes)
9. [Frontend Pages](#frontend-pages)
10. [Gamification (Frontend Showcase)](#gamification-frontend-showcase)
11. [Enterprise Standards](#enterprise-standards)
12. [Deployment](#deployment)
13. [Execution Plan (5 days)](#execution-plan)
13. [Post-MVP Roadmap](#post-mvp-roadmap)

---

## Tech Stack

| Layer | Choice | Tier |
|-------|--------|------|
| Frontend | Next.js 15 (App Router) + Tailwind + shadcn/ui | TypeScript strict |
| Auth | Supabase Auth (Google + Apple) | Free tier |
| Database | Supabase Postgres + RLS | Free tier (Pro later) |
| Cache + Rate limiting | Upstash Redis | Pay-per-request |
| Pipeline | Python in GitHub Actions | Free 2000 min/mo |
| Stock data | Massive Stocks Starter (formerly Polygon.io) | $29/mo |
| NLP — Sentiment | FinBERT via HuggingFace Pro | $9/mo |
| NLP — Summaries | Llama-3 via HuggingFace Pro | included |
| Error tracking | Sentry free tier | Free |
| Product analytics | PostHog Cloud | Free (1M events) |
| Hosting | Vercel | Free tier |

**Monthly cost: ~$38** (excluding the MarketWatch subscription you already pay).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                  GITHUB ACTIONS (PIPELINE)                        │
│                                                                   │
│  fetch-insights.yml          resolve-predictions.yml              │
│  cron: 0 0 * * 2-6           cron: 15 20 * * 1-5                  │
│  (8 PM ET, Mon-Fri night)    (4:15 PM ET, Mon-Fri)                │
│                                                                   │
│  Python orchestrator:                                             │
│    ├── Tier 1 (paid APIs)     → Massive (formerly Polygon.io)    │
│    ├── Tier 2 (free APIs)     → Finnhub, SEC EDGAR, StockTwits,   │
│    │                            Reddit, ApeWisdom, FRED, yfinance │
│    ├── Tier 3 (best-effort)   → MarketWatch (with subscription)  │
│    │   no proxies for MVP                                         │
│    ├── NLP processing         → FinBERT sentiment + Llama-3 TL;DR │
│    └── Signal aggregator      → per-bucket scores + breakdown     │
│                                                                   │
│  Observability:                                                   │
│    ├── pipeline_runs log every execution                          │
│    ├── stock_insight_sources audit trail per source               │
│    └── Sentry alerts on failure                                   │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────┐
                  │   Supabase Postgres      │
                  │   - stocks               │
                  │   - stock_insights       │
                  │   - predictions          │
                  │   - credit_transactions  │
                  │   - user_profiles        │
                  │   - pipeline_runs        │
                  │   + Row-Level Security   │
                  └────────────┬─────────────┘
                               │
                               ▼
                  ┌──────────────────────────┐
                  │   Upstash Redis          │
                  │   - API rate limits      │
                  │   - hot insight cache    │
                  │   - bet window state     │
                  └────────────┬─────────────┘
                               │
                               ▼
                  ┌──────────────────────────┐
                  │   Next.js 15 on Vercel   │
                  │   marketmind.            │
                  │   neeleshkakaraparthi.dev│
                  │   + Sentry + PostHog     │
                  └────────────┬─────────────┘
                               │
                               ▼
                          Users (friends → public)
```

---

## Data Sources

### Tier 1 — Paid APIs (high reliability)

| Source | What it provides | Notes |
|--------|------------------|-------|
| **Massive Stocks Starter ($29)** | 15-min delayed prices (fine for daily bets), OHLCV, technicals, news API, all US exchanges | Formerly Polygon.io, rebranded 2025/2026 |
| **HuggingFace Pro ($9)** | FinBERT inference (sentiment), Llama-3 inference (TL;DRs) | Faster than free, higher rate limits |

### Tier 2 — Free APIs (broad coverage)

| Source | What it provides |
|--------|------------------|
| yfinance | Backup prices, OHLCV (no rate limit) |
| Finnhub free | Earnings dates, analyst ratings, company news |
| SEC EDGAR | Form 4 (insider), 8-K (material events), 13F |
| StockTwits API | Bullish/bearish ratio per ticker |
| Reddit API | r/wallstreetbets, r/stocks mention counts |
| ApeWisdom API | WSB-specific aggregated sentiment |
| FRED API | VIX, treasury yields, macro context |
| Google Trends (pytrends) | Search interest signal |

### Tier 3 — Best-effort scrape (no proxies, low volume)

| Source | What it provides | Notes |
|--------|------------------|-------|
| **MarketWatch** | Full article text | Use subscription cookie, fail gracefully if blocked |

**Pattern:** API-first always. The free APIs + Massive already give us 10+ sources. If we want to add scraped premium sources (Seeking Alpha, TipRanks, Zacks) later, that would require a separate residential proxy vendor (Bright Data, Oxylabs) at $50-200/mo — evaluate in Week 2 only if data quality gaps emerge.

---

## Database Schema

```sql
-- ============================================================
-- CORE TABLES
-- ============================================================

CREATE TABLE stocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker      TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  sector      TEXT NOT NULL,
  sub_sector  TEXT,
  logo_url    TEXT,
  description TEXT,
  market_cap_tier TEXT,                    -- 'mega' | 'large' | 'mid'
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE user_profiles (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id),
  display_name        TEXT,
  avatar_url          TEXT,
  credit_balance      INT DEFAULT 1000,
  total_predictions   INT DEFAULT 0,
  correct_predictions INT DEFAULT 0,
  current_streak      INT DEFAULT 0,
  longest_streak      INT DEFAULT 0,
  last_login_date     DATE,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE user_watchlist (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  stock_id UUID REFERENCES stocks(id),
  added_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, stock_id)
);

-- ============================================================
-- INSIGHTS (the heart of the product)
-- ============================================================

CREATE TABLE stock_insights (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id              UUID REFERENCES stocks(id),
  insight_date          DATE NOT NULL,

  -- Price context
  prev_close            DECIMAL(10,2),
  day_change_pct        DECIMAL(5,2),
  week_change_pct       DECIMAL(5,2),
  month_change_pct      DECIMAL(5,2),
  ytd_change_pct        DECIMAL(5,2),
  fifty_two_week_high   DECIMAL(10,2),
  fifty_two_week_low    DECIMAL(10,2),

  -- TECHNICAL bucket
  rsi_14                DECIMAL(5,2),
  macd_signal           TEXT,                  -- 'bullish_crossover' | 'bearish_crossover' | 'neutral'
  price_vs_20ma         TEXT,
  price_vs_50ma         TEXT,
  bollinger_position    TEXT,
  volume_trend          TEXT,
  technical_score       DECIMAL(4,3),          -- -1 to 1

  -- SENTIMENT bucket
  news_sentiment_score  DECIMAL(4,3),
  news_article_count    INT,
  top_headline          TEXT,
  top_headline_url      TEXT,
  top_headline_source   TEXT,
  llm_tldr              TEXT,                  -- Llama-3 generated 1-liner
  sources_agree_count   INT,                   -- how many sources are bullish/bearish together
  sources_total_count   INT,
  sentiment_score       DECIMAL(4,3),

  -- PROFESSIONAL bucket
  analyst_count         INT,
  analyst_buy           INT,
  analyst_hold          INT,
  analyst_sell          INT,
  analyst_price_target  DECIMAL(10,2),
  analyst_rating_change TEXT,                  -- 'upgrade' | 'downgrade' | null
  zacks_rank            INT,                   -- 1-5 (Week 2+ if proxy vendor added)
  tipranks_score        DECIMAL(4,1),          -- 1-10 (Week 2+ if proxy vendor added)
  insider_activity      TEXT,                  -- 'buying' | 'selling' | 'neutral'
  insider_detail        TEXT,
  earnings_date         DATE,
  earnings_in_days      INT,
  has_recent_8k         BOOLEAN DEFAULT false,
  professional_score    DECIMAL(4,3),

  -- SOCIAL bucket
  reddit_mention_count  INT,
  reddit_mention_delta  DECIMAL(5,2),
  apewisdom_rank        INT,
  stocktwits_bullish    DECIMAL(5,2),          -- 0-100
  stocktwits_messages   INT,
  google_trend_score    INT,
  social_score          DECIMAL(4,3),

  -- MACRO context (sector-level)
  sector_etf_change_pct DECIMAL(5,2),
  vix_level             DECIMAL(5,2),

  -- Full signal breakdown for UI rendering
  signal_breakdown      JSONB NOT NULL,        -- detailed per-signal contributions

  computed_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE(stock_id, insight_date)
);

-- Per-source audit trail for transparency + observability
CREATE TABLE stock_insight_sources (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_id   UUID REFERENCES stock_insights(id) ON DELETE CASCADE,
  source_name  TEXT NOT NULL,                  -- 'massive' | 'finnhub' | 'sec_edgar' | etc
  status       TEXT NOT NULL,                  -- 'success' | 'failed' | 'partial'
  fetched_at   TIMESTAMPTZ DEFAULT now(),
  latency_ms   INT,
  error_detail TEXT,
  raw_data     JSONB                           -- compact summary, not full payload
);

-- Articles surfaced per insight (for UI display + attribution)
CREATE TABLE insight_articles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_id   UUID REFERENCES stock_insights(id) ON DELETE CASCADE,
  headline     TEXT NOT NULL,
  url          TEXT NOT NULL,
  source       TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  sentiment    DECIMAL(4,3),
  tldr         TEXT,                            -- Llama-3 summary
  display_rank INT                              -- 1 = top headline
);

-- ============================================================
-- PREDICTIONS + CREDITS
-- ============================================================

CREATE TABLE predictions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  stock_id        UUID REFERENCES stocks(id),
  prediction_date DATE NOT NULL,
  direction       TEXT NOT NULL CHECK (direction IN ('UP', 'DOWN')),
  credits_wagered INT NOT NULL CHECK (credits_wagered BETWEEN 50 AND 500),
  locked_at       TIMESTAMPTZ DEFAULT now(),

  resolved        BOOLEAN DEFAULT false,
  outcome         TEXT,                          -- 'WIN' | 'LOSS' | 'VOID'
  open_price      DECIMAL(10,2),
  close_price     DECIMAL(10,2),
  payout          INT,
  resolved_at     TIMESTAMPTZ,

  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, stock_id, prediction_date)
);

CREATE TABLE credit_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  amount        INT NOT NULL,
  type          TEXT NOT NULL,
  reference_id  UUID,
  balance_after INT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- OBSERVABILITY
-- ============================================================

CREATE TABLE user_badges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_type  TEXT NOT NULL,
  earned_at   TIMESTAMPTZ DEFAULT now(),
  metadata    JSONB,                         -- e.g. {"streak_length": 7}
  UNIQUE(user_id, badge_type)
);

CREATE TABLE weekly_leaderboard_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start    DATE NOT NULL,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  rank          INT NOT NULL,
  credits_won   INT NOT NULL,
  accuracy      DECIMAL(5,2),
  predictions   INT,
  tier          TEXT,                        -- 'bronze' | 'silver' | 'gold' | 'diamond'
  UNIQUE(week_start, user_id)
);

CREATE TABLE pipeline_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type          TEXT NOT NULL,             -- 'insights' | 'resolution'
  started_at        TIMESTAMPTZ DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  status            TEXT NOT NULL,             -- 'running' | 'success' | 'partial' | 'failed'
  stocks_processed  INT DEFAULT 0,
  sources_succeeded INT DEFAULT 0,
  sources_failed    INT DEFAULT 0,
  error_summary     JSONB,
  triggered_by      TEXT                       -- 'cron' | 'manual'
);

-- ============================================================
-- RLS POLICIES
-- ============================================================

ALTER TABLE stocks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_insights    ENABLE ROW LEVEL SECURITY;
ALTER TABLE insight_articles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_watchlist    ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public reads stocks"          ON stocks           FOR SELECT USING (is_active);
CREATE POLICY "Public reads insights"        ON stock_insights   FOR SELECT USING (true);
CREATE POLICY "Public reads articles"        ON insight_articles FOR SELECT USING (true);
CREATE POLICY "Own profile read"             ON user_profiles    FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Own profile update"           ON user_profiles    FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Own watchlist all"            ON user_watchlist   FOR ALL    USING (auth.uid() = user_id);
CREATE POLICY "Own predictions read"         ON predictions      FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Own predictions insert"       ON predictions      FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own credit transactions read" ON credit_transactions FOR SELECT USING (auth.uid() = user_id);

-- Service role bypasses RLS for pipeline writes
```

---

## Insights Pipeline

### Code structure

```
pipeline/
├── pyproject.toml                  # dependencies via uv/poetry
├── fetch_insights.py               # main orchestrator
├── resolve_predictions.py
├── config.py                       # env, constants
├── observability.py                # Sentry, pipeline_runs logging
├── supabase_client.py
│
├── fetchers/                       # one module per source
│   ├── __init__.py
│   ├── base.py                     # AbstractFetcher with retry + circuit breaker
│   ├── massive.py                  # formerly polygon
│   ├── yfinance_fetcher.py
│   ├── finnhub.py
│   ├── sec_edgar.py
│   ├── stocktwits.py
│   ├── reddit.py
│   ├── apewisdom.py
│   └── fred.py
│
├── scrapers/                       # best-effort, no proxies
│   ├── __init__.py
│   └── marketwatch.py              # uses subscription cookie
│
├── processors/
│   ├── technical.py                # RSI, MACD via ta-lib
│   ├── sentiment.py                # FinBERT via HF
│   ├── summarizer.py               # Llama-3 via HF for TL;DRs
│   └── aggregator.py               # signal bucket scoring
│
└── tests/
    ├── test_fetchers.py
    └── test_aggregator.py
```

### Fetcher pattern (resilience built in)

```python
class AbstractFetcher:
    name: str
    timeout: int = 10
    max_retries: int = 3
    circuit_breaker_threshold: int = 3   # consecutive failures → skip

    async def fetch(self, ticker: str) -> FetchResult:
        if self._is_circuit_open():
            return FetchResult.skipped(self.name)

        for attempt in range(self.max_retries):
            try:
                start = time.time()
                data = await self._fetch_impl(ticker)
                self._record_success(ticker, time.time() - start)
                return FetchResult.success(self.name, data)
            except RateLimitError:
                await asyncio.sleep(2 ** attempt)
            except Exception as e:
                if attempt == self.max_retries - 1:
                    sentry_sdk.capture_exception(e)
                    self._record_failure(ticker, e)
                    return FetchResult.failed(self.name, e)
```

### Cross-source agreement (the trust signal)

```python
def compute_source_agreement(article_sentiments: list[float]) -> dict:
    """
    Returns:
      sources_total: 23
      sources_bullish: 18
      sources_bearish: 3
      sources_neutral: 2
      agreement_strength: 0.78  # 0-1, how aligned sources are
    """
```

When the UI shows *"4 of 5 sources agree: Bullish"*, that comes from this.

### Pipeline orchestration

```python
async def main():
    run = pipeline_runs.start('insights')
    try:
        stocks = await supabase.fetch_active_stocks()
        insight_date = next_trading_day()

        # Parallel per-stock processing
        results = await asyncio.gather(*[
            compute_insight(s, insight_date) for s in stocks
        ], return_exceptions=True)

        await supabase.upsert_insights(results)
        run.complete(status='success', stocks_processed=len(stocks))
    except Exception as e:
        sentry_sdk.capture_exception(e)
        run.complete(status='failed', error=str(e))
        raise
```

---

## Signal Engine

Each insight has **4 bucket scores** (technical, sentiment, professional, social), each on a -1 to +1 scale. No combined verdict — users see the buckets and decide.

### Bucket scoring formulas

```python
# TECHNICAL bucket
def technical_score(data) -> float:
    s = 0.0
    if data.rsi_14 < 30:   s += 1.0      # oversold = bullish
    elif data.rsi_14 > 70: s -= 1.0      # overbought
    elif data.rsi_14 < 45: s += 0.3
    elif data.rsi_14 > 55: s -= 0.3
    if data.macd_signal == 'bullish_crossover':  s += 0.8
    elif data.macd_signal == 'bearish_crossover': s -= 0.8
    s += 0.4 if data.price_vs_20ma == 'above' else -0.4
    s += 0.3 if data.price_vs_50ma == 'above' else -0.3
    if data.volume_trend == 'increasing': s *= 1.2
    return clamp(s / 3, -1, 1)           # normalize

# SENTIMENT bucket
def sentiment_score(article_sentiments, agreement):
    weighted = sum(s.score * recency_weight(s.published_at) for s in article_sentiments)
    avg = weighted / len(article_sentiments) if article_sentiments else 0
    return avg * (0.5 + 0.5 * agreement)  # boost if sources agree

# PROFESSIONAL bucket
def professional_score(data) -> float:
    s = 0.0
    if data.analyst_count:
        s += (data.analyst_buy - data.analyst_sell) / data.analyst_count
    if data.analyst_rating_change == 'upgrade':   s += 0.4
    elif data.analyst_rating_change == 'downgrade': s -= 0.4
    # zacks_rank + tipranks_score added Week 2 if proxy vendor is added
    if data.insider_activity == 'buying':  s += 0.6
    elif data.insider_activity == 'selling': s -= 0.3
    if data.earnings_in_days and data.earnings_in_days <= 3:
        s *= 1.3
    return clamp(s, -1, 1)

# SOCIAL bucket
def social_score(data) -> float:
    s = 0.0
    if data.reddit_mention_delta > 200: s += 0.5
    if data.reddit_mention_delta < -50: s -= 0.3
    if data.apewisdom_rank and data.apewisdom_rank <= 10: s += 0.3
    s += (data.stocktwits_bullish - 50) / 100
    return clamp(s, -1, 1)
```

### Why no aggregate verdict?

Showing "UP/DOWN call with HIGH confidence" would:
- Homogenize all users' bets → kills the game
- Feel like robo-advisor advice → legal/trust risk
- Reduce engagement with the actual data

Showing 4 bucket scores forces users to interpret → makes the data feel valuable → fits your "insights feel valuable" goal.

---

## Trust UI Patterns

### Stock card (home feed)

```
┌──────────────────────────────────────────────────┐
│  NVDA  NVIDIA Corporation               $891.20  │
│  ▲ +2.3% this week    ▲ +18.4% this month        │
│                                                   │
│  ┌────────────────────────────────────────────┐  │
│  │ 📊 TECHNICAL              +0.6 Bullish     │  │
│  │ ████████░░░░                                │  │
│  │ RSI 58 · MACD bullish · Above 20-day MA    │  │
│  │ ⓘ Massive · 2 min ago                       │  │
│  └────────────────────────────────────────────┘  │
│                                                   │
│  ┌────────────────────────────────────────────┐  │
│  │ 📰 SENTIMENT              +0.4 Bullish     │  │
│  │ ███████░░░░░                                │  │
│  │ 23 articles · 18 bullish · 3 bearish        │  │
│  │ ✓ MarketWatch  ✓ Massive  ✓ Finnhub         │  │
│  │ ✓ Reddit       ✗ Reuters (neutral)          │  │
│  │                                              │  │
│  │ "Analysts raise NVDA target to $1K ahead   │  │
│  │  of next week's earnings call."             │  │
│  │ — MarketWatch · 3h ago                      │  │
│  └────────────────────────────────────────────┘  │
│                                                   │
│  ┌────────────────────────────────────────────┐  │
│  │ 🏛️ PROFESSIONAL          +0.7 Strong Bull  │  │
│  │ █████████░░░                                │  │
│  │ 22 analysts: 18 Buy · 3 Hold · 1 Sell      │  │
│  │ Target: $1,050 (Finnhub consensus)          │  │
│  │ Insider: CEO bought $2M (SEC Form 4, 3/15) │  │
│  │ 📅 Earnings: 6 days                         │  │
│  └────────────────────────────────────────────┘  │
│                                                   │
│  ┌────────────────────────────────────────────┐  │
│  │ 💬 SOCIAL                 +0.5 Bullish     │  │
│  │ ████████░░░░                                │  │
│  │ Reddit mentions: +340% vs 7-day avg         │  │
│  │ StockTwits: 78% bullish (4,212 messages)    │  │
│  │ ApeWisdom rank: #3 trending                 │  │
│  └────────────────────────────────────────────┘  │
│                                                   │
│  📡 12 sources · last updated 8 min ago          │
│  ⓘ How we compute these signals                  │
│                                                   │
│  [   YOUR CALL: UP   ]   [    DOWN    ]          │
└──────────────────────────────────────────────────┘
```

### Trust-building elements
1. **Source attribution per signal** — small ⓘ shows which sources contributed
2. **Agreement counters** — "4 of 5 sources agree"
3. **Direct article quotes** with source + timestamp
4. **Specific numbers** — "22 analysts" not "many"
5. **Total source count** — "12 sources" badge at bottom
6. **Methodology link** — opens dedicated page explaining computation
7. **Freshness** — "last updated 8 min ago"
8. **Raw filing links** — clicking insider activity opens the SEC Form 4

### Methodology page (`/methodology`)

A dedicated explainer page with:
- Per-bucket scoring formulas in plain English
- Source list with logos and what each contributes
- Why we don't show a single verdict (and what we'd need to start)
- Update frequency and pipeline schedule
- Limitations and known biases

This is your trust anchor for skeptical users.

---

## API Routes

All routes type-safe via Zod schemas. Rate-limited via Upstash.

```
GET    /api/stocks                     → list 50 stocks
GET    /api/stocks/[ticker]            → stock + today's insight + articles
GET    /api/watchlist                  → user's stocks with insights
POST   /api/watchlist                  → { ticker } add
DELETE /api/watchlist/[ticker]
POST   /api/predictions                → { ticker, direction, credits }
GET    /api/predictions/open           → today's unresolved bets
GET    /api/predictions/history        → paginated
GET    /api/user                       → profile + balance
GET    /api/methodology                → structured signal documentation
GET    /api/pipeline/health            → last run status (admin)
```

---

## Frontend Pages

```
app/
├── (auth)/login/page.tsx
├── onboarding/page.tsx                 → 50-stock picker, sector tabs
├── (app)/
│   ├── layout.tsx                      → bottom nav, auth guard, credit pill
│   ├── page.tsx                        → home feed (watchlist insights)
│   ├── discover/page.tsx               → all 50 stocks, filter/sort
│   ├── stock/[ticker]/page.tsx         → full signal detail + article list
│   ├── predict/page.tsx                → open bet cards (countdown UX)
│   ├── results/page.tsx                → resolution outcomes (card flip reveal)
│   ├── leaderboard/page.tsx            → weekly tiered leaderboard
│   ├── methodology/page.tsx            → trust explainer
│   ├── profile/page.tsx                → stats, achievement grid, credit ledger
│   └── about/page.tsx                  → about the project (showcase)
├── api/
│   └── og/result/[predictionId]/route.tsx  → dynamic OG image (@vercel/og)
└── components/
    ├── StockCard.tsx                   → card with 4 signal bars + sources
    ├── SignalBar.tsx                   → animated -1 to 1 bar
    ├── SourceBadgeList.tsx             → ✓/✗ source consensus indicator
    ├── ArticleQuote.tsx                → source + timestamp + TL;DR
    ├── BetSheet.tsx                    → bottom drawer
    ├── CountdownTimer.tsx              → "Closes in 2h 14m"
    ├── CreditPill.tsx
    ├── FreshnessIndicator.tsx          → "last updated X ago"
    ├── MethodologyLink.tsx
    │
    ├── StreakFlame.tsx                 → animated flame counter (header)
    ├── ResultRevealCard.tsx            → flip + confetti choreography
    ├── BadgeUnlockModal.tsx            → spring entry + confetti
    ├── AchievementGrid.tsx             → locked/in-progress/unlocked states
    ├── ProgressRing.tsx                → for in-progress achievements
    ├── LeaderboardRow.tsx              → with rank change + tier badge
    ├── TierBadge.tsx                   → Bronze/Silver/Gold/Diamond
    ├── ShareResultButton.tsx           → opens share sheet with OG image link
    └── ConfettiCannon.tsx              → canvas-confetti wrapper
```

---

## Gamification (Frontend Showcase)

Designed to make the app *feel* rewarding while showcasing animation chops worth talking about in interviews.

### Animation stack

| Library | Use |
|---------|-----|
| `framer-motion` | Layout animations, spring physics, AnimatePresence for unlocks |
| `canvas-confetti` | Confetti burst on prediction wins |
| `@vercel/og` | Dynamic OG image generation for shareable result cards |
| `lucide-react` | Badge + UI icons (shadcn default) |

### Streak system

```
user_profiles.current_streak
  - Increments daily when user places at least one prediction
  - Resets to 0 if no prediction on a given trading day
  - Tracked via cron at midnight ET

UI:
  - Streak counter in header with animated flame
  - 1-2 streak:  🔥 small flame
  - 3-6 streak:  🔥 medium flame + pulse animation
  - 7-29 streak: 🔥🔥 dual flame + amber glow
  - 30+ streak:  🔥🔥🔥 triple flame + diamond particle
  - Milestone celebration modals at 3, 7, 30, 100
```

### Badge set (MVP — 10 badges)

| Badge | Icon | Trigger |
|-------|------|---------|
| First Blood | 🩸 | First correct prediction |
| On Fire | 🔥 | 3-day streak |
| Inferno | 🔥🔥 | 7-day streak |
| Diamond Hands | 💎 | 30-day activity streak |
| Oracle | 🔮 | 10 correct predictions total |
| Sage | 🧙 | 50 correct predictions |
| Tech Whisperer | 💻 | 5 correct on Tech sector |
| Risk Taker | 🎲 | Won max-stake (500 credit) bet |
| Earnings Hunter | 📅 | Correct prediction on earnings day |
| Comeback Kid | 🏆 | Won immediately after 3-loss streak |

**Unlock UX:**
1. Badge unlock modal slides up from bottom with spring physics
2. Confetti burst at modal entrance
3. Badge icon rotates 360° on reveal
4. "Tap to share" CTA generates OG image link

### Achievement grid (`/profile`)

```
┌────────────────────────────────────┐
│ Achievements             4 / 10    │
├────────────────────────────────────┤
│  🩸    🔥    🔥🔥   💎              │
│  ✓     ✓    ⓘ60%   🔒              │
│                                     │
│  🔮    🧙    💻    🎲              │
│  ✓     🔒   ⓘ40%   ✓               │
│                                     │
│  📅    🏆                           │
│  🔒    🔒                           │
└────────────────────────────────────┘

✓ = earned (full color, earned date on tap)
ⓘ = in progress (progress ring around icon)
🔒 = locked (grayscale, hint on tap)
```

### Result reveal animation

The single most important "moment" in the app. When a user opens results:

```
1. Card appears face-down (subtle hover float)
2. Tap → card flips with 3D transform (Framer Motion)
3. Reveals outcome:
   - WIN:  green flash + confetti burst + credit counter
           animates from 0 → payout amount
   - LOSS: red flash + subtle shake + credit counter
           animates down to wagered amount loss
4. New badges (if any) unlock in sequence after reveal
5. "Share this result" CTA at bottom
```

This single interaction is portable showcase material — recordable as a 5-second video for portfolio.

### Weekly leaderboard

- Resets Monday 12:00 AM ET via cron
- Ranked by: `(credits_won_this_week) × (accuracy_this_week / 100)`
- Top 3 receive bonus credits (500 / 300 / 100)
- **Tier system** (visual hierarchy):
  - Diamond: top 1%
  - Gold: top 10%
  - Silver: top 25%
  - Bronze: everyone else
- **Rank change indicators** next to each row: `↑3` (green) or `↓2` (red) since yesterday
- Smooth position transitions via Framer Motion `layoutId` — when ranks shuffle, rows physically move

### Shareable result cards (`@vercel/og`)

Dynamic OG image route: `/api/og/result/[predictionId]`

Generates a Twitter/Discord-ready image:

```
┌────────────────────────────────────────┐
│       MarketMind                       │
│                                        │
│   NVDA · I called it UP                │
│       ✓ +180 credits                   │
│                                        │
│   ████████░░░░  4-day streak 🔥        │
│                                        │
│   marketmind.neeleshkakaraparthi.dev  │
└────────────────────────────────────────┘
```

When shared on social, link previews show this image automatically. Strong viral loop + impressive portfolio piece (server-side rendering with custom fonts, dynamic data → image).

### Polish details

- **Pull-to-refresh** on home feed
- **Vibration API** for haptics on mobile (subtle tap on bet placement, success/fail on result)
- **Empty states** with custom illustrations (no stocks selected, no predictions today, no badges yet)
- **Streak loss warning** — push at 8 PM if user hasn't predicted today and has an active streak
- **Bet placement micro-animation** — buttons compress slightly on press, success state shows checkmark draw

---

## Enterprise Standards

### Type safety
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`
- Supabase CLI generates DB types: `supabase gen types typescript > types/db.ts`
- Zod schemas for every API input + output
- API client wraps fetch with parsed Zod responses

### Security
- Row-Level Security on every user-data table
- API rate limits via Upstash: 60 req/min per user
- CSP headers in `next.config.js`
- All secrets in Vercel/GitHub encrypted vars
- Service role key never exposed to client

### Observability
- **Sentry** initialized in Next.js + Python pipeline
- **PostHog** for user analytics (page views, bet placement, watchlist additions)
- **pipeline_runs** table tracks every cron execution
- **stock_insight_sources** tracks per-source success/failure
- Admin route `/admin/pipeline-health` shows recent runs (protected)

### Resilience
- Every fetcher: retry with backoff → fallback source → graceful skip
- Circuit breaker: 3 consecutive failures → skip for the day
- Pipeline marked "degraded" if <80% sources succeed
- UI shows "Partial data" banner when insight has degraded status

### Testing (lighter for MVP)
- Vitest for unit tests on aggregator + signal engine
- Pytest for fetcher contract tests (with mocked responses)
- Playwright smoke test: signup → bet → results (one happy path)
- CI runs all tests on every PR

### Performance budgets
- Lighthouse mobile: Performance >90, Accessibility >95
- First Contentful Paint <1.2s
- Largest Contentful Paint <2.5s
- Bundle size: home page <150KB gzipped

### Accessibility
- Semantic HTML, proper heading hierarchy
- All interactive elements keyboard-navigable
- ARIA labels on signal bars (screen reader can announce values)
- Color is never the only signal indicator (icons + text too)
- Color contrast WCAG AA

### Documentation (in repo)
- `README.md` — overview + getting started
- `ARCHITECTURE.md` — diagrams + decisions
- `METHODOLOGY.md` — for the methodology page content
- `RUNBOOK.md` — common ops: re-run pipeline, debug failed source
- `CONTRIBUTING.md` (later, if open-sourced)

---

## Deployment

### Vercel
1. Create project: import `neelesh1206/market-mind` repo
2. Framework: Next.js (auto-detected)
3. Environment variables → see env vars section
4. Custom domain: `marketmind.neeleshkakaraparthi.dev`
5. Enable Vercel Analytics

### DNS (where neeleshkakaraparthi.dev is hosted)
```
Type:   CNAME
Name:   marketmind
Value:  cname.vercel-dns.com
```

### Supabase
1. New project: `marketmind-prod`
2. Run migrations via Supabase CLI (`supabase/migrations/`)
3. Enable Google OAuth (+ Apple later)
4. Set redirect URL: `https://marketmind.neeleshkakaraparthi.dev/auth/callback`
5. Seed 50 stocks (SQL script in `supabase/seed.sql`)

### GitHub Actions
Repo secrets:
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `MASSIVE_API_KEY` (formerly POLYGON_API_KEY)
- `FINNHUB_API_KEY`
- `HUGGINGFACE_API_KEY`
- `MARKETWATCH_SESSION_COOKIE` (your subscription)
- `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`
- `SENTRY_DSN`

### Environment variables (frontend)
```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=https://marketmind.neeleshkakaraparthi.dev
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_SENTRY_DSN=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

---

## Execution Plan

### Day 1 — Foundation + Pipeline Core (~10h)

| Block | Hours | Tasks |
|-------|-------|-------|
| Setup | 1.5h | create-next-app, TS strict, Tailwind, shadcn, ESLint, Prettier, Vitest |
| Supabase | 1.5h | Project create, schema migrations, RLS, type generation, seed 50 stocks |
| Auth | 1h | Google OAuth, user_profile trigger (+1000 credits), session middleware |
| Pipeline scaffold | 1h | Python project, GitHub Actions workflow, secrets, Sentry init |
| Tier-1 fetchers | 3h | Massive (prices, news, technicals), yfinance backup |
| Tier-2 fetchers | 1.5h | Finnhub, SEC EDGAR (Form 4 + 8-K), FRED |
| First E2E run | 0.5h | Manual workflow trigger on 5 stocks, verify writes |

### Day 2 — Pipeline Expansion + NLP (~10h)

| Block | Hours | Tasks |
|-------|-------|-------|
| MarketWatch scrape | 1h | Subscription cookie session, best-effort fetch with graceful fallback |
| Social fetchers | 2h | StockTwits, Reddit, ApeWisdom, FRED |
| FinBERT processor | 1.5h | Batch sentiment via HF Pro API, recency weighting |
| Llama-3 summarizer | 1.5h | TL;DR generation for top 3 articles per stock |
| Signal aggregator | 1.5h | Bucket scoring + cross-source agreement |
| Observability | 1.5h | pipeline_runs, stock_insight_sources, circuit breakers, Sentry |
| Resolution job | 1h | 4:15 PM workflow, payout logic, credit ledger transactions |

### Day 3 — Frontend (~10h)

| Block | Hours | Tasks |
|-------|-------|-------|
| Layout + nav | 1h | Bottom nav, auth guard, credit pill, dark mode |
| Onboarding | 1.5h | Stock picker grid with sector tabs, multi-select, min 3 |
| StockCard | 3h | Signal bars, source badges, article quote, freshness |
| Home feed | 1h | Watchlist insights, empty state, refresh |
| Stock detail | 2h | Full signal breakdown, article list with TL;DRs, recent insider |
| BetSheet | 1h | Bottom drawer, validation, credit deduction, optimistic UI |
| Results page | 0.5h | Outcome cards with W/L animation |

### Day 4 — Gamification + Animations (~10h)

| Block | Hours | Tasks |
|-------|-------|-------|
| Schema + libs | 1h | `user_badges` + `weekly_leaderboard_snapshots` migrations, install framer-motion + canvas-confetti + @vercel/og |
| Streak engine | 1h | Cron to compute streaks, on-prediction triggers, animated flame component |
| Badge engine | 1.5h | Rule-based detector runs post-resolution, awards badges, returns new unlocks to UI |
| Result reveal | 2h | Card flip animation, confetti, credit counter animation, sequence with badge unlocks |
| Badge unlock modal + grid | 1.5h | Modal with spring animation + confetti, profile achievement grid with locked/in-progress/unlocked states + progress rings |
| Weekly leaderboard | 1.5h | Page with tier system, rank change indicators, Framer Motion layoutId transitions |
| Shareable cards | 1h | `@vercel/og` dynamic image route, share button, OG meta tags |
| Polish details | 0.5h | Pull-to-refresh, haptics, empty states |

### Day 5 — Trust UI + Polish + Deploy (~10h)

| Block | Hours | Tasks |
|-------|-------|-------|
| Methodology page | 1.5h | Per-bucket explainers, source logos, formulas in plain English |
| About page | 0.5h | Showcase angle — your bio + tech used |
| Profile page | 1h | Stats, credit ledger, accuracy by sector |
| Loading + errors | 1.5h | Skeletons everywhere, error boundaries, retry buttons |
| Sentry + PostHog | 0.5h | Wire up frontend tracking |
| Lighthouse audit | 1h | Fix everything <90, optimize images, lazy loading |
| A11y pass | 1h | Keyboard nav, ARIA, contrast, reduced-motion preference for animations |
| Deploy | 1h | Vercel project, DNS, env vars, smoke test |
| Footer + legal | 0.5h | Disclaimer, terms, privacy stub |
| Friend QA | 1.5h | Real signup walkthrough, record gamification moments for portfolio |

---

## Post-MVP Roadmap

### Week 2 (showcase enhancements)
- **Backtest harness** — run signal engine vs 12 months historical, publish accuracy stats on `/about`
- Daily login bonus + streak loss warning push
- Push notifications (web push) — bet window opens, results ready, streak in danger
- Friend leaderboards (follow other users)
- Daily challenges ("Predict 3 stocks today for 2x credits")

### Week 3
- Catalyst hunter + contrarian-specific badges
- Stock detail charts (Recharts)
- Crowd-split odds (once you have ~20+ active users)
- "MarketMind's Call" — bring back the verdict with backtested accuracy disclosed
- Additional badges (expand from 10 → 25)

### Week 4+
- PWA (manifest + service worker + Add to Home Screen)
- More sources: Benzinga Pro, Unusual Whales (options flow), Twitter
- Admin dashboard for pipeline health
- Stripe integration for credit packs (the moment this monetizes, get a lawyer)

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| Massive API hits rate limits | yfinance fallback, exponential backoff |
| MarketWatch blocks GitHub Action IPs | Pipeline degrades gracefully, falls back to Massive news + Finnhub. Evaluate residential proxy vendor in Week 2 if persistent. |
| HuggingFace API throttles during burst | Process in batches, cache results, retry with backoff |
| MarketWatch session cookie expires | Pipeline alerts via Sentry, you refresh cookie manually |
| FinBERT sentiment misclassifies finance jargon | Cross-source agreement masks individual bad reads |
| 8-K filing race condition vs prediction lock | Locks at 9:15 AM, accept 15-min staleness as risk |
| Friend churn after 1 week | Week 2 gamification ships fast |

---

## Disclaimer (footer on every page)

> *MarketMind is for educational and entertainment purposes only. Signals shown are derived from public market data and do not constitute investment advice. All bets use virtual credits with no real-money value.*

---

*Last updated: 2026-05-18*
*Status: Plan locked, ready to scaffold Day 1*
