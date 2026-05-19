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
git clone https://github.com/neelesh1206/market-mind.git
cd market-mind
npm install
```

### 2. Supabase — production project (one-time)

1. Create new project at [supabase.com](https://supabase.com) → name: `marketmind-prod`
2. Wait for project provisioning (~2 min)
3. **Do not apply migrations via SQL Editor.** Production schema changes go through the [Apply Migrations workflow](#applying-migrations-to-production) ([ADR 0006](adr/0006-migrations-via-github-actions.md))
4. Authentication → URL Configuration:
   - Site URL: `http://localhost:3000`
   - Redirect URLs: add `http://localhost:3000/auth/callback` and `https://marketmind.neeleshkakaraparthi.dev/auth/callback`
5. Authentication → Providers → enable Google (requires Google OAuth credentials — see [Google OAuth setup](#google-oauth-setup) below)

### 3. Supabase — local dev (per developer)

Install the Supabase CLI:

```bash
# macOS via Homebrew
brew install supabase/tap/supabase

# OR via npm (no global install needed)
npx supabase --version
```

Start a local Supabase stack (Postgres + Auth + Storage in Docker):

```bash
cd supabase
supabase start          # spins up Docker containers
supabase db reset       # applies all migrations + seed
```

Endpoint URLs printed by `supabase start` go into a local `.env.local`. The local stack runs alongside the prod project — they're independent.

### 4. Generate TypeScript types from prod schema

```bash
npx supabase gen types typescript --project-id cqbdjiphrrdwmbrqoeeh > src/types/database.ts
```

Commit the generated file. Re-run whenever the schema changes.

### 5. Applying migrations to production

**Never edit prod schema by hand.** Use the workflow:

1. Add your new migration file under `supabase/migrations/` (timestamped name)
2. Open a PR — the [`validate-migrations`](.github/workflows/validate-migrations.yml) action runs automatically against a clean local Supabase stack
3. Merge the PR
4. Go to **Actions → "Apply Migrations to Production" → Run workflow**
5. Type the literal string `migrate` in the confirmation input
6. Watch the dry-run logs in the workflow output
7. The workflow applies, then runs a post-verification query

If something looks wrong in the dry-run, cancel the workflow before the apply step.

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
MASSIVE_API_KEY=                # required for the stock detail sparkline (server-side only)
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

### Google OAuth setup

Supabase deprecated its shared OAuth client in late 2024 — every project now needs its own Google credentials. This is a one-time setup.

1. **Create a project** in [Google Cloud Console](https://console.cloud.google.com): top-left dropdown → New Project → name `marketmind` → Create. Select it once created.
2. **OAuth consent screen** (APIs & Services → OAuth consent screen):
   - User Type: External
   - App name: `MarketMind`
   - User support email + Developer contact: your Gmail
   - Scopes: skip (defaults are correct — `email`, `profile`, `openid`)
   - Test users: add your email + any friends who'll sign in while in Testing mode
3. **OAuth Client ID** (APIs & Services → Credentials → Create Credentials → OAuth client ID):
   - Application type: Web application
   - Name: `MarketMind Web Client`
   - Authorized JavaScript origins:
     - `http://localhost:3000`
     - `https://marketmind.neeleshkakaraparthi.dev`
   - Authorized redirect URIs:
     - `https://cqbdjiphrrdwmbrqoeeh.supabase.co/auth/v1/callback` (Supabase project URL + `/auth/v1/callback`)
4. **Copy Client ID + Secret** from the modal that pops up
5. **Wire into Supabase** (Authentication → Providers → Google):
   - Toggle ON
   - Paste Client ID + Secret
   - Save

> **Testing vs Production mode.** While the consent screen is in Testing mode (default), only listed test users can sign in. For MVP this is fine. Promoting to Production only requires Google verification for sensitive scopes — `email/profile/openid` don't need it, but Google still recommends it eventually.

### Optional: magic-link email as backup
Auth → Providers → Email → enable Magic Link. Lets you sign in without configuring Google for new test users.

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

### Migration secrets (one-time)

For [`apply-migrations.yml`](.github/workflows/apply-migrations.yml) to work, add:

| Secret | Where to get it |
|--------|-----------------|
| `SUPABASE_ACCESS_TOKEN` | [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) → Generate new token (name it `marketmind-cicd`) |
| `SUPABASE_DB_PASSWORD` | The DB password you saved when creating `marketmind-prod` (if lost, reset under Project Settings → Database) |
| `SUPABASE_PROJECT_REF` | The project ref from your Supabase URL (`cqbdjiphrrdwmbrqoeeh`) |

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
