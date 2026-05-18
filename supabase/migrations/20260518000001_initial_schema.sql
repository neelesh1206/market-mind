-- ============================================================================
-- MarketMind initial schema
-- Includes: tables, indexes, RLS policies, signup trigger
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- stocks: curated pool (admin-seeded)
-- ----------------------------------------------------------------------------
create table public.stocks (
  id              uuid primary key default gen_random_uuid(),
  ticker          text unique not null,
  name            text not null,
  sector          text not null,
  sub_sector      text,
  logo_url        text,
  description     text,
  market_cap_tier text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

create index stocks_sector_idx on public.stocks (sector) where is_active;
create index stocks_active_idx on public.stocks (is_active);

-- ----------------------------------------------------------------------------
-- user_profiles: per-user denormalized state (1:1 with auth.users)
-- ----------------------------------------------------------------------------
create table public.user_profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  display_name        text,
  avatar_url          text,
  credit_balance      integer not null default 1000,
  total_predictions   integer not null default 0,
  correct_predictions integer not null default 0,
  current_streak      integer not null default 0,
  longest_streak      integer not null default 0,
  last_login_date     date,
  created_at          timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- user_watchlist: which stocks each user follows (max 15 enforced in app)
-- ----------------------------------------------------------------------------
create table public.user_watchlist (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references auth.users(id) on delete cascade,
  stock_id uuid not null references public.stocks(id) on delete cascade,
  added_at timestamptz not null default now(),
  unique (user_id, stock_id)
);

create index user_watchlist_user_idx on public.user_watchlist (user_id);

-- ----------------------------------------------------------------------------
-- stock_insights: nightly-computed per-stock signal data
-- ----------------------------------------------------------------------------
create table public.stock_insights (
  id                    uuid primary key default gen_random_uuid(),
  stock_id              uuid not null references public.stocks(id) on delete cascade,
  insight_date          date not null,

  -- Price context
  prev_close            numeric(10, 2),
  day_change_pct        numeric(5, 2),
  week_change_pct       numeric(5, 2),
  month_change_pct      numeric(5, 2),
  ytd_change_pct        numeric(5, 2),
  fifty_two_week_high   numeric(10, 2),
  fifty_two_week_low    numeric(10, 2),

  -- Technical signals
  rsi_14                numeric(5, 2),
  macd_signal           text,
  price_vs_20ma         text,
  price_vs_50ma         text,
  bollinger_position    text,
  volume_trend          text,
  technical_score       numeric(4, 3),

  -- Sentiment signals
  news_sentiment_score  numeric(4, 3),
  news_article_count    integer default 0,
  top_headline          text,
  top_headline_url      text,
  top_headline_source   text,
  llm_tldr              text,
  sources_agree_count   integer,
  sources_total_count   integer,
  sentiment_score       numeric(4, 3),

  -- Professional signals
  analyst_count         integer,
  analyst_buy           integer,
  analyst_hold          integer,
  analyst_sell          integer,
  analyst_price_target  numeric(10, 2),
  analyst_rating_change text,
  zacks_rank            integer,
  tipranks_score        numeric(4, 1),
  insider_activity      text,
  insider_detail        text,
  earnings_date         date,
  earnings_in_days      integer,
  has_recent_8k         boolean default false,
  professional_score    numeric(4, 3),

  -- Social signals
  reddit_mention_count  integer,
  reddit_mention_delta  numeric(5, 2),
  apewisdom_rank        integer,
  stocktwits_bullish    numeric(5, 2),
  stocktwits_messages   integer,
  google_trend_score    integer,
  social_score          numeric(4, 3),

  -- Macro context
  sector_etf_change_pct numeric(5, 2),
  vix_level             numeric(5, 2),

  -- Breakdown payload for UI
  signal_breakdown      jsonb not null,

  computed_at           timestamptz not null default now(),
  unique (stock_id, insight_date)
);

create index stock_insights_date_idx on public.stock_insights (insight_date desc);
create index stock_insights_stock_date_idx on public.stock_insights (stock_id, insight_date desc);

-- ----------------------------------------------------------------------------
-- stock_insight_sources: per-source audit trail
-- ----------------------------------------------------------------------------
create table public.stock_insight_sources (
  id           uuid primary key default gen_random_uuid(),
  insight_id   uuid not null references public.stock_insights(id) on delete cascade,
  source_name  text not null,
  status       text not null,
  fetched_at   timestamptz not null default now(),
  latency_ms   integer,
  error_detail text,
  raw_data     jsonb
);

create index sources_insight_idx on public.stock_insight_sources (insight_id);
create index sources_status_idx on public.stock_insight_sources (source_name, status, fetched_at desc);

-- ----------------------------------------------------------------------------
-- insight_articles: articles surfaced per insight, with TL;DRs
-- ----------------------------------------------------------------------------
create table public.insight_articles (
  id           uuid primary key default gen_random_uuid(),
  insight_id   uuid not null references public.stock_insights(id) on delete cascade,
  headline     text not null,
  url          text not null,
  source       text not null,
  published_at timestamptz,
  sentiment    numeric(4, 3),
  tldr         text,
  display_rank integer
);

create index insight_articles_insight_idx on public.insight_articles (insight_id, display_rank);

-- ----------------------------------------------------------------------------
-- predictions: the core bet (one per user per stock per day)
-- ----------------------------------------------------------------------------
create table public.predictions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  stock_id        uuid not null references public.stocks(id) on delete cascade,
  prediction_date date not null,
  direction       text not null check (direction in ('UP', 'DOWN')),
  credits_wagered integer not null check (credits_wagered between 50 and 500),
  locked_at       timestamptz not null default now(),

  -- Resolution (set by resolution job)
  resolved        boolean not null default false,
  outcome         text check (outcome in ('WIN', 'LOSS', 'VOID')),
  open_price      numeric(10, 2),
  close_price     numeric(10, 2),
  payout          integer,
  resolved_at     timestamptz,

  created_at      timestamptz not null default now(),
  unique (user_id, stock_id, prediction_date)
);

