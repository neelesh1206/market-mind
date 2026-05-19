# Runbook

Operational procedures for MarketMind. Use when something goes wrong or needs manual intervention.

---

## Common operations

### Applying a new database migration

See [ADR 0006](adr/0006-migrations-via-github-actions.md) for the design.

**Authoring:**
1. Create a new file under `supabase/migrations/` with the naming convention `YYYYMMDDHHMMSS_short_description.sql`
2. Test locally:
   ```bash
   cd supabase
   supabase db reset       # applies all migrations from scratch
   ```
3. Open a PR. The `validate-migrations` workflow runs automatically.

**Applying to production:**
1. Merge the PR.
2. Go to **GitHub → Actions → "Apply Migrations to Production"**.
3. Click **Run workflow**.
4. Type `migrate` in the confirmation input. Any other value aborts.
5. Watch the dry-run output before the apply step. If anything looks wrong, cancel the workflow.

> **Seed data** lives inside the migration chain (idempotent via `ON CONFLICT DO NOTHING`).
> There's no separate seed step — `supabase db push` applies it.

**Rolling back:**
There's no automated rollback. To revert:
1. Write a new "down" migration that explicitly reverses the change
2. Apply via the same workflow
3. Never edit or delete a migration file that has already been applied to prod

### Re-run the insights pipeline for a specific date

Useful when the nightly cron failed or you want to backfill.

```bash
# Local
cd pipeline
python fetch_insights.py --date 2026-05-18

# Or via GitHub Actions
gh workflow run fetch-insights.yml -f date=2026-05-18
```

### Re-run resolution for a specific date

```bash
python resolve_predictions.py --date 2026-05-18
```

### Pending migration: bet cancellation RPC

