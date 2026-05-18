# Setup

Manual steps to get MarketMind running locally and in production. Update this file whenever you encounter a setup step that isn't already documented.

---

## Prerequisites

- Node.js 20+
- Python 3.11+
- Git
- Accounts: Supabase, Vercel, GitHub, Massive (formerly Polygon.io), HuggingFace, Upstash

---

## Local development

### 1. Clone and install

```bash
git clone https://github.com/neelesh1206/marketmind.git
cd marketmind
npm install
```

### 2. Supabase project

1. Create new project at [supabase.com](https://supabase.com) → name: `marketmind-dev`
2. Wait for project provisioning (~2 min)
3. Database → SQL Editor → paste contents of `supabase/migrations/*.sql` in order
4. Authentication → Providers → enable Google → set redirect URLs:
   - `http://localhost:3000/auth/callback`
   - `https://marketmind.neeleshkakaraparthi.dev/auth/callback` (prod)
5. Run seed: `psql $DATABASE_URL < supabase/seed.sql` (seeds 50 stocks)
6. Generate types: `npx supabase gen types typescript --project-id <id> > types/database.ts`

### 3. Environment variables

Copy `.env.example` → `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_SENTRY_DSN=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

### 4. Run dev server

```bash
npm run dev
# open http://localhost:3000
```

---

## Python pipeline (local)

### 1. Install

```bash
cd pipeline
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Pipeline env

Create `pipeline/.env`:

```env
SUPABASE_URL=
SUPABASE_SERVICE_KEY=        # service_role key, not anon
MASSIVE_API_KEY=
FINNHUB_API_KEY=
HUGGINGFACE_API_KEY=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
SENTRY_DSN=
MARKETWATCH_SESSION_COOKIE=  # optional — leave empty if not subscribed
```

### 3. Run manually

```bash
# Single stock for testing
python fetch_insights.py --ticker NVDA --dry-run

# Full run
python fetch_insights.py

# Resolution job
python resolve_predictions.py
```

---

## Third-party account setup

### Massive (formerly Polygon.io)
1. Sign up at [massive.com](https://massive.com)
2. Upgrade to Stocks Starter ($29/mo)
3. Dashboard → API Keys → create key
4. Add to GitHub secrets as `MASSIVE_API_KEY`

### HuggingFace Pro
1. Sign up at [huggingface.co](https://huggingface.co)
2. Subscribe to Pro ($9/mo)
3. Settings → Access Tokens → create read token
4. Add to GitHub secrets as `HUGGINGFACE_API_KEY`

### Finnhub (free)
1. Sign up at [finnhub.io](https://finnhub.io)
2. Free tier API key from dashboard
3. Add to GitHub secrets as `FINNHUB_API_KEY`

### Reddit API (free)
1. Go to [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps)
2. Create "script" app
3. Note client ID + secret
4. Add to GitHub secrets

### Upstash Redis
1. Sign up at [upstash.com](https://upstash.com)
2. Create Redis database (free tier)
3. Copy REST URL and token
4. Add to `.env.local`

### Sentry
1. Sign up at [sentry.io](https://sentry.io) free tier
2. Create two projects: `marketmind-web` (Next.js) and `marketmind-pipeline` (Python)
3. Get DSN from each
4. Add to respective env files

### PostHog
1. Sign up at [posthog.com](https://posthog.com) free tier
2. Create project: `marketmind-prod`
3. Copy project API key
4. Add to `.env.local` as `NEXT_PUBLIC_POSTHOG_KEY`

---

## Deployment

### Vercel
1. Import GitHub repo
2. Framework: Next.js (auto-detected)
3. Environment variables → paste all `NEXT_PUBLIC_*` and Redis vars
4. Deploy
5. Settings → Domains → add `marketmind.neeleshkakaraparthi.dev`
6. Vercel shows CNAME target → add to DNS provider

### DNS (where neeleshkakaraparthi.dev is registered)
```
Type:   CNAME
Name:   marketmind
Value:  cname.vercel-dns.com
Proxy:  DNS only (orange cloud OFF for Cloudflare)
```
Propagation: 5–30 min. Vercel handles SSL automatically.

### GitHub Actions secrets
Settings → Secrets and variables → Actions → add all pipeline env vars.

---

## Verifying it works

After full setup, run this checklist:

- [ ] Local dev server loads at `localhost:3000`
- [ ] Google Sign-In works (creates row in `auth.users` + `user_profiles`)
- [ ] Pipeline runs locally: `python fetch_insights.py --ticker NVDA`
- [ ] `stock_insights` table has new row after pipeline run
- [ ] GitHub Action manual dispatch (`workflow_dispatch`) succeeds
- [ ] Production deploy at `marketmind.neeleshkakaraparthi.dev` loads
- [ ] Sentry receives a test error (add a temporary throw)
- [ ] PostHog receives a test event

---

## Troubleshooting

*(Add entries here as issues are encountered during development.)*