create index predictions_user_date_idx on public.predictions (user_id, prediction_date desc);
create index predictions_unresolved_idx on public.predictions (prediction_date) where not resolved;

-- ----------------------------------------------------------------------------
-- credit_transactions: append-only ledger
-- ----------------------------------------------------------------------------
create table public.credit_transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  amount        integer not null,
  type          text not null,
  reference_id  uuid,
  balance_after integer not null,
  created_at    timestamptz not null default now()
);

create index credit_tx_user_idx on public.credit_transactions (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- user_badges: earned achievements
-- ----------------------------------------------------------------------------
create table public.user_badges (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  badge_type text not null,
  earned_at  timestamptz not null default now(),
  metadata   jsonb,
  unique (user_id, badge_type)
);

create index user_badges_user_idx on public.user_badges (user_id);

-- ----------------------------------------------------------------------------
-- weekly_leaderboard_snapshots: ranked snapshots per week
-- ----------------------------------------------------------------------------
create table public.weekly_leaderboard_snapshots (
  id          uuid primary key default gen_random_uuid(),
  week_start  date not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  rank        integer not null,
  credits_won integer not null,
  accuracy    numeric(5, 2),
  predictions integer,
  tier        text,
  unique (week_start, user_id)
);

create index leaderboard_week_rank_idx on public.weekly_leaderboard_snapshots (week_start desc, rank);

-- ----------------------------------------------------------------------------
-- pipeline_runs: observability for cron executions
-- ----------------------------------------------------------------------------
create table public.pipeline_runs (
  id                uuid primary key default gen_random_uuid(),
  run_type          text not null,
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  status            text not null,
  stocks_processed  integer not null default 0,
  sources_succeeded integer not null default 0,
  sources_failed    integer not null default 0,
  error_summary     jsonb,
  triggered_by      text
);

create index pipeline_runs_started_idx on public.pipeline_runs (started_at desc);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Public-read tables
alter table public.stocks                enable row level security;
alter table public.stock_insights        enable row level security;
alter table public.insight_articles      enable row level security;
alter table public.stock_insight_sources enable row level security;
alter table public.pipeline_runs         enable row level security;

create policy "stocks_public_read" on public.stocks
  for select using (is_active);

create policy "stock_insights_public_read" on public.stock_insights
  for select using (true);

create policy "insight_articles_public_read" on public.insight_articles
  for select using (true);

create policy "stock_insight_sources_public_read" on public.stock_insight_sources
  for select using (true);

create policy "pipeline_runs_public_read" on public.pipeline_runs
  for select using (true);

-- User-scoped tables
alter table public.user_profiles                enable row level security;
alter table public.user_watchlist               enable row level security;
alter table public.predictions                  enable row level security;
alter table public.credit_transactions          enable row level security;
alter table public.user_badges                  enable row level security;
alter table public.weekly_leaderboard_snapshots enable row level security;

-- user_profiles: users read/update only their own
create policy "user_profiles_own_read" on public.user_profiles
  for select using (auth.uid() = id);

create policy "user_profiles_own_update" on public.user_profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Display names are needed for leaderboards — separate public read for safe columns only.
-- We expose this via a SECURITY DEFINER view in a later migration if needed.

-- user_watchlist: users manage their own only
create policy "user_watchlist_own_all" on public.user_watchlist
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- predictions: users read their own, insert their own (no update/delete)
create policy "predictions_own_read" on public.predictions
  for select using (auth.uid() = user_id);

create policy "predictions_own_insert" on public.predictions
  for insert with check (auth.uid() = user_id);

-- credit_transactions: users read-only (writes are pipeline/service-role)
create policy "credit_tx_own_read" on public.credit_transactions
  for select using (auth.uid() = user_id);

-- user_badges: users read own (writes from service-role on badge unlocks)
create policy "user_badges_own_read" on public.user_badges
  for select using (auth.uid() = user_id);

-- leaderboard: public-read for ranking display (no PII in this table)
create policy "leaderboard_public_read" on public.weekly_leaderboard_snapshots
  for select using (true);

-- ============================================================================
-- AUTO-CREATE user_profiles ROW ON SIGNUP (+1000 credit bonus)
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  );

  insert into public.credit_transactions (user_id, amount, type, balance_after)
  values (new.id, 1000, 'signup_bonus', 1000);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
