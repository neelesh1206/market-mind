# MarketMind · Interview Cheat Sheet

> Night-before review. Print to one page. Full doc: [INTERVIEW_PREP.md](INTERVIEW_PREP.md).

## 30-second pitch

Daily stock-prediction game with a transparent signal engine. Python pipeline visits **10 data sources** for **50 stocks** nightly, scores each into **4 buckets** (technical, sentiment, professional, social), computes UP/DOWN/NEUTRAL with a one-sentence Llama-generated explanation. Users place virtual-credit bets, resolved against actual market close. **88 JS unit + 7 e2e + ~40 Python tests**, **17 ADRs**, **15 migrations**, **~16k LOC**, all running for **$38/month**.

## Architecture (one breath)

`GH Actions (Python pipeline)` ──writes──▶ `Supabase Postgres (RLS)` ──reads──▶ `Next.js on Vercel`. **App never calls third-party data during page render.** Pipeline → DB → app is one-way. Vendor outages don't take the site down. Live prices (Finnhub) are cached in Upstash with 5min TTL. Cron triggers come from a Cloudflare Worker, not GH (more reliable).

## Tech stack — quick why

| Layer | Pick | One-line reason |
|---|---|---|
| Frontend | Next.js 16 App Router + TS strict | RSC kills the read-path API layer |
| DB | Supabase Postgres | Auth + RLS bundled saves 2 days vs Neon |
| Auth | Google OAuth via Supabase | Friends-only audience, every user has Google |
| Mutations | SECURITY DEFINER RPCs | Atomic txn, RLS-scoped, one round-trip |
| Pipeline | Python on GH Actions | Free runner, 60-min budget fits 50-stock run |
| Stock data | Massive Starter ($29) + Finnhub free | Historical + real-time without paying $79 |
| NLP | FinBERT local + Llama via HF | Local kills the rate-limit dep on the hot path |
| Cache | Upstash Redis | Shared across Vercel instances, free 10k/day |
| Cron | Cloudflare Worker | GH `schedule:` drifted 3h; CF reliable to ~1min |
| Tests | Vitest + Playwright + pytest | 80 + 7 + 20 = all CI-gated |
| Observability | Sentry + Vercel Analytics | Errors + Web Vitals, dormant until 30+ users |

## Talk-about ADRs (memorize one of these)

- **0013 — Social bucket "fade the crowd."** Retail attention spikes precede *underperformance* (Barber & Odean 2008; Da-Engelberg-Gao 2011). Rewrote social to *dampen* directional signal at peak herding, not amplify. Behavior-changing model decision grounded in academic literature.
- **0012 — Local FinBERT + HF circuit breaker.** HF rate-limited a production run for 45 min. Moved FinBERT to local CPU torch on the runner (~30s warm, ~3min cold), kept Llama on HF behind a 5-failure circuit breaker with rule-based fallback. Concrete reliability win.
- **0016 — Cloudflare Worker for cron.** GH Actions `schedule:` drifted ~3h on first eligible fire. ~80-line CF Worker dispatches via `workflow_dispatch` API. Pushed back on platform SLA when wrong for product.
- **0017 — Entry-vs-close for in-market bets.** Originally `open → close` for all bets (ADR 0008). Once live prices shipped, mid-day bettors had unfair advantage. New two-mode resolver, existing bets grandfathered. Fairness > simplicity.
- **0014 — Vol-normalized direction threshold.** Flat 0.15 threshold under-called PG (σ≈0.9%), over-called NVDA (σ≈3.5%). Scale by 20-day realized vol, clamp [0.5, 2.5]. Per-ticker signal-to-noise calibration.

## Mistakes — pick one as "recent failure" story

