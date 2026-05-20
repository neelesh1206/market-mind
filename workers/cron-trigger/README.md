# marketmind-cron-trigger

External cron-firing Cloudflare Worker that dispatches MarketMind's pipeline
workflows on GitHub Actions. **This Worker is the single source of truth for
pipeline schedule timing.**

## Why this exists

GitHub Actions' `schedule:` triggers are best-effort. Microsoft's own docs
warn that scheduled workflows can be delayed by **hours during high load**
and occasionally **skipped entirely**. We observed multi-hour drift on
free-tier runs of `fetch-insights.yml`. For a daily ritual app where "did
the insights pipeline run last night?" is the difference between functioning
and broken, that's not acceptable.

Cloudflare Workers' cron triggers advertise accuracy within ~1 minute. In
practice they're materially more reliable than GH's. So we use CF as the
clock and GH as the runner — `workflow_dispatch` is rock-solid even when
`schedule:` is flaky.

See [ADR 0016](../../docs/adr/0016-external-cron-via-cloudflare-worker.md)
for the full rationale.

## What it does

1. Three CF cron triggers fire on the schedules defined in `wrangler.toml`.
2. For each fire, the Worker looks up the matching workflow file in
   `CRON_TO_WORKFLOW` (in `src/index.ts`) and POSTs to GitHub's
   `/actions/workflows/{file}/dispatches` endpoint.
3. GitHub queues the workflow run; the existing `concurrency` block in each
   workflow prevents duplicate runs if a manual dispatch and the cron
   collide.

The Worker has no business logic, no DB access, and writes no state.

## Schedule map

| Cron (UTC)         | Workflow                    | ET local time       |
| ------------------ | --------------------------- | ------------------- |
| `0 0 * * 2-6`      | `fetch-insights.yml`        | 20:00 Mon–Fri       |
| `15 21 * * 1-5`    | `resolve-predictions.yml`   | 17:15 Mon–Fri       |
| `0 23 * * 0`       | `compute-leaderboard.yml`   | 19:00 Sunday        |

Keep `wrangler.toml [triggers] crons` and `CRON_TO_WORKFLOW` in `src/index.ts`
synchronized — drift between them is logged as an error at fire time.

## One-time setup

### 1. Install Wrangler (Cloudflare CLI)

```bash
cd workers/cron-trigger
npm install
```

### 2. Log into Cloudflare

```bash
npx wrangler login
```

Opens a browser to authorize the CLI against your CF account.

### 3. Mint a fine-grained GitHub PAT

Go to: **GitHub → Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token**.

- **Repository access**: select `neelesh1206/market-mind` (only this repo)
- **Permissions → Repository permissions → Actions**: `Read and write`
- **Expiration**: 1 year (rotate annually; calendar reminder)

Copy the token (`github_pat_...`) — you won't see it again.

### 4. Store the PAT as a Worker secret

```bash
npx wrangler secret put GITHUB_PAT
# paste the token when prompted
```

### 5. Deploy

```bash
npx wrangler deploy
```

Wrangler prints the Worker URL (we don't use it — the Worker has no fetch
handler — but it confirms deploy succeeded). The crons start firing
automatically on their next scheduled time.

## Verifying it works

### Live log tail

```bash
npx wrangler tail
```

Wait for a scheduled fire (or trigger one manually — see next section).
You should see:

```
[cron-trigger] dispatched fetch-insights.yml (cron=0 0 * * 2-6) in 312ms — HTTP 204
```

### Manual trigger for testing

```bash
# `--test-scheduled` exposes a /cdn-cgi/handler/scheduled endpoint locally
# AND on the deployed Worker. Use the deployed URL printed by `wrangler deploy`:
curl "https://marketmind-cron-trigger.<your-subdomain>.workers.dev/cdn-cgi/handler/scheduled?cron=0+0+*+*+2-6"
```

A `200 OK` means the scheduled handler ran. Check the GH Actions tab to
confirm a new `workflow_dispatch` run appeared on `fetch-insights.yml`.

### Confirm GH-side

After a fire, the GH Actions tab should show a new run with trigger
`workflow_dispatch` (not `schedule`, since we removed those). The Worker's
PAT user (or `github-actions[bot]` if the PAT was set up that way) shows
as the triggering actor.

## Updating the schedule

1. Edit both `wrangler.toml [triggers] crons` AND `CRON_TO_WORKFLOW` in
   `src/index.ts` in the same commit.
2. `npx wrangler deploy`.

That's the whole loop. No GH workflow file change needed — they already
expose `workflow_dispatch:` and don't have `schedule:` blocks anymore.

## Operations

- **Logs**: Cloudflare dashboard → Workers → marketmind-cron-trigger →
  Logs tab. Or `npx wrangler tail` for live stream.
- **Last-known-good fire timestamps**: each successful dispatch logs at INFO
  level. If you want a persistent "last fire" timestamp visible in the UI,
  see #122 (pipeline health view).
- **Quotas**: Workers Free tier allows 100k requests/day. We use ~3/day.
- **PAT rotation**: annually. `wrangler secret put GITHUB_PAT` overwrites
  the existing secret atomically; no deploy needed afterward.
- **Failure mode**: if a dispatch fails (e.g. PAT expired), the Worker
  throws and Cloudflare records the error. There is no automatic retry.
  The pipeline's stuck-bet UI (#124) surfaces missed runs to users so the
  silent-failure window is bounded.

## Cost

$0/month. Workers Free tier:
- 100,000 requests/day (we use ~3)
- 10ms CPU per invocation (we use ~50ms but only on scheduled fires which
  don't count against CPU limits the same way)
- No bandwidth limits relevant at this volume
