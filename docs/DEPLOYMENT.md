# Deployment

How MarketMind ships to production on Vercel.

> **Quick mental model:** the Next.js app deploys to Vercel; the Python
> pipeline + cron jobs run on GitHub Actions (separate concerns, no Vercel
> cron needed). Supabase hosts Postgres + Auth. Massive (Polygon),
> Finnhub, FRED, HuggingFace are external APIs hit at runtime or in the
> pipeline.

---

## 1. One-time Vercel setup

1. Sign in at <https://vercel.com> → **Add New → Project**.
2. Import the GitHub repo `neelesh1206/market-mind`.
3. Framework preset auto-detects **Next.js** — leave defaults:
   - Build command: `next build`
   - Output: `.next`
   - Install: `npm install`
   - Root directory: `./`
4. **Do not click Deploy yet** — add the env vars first (next section).

## 2. Environment variables

Add these in **Project → Settings → Environment Variables**. Apply to
**Production, Preview, and Development** unless noted.

| Variable | Required | Source | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase → Project Settings → API | Safe to expose. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase → Project Settings → API | Safe to expose. RLS scopes everything. |
| `NEXT_PUBLIC_SITE_URL` | ✅ | Your Vercel domain | e.g. `https://marketmind.vercel.app` — used in OG image absolute URLs + OAuth callbacks. **Per environment**: dev → `http://localhost:3000`, preview → leave unset (`VERCEL_URL` fallback kicks in), production → your custom domain. |
| `MASSIVE_API_KEY` | ✅ | Massive (Polygon) dashboard | Server-side only. Used by the stock-detail sparkline. |
| `NEXT_PUBLIC_POSTHOG_KEY` | optional | PostHog dashboard | Skip for now; wires up in [#106](../../../issues). |
| `NEXT_PUBLIC_POSTHOG_HOST` | optional | `https://us.i.posthog.com` typically | |
| `NEXT_PUBLIC_SENTRY_DSN` | optional | Sentry → Settings → Client Keys | Skip for now; wires up in [#105](../../../issues). |
| `SENTRY_AUTH_TOKEN` | optional | Sentry → User Settings → Auth Tokens | Only needed once Sentry source-map uploads are wired. |

> **Heads up:** the *pipeline* secrets (`SUPABASE_SERVICE_KEY`,
> `FINNHUB_API_KEY`, `HUGGINGFACE_API_KEY`, etc.) live in **GitHub Actions
> secrets**, not Vercel — the pipeline runs on Actions, not on Vercel.

## 3. Supabase auth: add the production redirect URL

The Vercel domain needs to be allow-listed for OAuth.

1. Supabase dashboard → **Authentication → URL Configuration**.
2. **Site URL** → your production domain (e.g. `https://marketmind.vercel.app`).
3. **Redirect URLs** → add all of:
   - `https://marketmind.vercel.app/auth/callback` (production)
   - `https://*.vercel.app/auth/callback` (any preview deploy)
   - `http://localhost:3000/auth/callback` (local dev)
4. Save.

## 4. Google OAuth: add the production redirect URI

1. <https://console.cloud.google.com> → your project → **APIs & Services →
   Credentials**.
2. Open the OAuth 2.0 Client used by Supabase.
3. **Authorized redirect URIs** → ensure `https://<supabase-project-ref>.supabase.co/auth/v1/callback`
   is present. Supabase proxies the callback; the Vercel domain is not added here.
4. Save.

## 5. Deploy

1. Back in Vercel → **Deployments** → trigger the first build (push to `main`
   does this automatically once the project's wired).
2. Watch the build log — it should finish in ~60-90s.
3. On success, click the production URL.

## 6. Post-deploy smoke checklist

Run these against the production URL after each deploy:

- [ ] `/login` renders the sign-in card + the preview cards below
- [ ] Google sign-in → redirects to `/` (or `/onboarding` for new users)
- [ ] `/` shows the daily-bonus card, schedule bar, and watchlist feed
- [ ] Place a bet → toast confirms with "Resolves today/tomorrow at 4:15 PM ET"
- [ ] `/stock/AAPL` (or any ticker) shows the 30-day sparkline + signals + verdict
- [ ] `/og/stock/AAPL` returns a 1200x630 PNG (paste URL into <https://www.opengraph.xyz>)
- [ ] `/bets` shows Bets tab with the placed bet + Credits tab with ledger
- [ ] `/profile` shows the badge grid (FIRST_BET should be lit after first bet)
- [ ] `/leaderboard` renders (may be empty until a week's data accumulates)
- [ ] `/about` renders the methodology page

## 7. Custom domain (optional)

1. Vercel → **Project → Settings → Domains → Add**.
2. Add your domain (e.g. `marketmind.app`).
3. Update DNS as Vercel instructs (CNAME or A records).
4. Update `NEXT_PUBLIC_SITE_URL` to the custom domain.
5. Update Supabase Site URL + Redirect URLs (section 3) to match.

## 8. Continuous deployment

- Every push to `main` deploys to production.
- Every PR gets its own preview URL (Vercel comments on the PR).
- Preview deploys can talk to the production Supabase (same anon key) — be
  mindful that test bets placed from a preview hit the real DB. For full
  isolation, set up a staging Supabase project + override
  `NEXT_PUBLIC_SUPABASE_URL` per-environment.

## 9. Crons live on GitHub Actions, not Vercel

The three production crons are GitHub Actions workflows, not Vercel cron
jobs. Why: they're Python (Vercel cron runs serverless functions; ours
need ta-lib, yfinance, supabase-py), they need long timeouts, and they
already run reliably via Actions.

- `fetch-insights.yml` — nightly 8 PM ET pipeline
- `resolve-predictions.yml` — daily 4:15 PM ET resolution
- `compute-leaderboard.yml` — weekly Sunday 11 PM UTC snapshot

See [ADR 0004](adr/0004-github-actions-for-pipeline.md) for the rationale.

## 10. Rollback

Vercel makes this painless:

1. **Deployments** → find the last good deployment.
2. **⋯ menu → Promote to Production**.
3. Done — instant rollback, no build wait.

For DB rollbacks, see [RUNBOOK.md → "Rolling back" under migrations](RUNBOOK.md).