`cancel_bet` Postgres function (see [ADR 0009 — Cancellation](adr/0009-bet-placement-atomicity.md#cancellation-added-2026-05-19))
ships in `supabase/migrations/20260519000004_cancel_bet_rpc.sql`. Until
applied, the cancel button in BetSheet surfaces "Cancel isn't enabled
on the server yet (migration pending)" — that's the error code for an
unapplied migration, not a runtime bug.

Apply via the same workflow as place_bet. After it runs, smoke-test:

1. Place a 50-credit bet on any stock.
2. Click the locked-in chip → BetSheet opens in manage mode.
3. Click **Cancel bet** twice (first tap arms, second commits).
4. Confirm: the `predictions` row is gone, `credit_transactions` has a
   matching `type='REFUND'`, `amount=+50` row with `balance_after`
   reflecting the refund, and `user_profiles.credit_balance` returned
   to its pre-bet value.

### Pending migration: bet placement RPC

The `place_bet` Postgres function (see [ADR 0009](adr/0009-bet-placement-atomicity.md))
ships in `supabase/migrations/20260519000003_place_bet_rpc.sql` but must be
applied to prod before any user can place a bet — without it, the
`supabase.rpc('place_bet', ...)` call from the server action returns a
"function does not exist" error and the BetSheet shows a generic
"Couldn't place bet" message.

Apply via the standard migration flow (Actions → "Apply Migrations to
Production" → type `migrate`). After it runs, smoke-test by placing a
50-credit bet on any stock and confirming:

1. The card flips to the locked-in chip (`UP · 50 · Locked in`).
2. `predictions` has the new row.
3. `credit_transactions` has a paired `type='WAGER'`, `amount=-50` row
   with `balance_after = previous - 50`.
4. `user_profiles.credit_balance` decremented and `total_predictions`
   incremented by 1.

If any of those drift, the RPC didn't run atomically — check
`supabase logs` for the failed transaction.

### Check pipeline health

```sql
-- Last 7 runs
SELECT id, run_type, started_at, completed_at, status,
       stocks_processed, sources_succeeded, sources_failed
FROM pipeline_runs
ORDER BY started_at DESC
LIMIT 7;

-- Failing sources by frequency
SELECT source_name, count(*) as failures
FROM stock_insight_sources
WHERE status = 'failed'
  AND fetched_at > now() - interval '7 days'
GROUP BY source_name
ORDER BY failures DESC;
```

---

## Incident playbooks

### Pipeline failed at 8 PM cron

1. Check Sentry — most failures surface there with traceback
2. Check `pipeline_runs` table for the failed run
3. Check `stock_insight_sources` for partial state
4. Common causes:
   - Massive API key expired → rotate, update GitHub secret
   - HuggingFace rate limit hit → wait 30 min, retry
   - MarketWatch session cookie expired → refresh cookie from browser, update secret
5. Re-trigger workflow: `gh workflow run fetch-insights.yml`

### Resolution job missed market close

1. Check if market actually closed normally (holiday? early close?)
2. If holiday: mark affected predictions as `VOID`, refund credits
3. If genuine miss: re-run resolution manually with correct date

```sql
-- Void affected predictions
UPDATE predictions
SET outcome = 'VOID', resolved = true, resolved_at = now()
WHERE prediction_date = '2026-05-18' AND resolved = false;

-- Refund stakes
INSERT INTO credit_transactions (user_id, amount, type, reference_id, balance_after)
SELECT user_id, credits_wagered, 'refund_void', id,
       (SELECT credit_balance FROM user_profiles WHERE id = user_id) + credits_wagered
FROM predictions WHERE outcome = 'VOID' AND prediction_date = '2026-05-18';
```

### MarketWatch scrape blocked

Expected periodically. Pipeline degrades gracefully — `stock_insights.marketwatch_summary` will be null, but everything else continues.

To restore:
1. Log into MarketWatch in browser
2. DevTools → Application → Cookies → copy session cookie
3. Update `MARKETWATCH_SESSION_COOKIE` in GitHub secrets
4. Re-run pipeline

If blocked persistently → evaluate residential proxy vendor (Bright Data, Oxylabs).

### Supabase RLS denied unexpectedly

Symptom: API returns empty arrays where you expect data.

1. Check the policy: Supabase dashboard → Auth → Policies
2. Test with service role key: if it works, RLS is the issue
3. Common cause: query uses anon client, expects user-scoped data, but user not authenticated

### Vercel deploy fails

1. Check build logs in Vercel dashboard
2. Common causes:
   - Type error → fix locally, `npm run build` to reproduce
   - Missing env var → add via Vercel UI
   - Supabase types out of date → regenerate, commit

---

## Key rotation

Rotate these on a 90-day cycle (or after any suspected leak):

- `SUPABASE_SERVICE_KEY` — Supabase dashboard → Settings → API → reset
- `MASSIVE_API_KEY` — Massive dashboard → API Keys → regenerate
- `HUGGINGFACE_API_KEY` — HF settings → tokens → revoke + new
- `UPSTASH_REDIS_REST_TOKEN` — Upstash console → reset

After rotation, update both `.env.local` (dev) and GitHub Actions secrets + Vercel env vars (prod).

---

## Database backups

Supabase Free tier: no automated backups. Run weekly manual backup:

```bash
pg_dump $DATABASE_URL > backups/$(date +%Y-%m-%d).sql
```

Upgrade to Supabase Pro ($25/mo) when this becomes critical (i.e., real users with non-trivial data).

---

## Useful queries

```sql
-- Active users in last 7 days
SELECT count(DISTINCT user_id) FROM predictions
WHERE created_at > now() - interval '7 days';

-- Leaderboard for current week
SELECT u.display_name, count(*) as predictions,
       sum(case when outcome='WIN' then 1 else 0 end) as wins,
       sum(payout - credits_wagered) as net_credits
FROM predictions p
JOIN user_profiles u ON u.id = p.user_id
WHERE prediction_date >= date_trunc('week', current_date)
GROUP BY u.display_name
ORDER BY net_credits DESC;

-- Stocks people bet most on
SELECT s.ticker, count(*) as bet_count
FROM predictions p
JOIN stocks s ON s.id = p.stock_id
WHERE created_at > now() - interval '7 days'
GROUP BY s.ticker
ORDER BY bet_count DESC
LIMIT 10;
```
