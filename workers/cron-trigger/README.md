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

| Cron (UTC)         | Workflow                      | ET local time          |
| ------------------ | ----------------------------- | ---------------------- |
| `0 0 * * 2-6`      | `fetch-insights.yml`          | 20:00 Mon–Fri          |
| `15 21 * * 1-5`    | `resolve-predictions.yml`     | 17:15 Mon–Fri (EDT)*   |
| `0 23 * * SUN`     | `compute-leaderboard.yml`     | 19:00 Sunday           |
| `0 12 * * SUN`     | `compute-stock-rotation.yml`  | 07:00–08:00 Sunday*    |

\* ET wall-clock shifts ±1h across DST since the crons are anchored in UTC —
see [ADR 0016](../../docs/adr/0016-external-cron-via-cloudflare-worker.md).
Use `SUN`, not `0`, for day-of-week — Cloudflare's parser rejects a bare `0`.

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

**⚠️ Verify the secret actually landed — do not skip this.** A missing or
mistyped secret does not error at deploy time; the Worker simply sends
`Authorization: Bearer undefined`, GitHub returns `401 Bad credentials`, and
every cron fails *silently*. This exact failure ran undetected for a week
(see Operations → Failure mode). Confirm it's present:

```bash
npx wrangler secret list
# Expect: [{ "name": "GITHUB_PAT", "type": "secret_text" }, ... ]
# If it prints []  →  the put did not take. Re-run `secret put` and re-check.
```

### 5. (Recommended) Wire the monitor — see "Monitoring" below

Set `HEALTHCHECK_URL` so a future credential/scheduler failure alerts you
instead of running silent. Optional but strongly recommended.

### 6. Deploy

```bash
npx wrangler deploy
```

Wrangler confirms deploy succeeded (the Worker has no fetch handler and
`workers_dev = false`, so there is **no public URL** — that's intentional).
The crons start firing automatically on their next scheduled time.

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

### Manual trigger for testing (against the REAL deployed secret)

Because `workers_dev = false` there is no public URL to curl. Instead run the
deployed Worker locally in **remote** mode — this executes the live code on
Cloudflare's edge with the **real production secrets/bindings**, which is what
makes it a trustworthy test of auth:

```bash
npx wrangler dev --remote --test-scheduled --port 8799
# in another shell (or background the above), fire a specific cron:
curl "http://localhost:8799/__scheduled?cron=15+21+*+*+1-5"
```

Watch the `wrangler dev` output:

- `dispatched <workflow> ... HTTP 204`  → ✅ working (a real run is queued)
- `dispatch failed ... HTTP 401 ... Bad credentials`  → the `GITHUB_PAT`
  secret is absent or invalid (run `wrangler secret list`; see Setup step 4)

> Note: a successful probe queues a **real** workflow run. `fetch-insights`
> and `resolve-predictions` are safe to re-fire (idempotent + `concurrency`
> guard), but don't spam them.

Then confirm GH-side with `gh run list --workflow=resolve-predictions.yml`.

### Confirm GH-side

After a fire, the GH Actions tab should show a new run with trigger
`workflow_dispatch` (not `schedule`, since we removed those). The Worker's
PAT user (or `github-actions[bot]` if the PAT was set up that way) shows
as the triggering actor.

## Monitoring (dead-man's-switch)

CF logging a thrown error is worthless if nobody is reading CF logs. We
learned this the hard way: the Worker dispatched with an absent `GITHUB_PAT`
for a week, GitHub returned `401` on every fire, the Worker threw on every
fire — and it was **completely silent** because no one tails CF logs daily.

The Worker now pings an external monitor on every fire (best-effort, optional):

- **Success** → pings the base `HEALTHCHECK_URL`. Configure the monitor's
  expected period to match the cron cadence; a missed ping (Worker never
  ran — e.g. a CF scheduler issue) trips an alert after the grace window.
- **Failure** → pings `<HEALTHCHECK_URL>/fail` with the error detail, firing
  an **immediate** alert. This is the case that bit us (dispatch reached
  GitHub but was rejected).

If `HEALTHCHECK_URL` is unset, monitoring is simply off and the Worker behaves
exactly as before — a monitoring outage never blocks or masks a real dispatch.

### Current deployment (live since 2026-05-28)

- **Provider**: healthchecks.io, check name **`marketmind-cron`**, in the
  project owner's healthchecks account.
- **Ping URL**: stored only as the Worker secret `HEALTHCHECK_URL`. It's a
  capability URL (`https://hc-ping.com/<uuid>`) — anyone holding it can spoof
  a heartbeat or trip `/fail`, so **it is never committed to this repo**.
  Retrieve it from the healthchecks check page if you need to re-set it.
- **Schedule**: Period `1 day`, Grace `16 hours`. The grace is deliberately
  loose: the Worker pings on every successful dispatch, and the crons leave a
  legitimate ~36h quiet window over the weekend (Sat 00:00 UTC fetch → Sun
  12:00 UTC rotation — no Sat resolve, no Sun fetch). Period + grace must
  exceed ~36h or the check false-alarms every weekend. The immediate `/fail`
  ping is the real-time net, so a loose dead-man's-switch loses nothing.
- **Alert channel**: email to the project owner. Add Slack/Discord in the
  healthchecks check's Integrations tab if desired.

### Setup (first-time)

1. Create a free check at [healthchecks.io](https://healthchecks.io) (or use
   any endpoint following the `<url>` = OK / `<url>/fail` = fail convention —
   a Better Stack / Cronitor heartbeat, etc.). Set the period to your
   tightest cadence (daily) with a grace of a few hours.
2. Store the ping URL as a secret and redeploy:
   ```bash
   npx wrangler secret put HEALTHCHECK_URL   # paste the check's ping URL
   npx wrangler secret list                  # confirm GITHUB_PAT + HEALTHCHECK_URL present
   ```
   No `wrangler.toml` change needed — it's read from `env` like `GITHUB_PAT`.
3. Add your email/Slack/Discord as the alert channel in the monitor's UI.

> Multi-schedule note: with one check covering several crons, a daily-period
> + multi-hour-grace config catches "nothing fired for a day," which is the
> alert that matters. The **failure** ping is schedule-agnostic and fires
> regardless — that's the primary safety net here.

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
  the existing secret atomically; no deploy needed afterward. **Always run
  `wrangler secret list` afterward to confirm it took** — a failed put is
  silent (see Failure mode).
- **Failure mode**: if a dispatch fails (bad/absent PAT → 401, missing
  workflow → 404, bad ref → 422), the Worker throws and Cloudflare records
  the error. There is **no automatic retry**, and CF logs are not actively
  watched — so wire `HEALTHCHECK_URL` (see Monitoring) for an active alert.
  The pipeline's stuck-bet UI (#124) is only a weak backstop.
- **Known incident (2026-05)**: the `GITHUB_PAT` secret was absent on the
  deployed Worker (a `wrangler secret put` that never took / went to the
  wrong place). The Worker sent `Bearer undefined`, GitHub returned
  `401 Bad credentials` on every fire, and the pipeline ran silent for ~7
  days before anyone noticed stale data. Root cause: no post-`put`
  verification and no failure alerting — both now addressed above.

## Cost

$0/month. Workers Free tier:
- 100,000 requests/day (we use ~3)
- 10ms CPU per invocation (we use ~50ms but only on scheduled fires which
  don't count against CPU limits the same way)
- No bandwidth limits relevant at this volume
