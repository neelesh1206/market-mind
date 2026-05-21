# 0016 · External cron trigger via Cloudflare Worker

- **Date:** 2026-05-19
- **Status:** Accepted
- **Supersedes:** the `schedule:` triggers in `fetch-insights.yml`,
  `resolve-predictions.yml`, and `compute-leaderboard.yml`

## Context

MarketMind's three pipeline workflows (insights generation, prediction
resolution, weekly leaderboard) were originally triggered by GitHub
Actions `schedule:` cron blocks. We observed two problems in production:

1. **Drift**: the `fetch-insights.yml` cron of `0 0 * * 2-6` (00:00 UTC)
   fired ~3 hours late on its first eligible run (2026-05-18, scheduled
   for 17:00 PDT, actually fired at 19:53 PDT). GitHub's own documentation
   explicitly warns: *"the schedule event can be delayed during periods of
   high loads of GitHub Actions workflow runs. High load times include the
   start of every hour."* For a daily-ritual app where the bet window
   opens immediately after insights generation, multi-hour drift erodes
   user trust ("why does the app say the data is from yesterday?").

2. **No reliability guarantee**: GitHub doesn't promise scheduled runs
   will fire at all during high load. A missed `resolve-predictions` run
   leaves users with unresolved bets blocking their daily claim. We
   already mitigated this with the stuck-bet UI (#124), but that's a
   user-visible failure mode, not a fix.

Our pipelines are not latency-sensitive to the minute, but they ARE
sensitive to:
- **Reliable firing** (a missed run = a broken day for users)
- **Sub-hour precision** (the bet window opens immediately after insights
  generation; multi-hour delays compound user confusion)
- **Observability** (we need to know when a fire was skipped, not just
  delayed)

## Decision

Move the trigger source out of GitHub Actions to a **Cloudflare Worker**
that fires three cron triggers on the same schedules and dispatches each
GH workflow via the `workflow_dispatch` REST API. GitHub keeps
`workflow_dispatch:` blocks (rock-solid; no SLA issues observed on
manual dispatches) but drops `schedule:` blocks entirely. **The Worker
is the single source of truth for pipeline timing.**

The Worker lives in this repo at `workers/cron-trigger/` with full code +
config; deploy is `npx wrangler deploy`. PAT auth via a fine-grained
GitHub token with `actions: write` scope, stored as a Cloudflare Worker
secret.

## Alternatives considered

### Keep GH `schedule:`, add `cron-job.org` as a backup

- **Pros**: no code; cron-job.org has a free tier; HTTP-only.
- **Cons**: dual-firing has to be reconciled at the workflow level via
  the `concurrency` block (works, but adds reasoning load every time the
  workflow changes); cron-job.org settings live outside the repo (not
  reviewable, no diff history); the trigger logic is split across two
  unrelated systems.
- **Verdict**: rejected. We want a single source of truth.

### Self-hosted runner with a real Linux cron

- **Pros**: full control over timing.
- **Cons**: requires a VPS or always-on machine; introduces a new
  runtime to monitor + patch; overkill for ~3 fires/day; user has no
  existing VPS infrastructure for this project.
- **Verdict**: rejected. Vastly disproportionate to the problem.

### AWS EventBridge → GitHub via Lambda

- **Pros**: more reliable than GH cron.
- **Cons**: new AWS account / new IAM surface; Lambda cold-start cost;
  user's infrastructure footprint is currently GitHub + Supabase +
  Vercel + Cloudflare DNS — adding AWS doubles the surface area.
- **Verdict**: rejected. Cloudflare reaches parity for our use case
  using infrastructure the user already operates.

### Cloudflare Worker with cron triggers (chosen)

- **Pros**: code lives in this repo (portfolio visibility, code review,
  diff history); user already uses Cloudflare for custom-domain DNS so
  no new vendor; Workers Free tier ($0) covers ~3 fires/day with 100,000
  to spare; CF cron triggers advertised as reliable within ~1 minute and
  empirically more so than GH's; single source of truth for timing.
- **Cons**: introduces a fourth deploy target (Vercel + GH Actions +
  Supabase + CF Workers). Mitigated by the fact that the Worker is tiny
  (~80 lines), has zero business logic, deploys in one command, and
  almost never needs to change.
- **Verdict**: accepted.

## Implementation

### Architecture

```
┌──────────────────────────┐    fire (UTC schedule)    ┌─────────────────┐
│ Cloudflare Worker        │ ────────────────────────► │ Worker handler  │
│ (cron triggers)          │                            │ (dispatches GH) │
└──────────────────────────┘                            └────────┬────────┘
                                                                 │
                                  POST /actions/workflows/.../dispatches
                                                                 │
                                                                 ▼
                                                       ┌─────────────────┐
                                                       │ GitHub Actions  │
                                                       │ (runs workflow) │
                                                       └─────────────────┘
```

### Cron mapping

Three cron expressions map 1:1 to the three workflow files. Mapping lives
in two places that must stay in sync:

1. `workers/cron-trigger/wrangler.toml` → `[triggers] crons = [...]`
2. `workers/cron-trigger/src/index.ts` → `CRON_TO_WORKFLOW` object

A cron that fires from CF but isn't in the TS map logs an error and
no-ops (fail loud, not silently). The README documents this invariant.

### Auth

Fine-grained PAT scoped to `neelesh1206/market-mind` only, with
`actions: write` permission. Stored as `GITHUB_PAT` Worker secret via
`wrangler secret put GITHUB_PAT`. Rotation cadence: annual (calendar
reminder); rotation is atomic (`wrangler secret put` overwrites without
deploy).

### Concurrency safety

Each GH workflow already declares `concurrency: { group: <name>,
cancel-in-progress: false }`. Even if the Worker dispatches while a
manual dispatch is mid-flight, GH queues the second run rather than
running both — a desirable property regardless of who triggered each.

### Observability

- **Live tail**: `npx wrangler tail` from `workers/cron-trigger/` streams
  Worker logs in real time.
- **Dashboard**: Cloudflare → Workers → marketmind-cron-trigger → Logs.
- **Successful dispatch log line**: `[cron-trigger] dispatched <workflow>
  (cron=<expr>) in <ms>ms — HTTP 204`. Easy to grep.
- **Failed dispatch**: Worker throws → Cloudflare records the error →
  visible in Logs tab. No retry. Future: wire this into the pipeline
  health view (#122) so missed fires surface in-app.

## Consequences

### Positive

- **Reliability**: trigger source no longer subject to GH Actions cron
  drift / skip risk.
- **Single source of truth**: schedule lives in one TOML file, version
  controlled, code-reviewed.
- **Cost**: $0/month, well within Workers Free tier.
- **No new vendor**: Cloudflare account already exists for DNS.
- **Portfolio surface**: small but visible piece of infra showing the
  user understands distributed system reliability trade-offs.

### Negative

- **One more deploy target** to remember during incidents. Mitigated by
  the Worker's near-zero change rate — it only changes when the schedule
  changes (rare) or the PAT rotates (annual).
- **PAT expiration risk**: if the PAT expires and no one rotates it, all
  pipelines silently stop. Mitigation: annual calendar reminder; future
  improvement is the pipeline health view (#122) surfacing stale fires.
- **Manual deploy step**: `wrangler deploy` is not in CI yet. For
  now this is acceptable — the Worker rarely changes — but if it
  becomes a flow problem, wire up a GH Action that deploys the Worker
  on pushes to `workers/cron-trigger/**`.

## Out of scope

- **Per-fire alerting** when GH responds non-2xx. Defer to #122
  pipeline health view, which will show "last successful run" timestamps
  derived from `pipeline_runs` rows. That's the right surface — the
  user-visible question is "did the pipeline actually complete?", not
  "did the dispatch fire?".
- **Auto-deploy of the Worker on PR merge.** Manual deploy is fine for
  the rare-change cadence; revisit if the Worker starts changing weekly.
- **PAT rotation automation**. Annual manual rotation is fine for a
  solo-dev portfolio project.

## Setup

Operational steps for deploying the Worker and rotating credentials are
in [workers/cron-trigger/README.md](../../workers/cron-trigger/README.md).
This ADR captures the *why*; that README captures the *how*.

## Amendment 2026-05-20 — DST behavior + Worker-redeploy discipline

Two operational gotchas surfaced after the first month of production.
Documenting both here so they don't have to be rediscovered.

### Crons are fixed in UTC, wall-clock PT shifts ±1h with DST

All schedule strings (`0 0 * * 2-6`, `15 21 * * 1-5`, etc.) are
interpreted as UTC by Cloudflare. **They never adjust for daylight
saving.** Concretely:

| Cron expression | UTC time | ET wall clock | PT wall clock |
|---|---|---|---|
| `0 0 * * 2-6` (fetch-insights)     | 00:00 UTC Tue–Sat | **8 PM ET** Mon–Fri | 5 PM PDT / 4 PM PST |
| `15 21 * * 1-5` (resolve)          | 21:15 UTC Mon–Fri | **5:15 PM ET** Mon–Fri | 2:15 PM PDT / 1:15 PM PST |
| `0 23 * * SUN` (leaderboard)       | 23:00 UTC Sun    | **7 PM ET** Sun | 4 PM PDT / 3 PM PST |
| `0 12 * * SUN` (stock rotation)    | 12:00 UTC Sun    | **8 AM ET** Sun | 5 AM PDT / 4 AM PST |

**By design**, all UI copy anchors to **ET** (never PT), because:

1. The market itself follows ET — anchoring the pipeline to ET keeps
   the relationship consistent ("8 PM ET = 4 hours after the 4 PM
   close, before the next bet window opens").
2. ET → PT is a fixed 3-hour offset year-round (because both shift
   together with DST), so a single ET label is correct in both
   seasons.

If a user mentally converts "8 PM ET" → "5 PM PT" they'll be right
during DST and an hour off during EST. That's the user's mental
conversion error, not a system bug. The system fires at the same UTC
instant year-round; only the wall-clock label they apply to it shifts.

Anyone tempted to "fix" the cron to fire at literal 5 PM PT year-round
should re-read this section. It's not a fix — it's two new bugs
(twice-yearly cron edit, or two crons that both fire during the DST
overlap weeks).

### Worker MUST be redeployed after wrangler.toml changes

`wrangler.toml` edits do **not** propagate to the running Cloudflare
Worker until `npx wrangler deploy` is run. Specifically, adding a new
cron to `[triggers] crons = [...]` registers the schedule in source
but doesn't activate it on Cloudflare's scheduler. Existing schedules
from the prior deploy continue firing; new ones don't fire at all
until deploy.

On 2026-05-20 we added a 4th cron (`0 12 * * SUN` for stock rotation)
in commit ec5eb22 but didn't immediately redeploy. The new schedule
sat dormant. A separate transient hiccup also caused `fetch-insights`
to miss its 5 PM PT fire that day. A clean redeploy reseated all 4
schedules and resolved both.

**Operational rule**: any commit that touches `workers/cron-trigger/`
must be followed by `cd workers/cron-trigger && npx wrangler deploy`.
A future task (#122 pipeline-health) will surface "last successful
fire was N hours ago" so this gap becomes visible in-app instead of
needing manual discovery.
