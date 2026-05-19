-- ============================================================================
-- MarketMind's own daily verdict per stock.
--
-- See ADR 0007 (supersedes ADR 0003). The verdict is computed alongside the
-- 4 bucket scores during the nightly pipeline and resolved at market close
-- exactly like a user prediction.
--
-- Why a separate table from `predictions`:
--   - `predictions` is per-user with RLS — owned data.
--   - `marketmind_predictions` is public read — the published track record.
--   - Clean separation = clear policy + simpler queries.
-- ============================================================================

create table public.marketmind_predictions (
  id              uuid primary key default gen_random_uuid(),
  insight_id      uuid not null references public.stock_insights(id) on delete cascade,
  stock_id        uuid not null references public.stocks(id) on delete cascade,
  prediction_date date not null,

  -- The verdict
  direction       text not null check (direction in ('UP', 'DOWN', 'NEUTRAL')),
  confidence      numeric(4, 3) not null default 0,            -- 0..1
  reasoning       text,                                         -- 1-sentence Llama explanation

  -- Frozen at prediction time for accuracy attribution
  bucket_scores   jsonb not null,                               -- {technical, sentiment, professional, social}
  weights_version text not null default 'v1',                   -- bump when we retune

  -- Resolution (filled by the 4:15 PM ET cron)
  resolved        boolean not null default false,
  outcome         text check (outcome in ('WIN', 'LOSS', 'VOID')),
  open_price      numeric(10, 2),
  close_price     numeric(10, 2),
  resolved_at     timestamptz,

  created_at      timestamptz not null default now(),
  unique (stock_id, prediction_date)
);

create index marketmind_predictions_date_idx
  on public.marketmind_predictions (prediction_date desc);

create index marketmind_predictions_stock_idx
  on public.marketmind_predictions (stock_id, prediction_date desc);

create index marketmind_predictions_resolved_idx
  on public.marketmind_predictions (resolved, prediction_date desc);

-- Public read — the verdict + track record are publicly accountable.
alter table public.marketmind_predictions enable row level security;

create policy "marketmind_predictions_public_read"
  on public.marketmind_predictions
  for select using (true);

-- Writes go through service-role (the pipeline + resolution job).