- **Polygon snapshot tier.** Built live prices against `/v3/snapshot`; "free tier 15-min delayed" was marketing copy, endpoint returned 403. Swapped to Finnhub in 40 min. **Lesson:** verify with curl before designing around an API tier.
- **Badge backfill missed.** `FIRST_BET` only fires on `v_total_after = 1` — users who had bets before the migration could never earn it. Wrote retroactive backfill migration. **Lesson:** when a migration adds a first-event check, include a backfill.
- **GH Actions cron drift.** Assumed schedules fired on time. ~3h late on first run. Moved to Cloudflare Worker.
- **MarketMind verdict window.** Originally scored `open → close`; verdict was frozen 8 PM previous day so this discarded the overnight gap. Fixed to `prev_close → close`. **Lesson:** scoring window matches *prediction-decision time*, not bet-locking time.

## Three honesty / UX moves worth mentioning

- **95% Wilson CI** next to every accuracy number. Sample-size-aware copy: <30 = "wide on purpose", <100 = "still wide", ≥100 = "narrowed enough to be defensible". Per-stock track record under each verdict.
- **NEUTRAL chip visually distinct** (dashed border, HelpCircle icon, no percentage) — reads as "we deliberately didn't call this," not "mildly indecisive." Companion fallback copy: "Signals are pointing in different directions — better to skip than call a coin flip."
- **Thumbs-up/down feedback on every verdict.** Optimistic UI; aggregate "X of Y found helpful" is public; individual votes RLS-scoped. Sample-size-aware display (<5 = no percentage shown to avoid 1/1=100% misleading).

## End-to-end feature: bet placement

`BetSheet` (client) → `placeBet` server action → `rateLimit("placeBet", userId)` → `supabase.rpc("place_bet", {...})` → atomic txn: validate balance, lock bet row, insert ledger entry, award `FIRST_BET` if total_after=1 → return prediction → `revalidatePath("/")` → home feed RSC re-renders with locked-in chip → Sonner toast w/ smart-formatted resolution time. **Live price (Finnhub via Upstash) captured into `price_at_placement` for later display + ADR 0017 resolution math.**

## Q → A map

- **"Why Supabase over Neon?"** Auth + RLS bundled. RLS is *defense in depth* — even a buggy server query can't return another user's rows.
- **"How do mutations stay consistent?"** SECURITY DEFINER RPCs. One transaction, one round-trip, RLS-scoped.
- **"How does the pipeline scale?"** Bottleneck is Massive's 100/min rate limit. Currently ~30/min sustained, 3x headroom. 10x universe would need parallel batched workers or paid tier.
- **"What if HF goes down?"** Circuit breaker → rule-based reasoning. FinBERT is local so sentiment scoring is unaffected. Numerical signal is never blocked by AI vendor.
- **"How do you handle pipeline failures?"** Each fetcher independent; failure writes to `stock_insight_sources` audit log; bucket renormalization handles missing inputs.
- **"Where would this break?"** Massive Starter rate cap. At 10x stock universe.
- **"How do you handle secrets?"** Service role only on pipeline + Vercel env. PATs fine-grained, 1yr expiry, atomic rotation via `wrangler secret put`. `.env.local` gitignored.
- **"Testing strategy?"** Vitest unit (~80) + Playwright e2e (~7) + pytest (~20). Coverage gates in `vitest.config.ts`. All CI-gated.
- **"What would you do differently?"** Verify API tier with curl before building (Polygon mistake). Backfill on first-event migrations (badge mistake). Don't trust GH cron SLA (drift mistake).

## Numbers to drop naturally

50 stocks · 10 data sources · 4 signal buckets · 1.8× payout · 95% Wilson CI · 17 ADRs · 15 migrations · ~16k LOC · 88/7/~40 tests · $38/mo · 5min Upstash TTL · 60/min Finnhub free · ~15-25 min pipeline runtime · ~80 LOC Cloudflare Worker.

## Cost breakdown ($38/mo)

Vercel Hobby $0 + Supabase free $0 + GH Actions free $0 + Cloudflare free $0 + Upstash free $0 + Massive Starter **$29** + HF Pro **$9** = **$38**.

---
*Updated 2026-05-20 · Day 3*
