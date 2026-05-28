/**
 * MarketMind external cron trigger.
 *
 * Why this exists: GitHub Actions' scheduled triggers are best-effort — the
 * platform openly documents that schedules can be delayed by hours during
 * high load and occasionally skipped entirely. For a daily ritual app where
 * "did the insights pipeline run last night?" is the difference between a
 * functioning product and a broken one, best-effort isn't good enough.
 *
 * What it does: three Cloudflare cron triggers (one per pipeline workflow)
 * each dispatch the corresponding GitHub Actions workflow via the
 * `workflow_dispatch` REST API. Cloudflare's cron scheduler advertises
 * accuracy within ~1 minute; in practice it's been more reliable than
 * GitHub's own.
 *
 * GitHub workflow YAML files keep `workflow_dispatch:` but the `schedule:`
 * blocks were removed in the same PR — this Worker is the single source of
 * truth for pipeline timing. Manual reruns via the GH Actions UI still work.
 *
 * Auth: a fine-grained PAT scoped to this repo with `actions: write`. Stored
 * as a Worker secret (`wrangler secret put GITHUB_PAT`), never committed.
 *
 * Failure mode: if the GH API call fails, the Worker throws — Cloudflare
 * logs the error (visible in `wrangler tail` or the dashboard) but does NOT
 * retry. The pipeline's existing stuck-bet UI (ADR 0009 follow-up #124)
 * surfaces missed runs to users so the silent-failure window is bounded.
 *
 * Monitoring (dead-man's-switch): Cloudflare logging a thrown error is
 * worthless if nobody reads CF logs. We learned this the hard way — the
 * Worker dispatched with an absent/invalid PAT for a week, GitHub returned
 * 401 every fire, the Worker threw every fire, and it was completely silent
 * because nobody was tailing CF logs. So we ping an external monitor
 * (healthchecks.io or any compatible endpoint) on every fire:
 *   - SUCCESS  → ping the base URL. The monitor expects a ping on the cron
 *                cadence; if one is missed (Worker never ran — CF scheduler
 *                issue), the monitor alerts after its grace period.
 *   - FAILURE  → ping `<url>/fail`. Fires an immediate alert — this is the
 *                case that bit us (dispatch reaches GitHub but is rejected).
 * Both are best-effort and OPTIONAL: if HEALTHCHECK_URL is unset the Worker
 * behaves exactly as before. A monitoring outage must never block or mask a
 * real dispatch, so ping failures are swallowed and the original dispatch
 * error is always rethrown.
 */

interface Env {
  /** Fine-grained PAT with `actions: write` on neelesh1206/market-mind. */
  GITHUB_PAT: string;
  /** `owner/repo` slug. Set via `wrangler.toml` [vars]. */
  REPO: string;
  /**
   * Optional dead-man's-switch ping URL (healthchecks.io check URL or any
   * endpoint following the `<url>` = OK, `<url>/fail` = failure convention).
   * Set via `wrangler secret put HEALTHCHECK_URL`. Absent = monitoring off.
   */
  HEALTHCHECK_URL?: string;
}

/**
 * Best-effort ping to the external monitor. Never throws — a monitoring
 * outage must not affect (or mask) the actual dispatch outcome. Returns
 * nothing; callers don't await the result on the success path (we hand it
 * to ctx.waitUntil so it doesn't add latency to the scheduled handler).
 */
async function pingMonitor(
  env: Env,
  ok: boolean,
  detail: string,
): Promise<void> {
  if (!env.HEALTHCHECK_URL) return; // monitoring not configured — no-op
  const url = ok ? env.HEALTHCHECK_URL : `${env.HEALTHCHECK_URL}/fail`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "User-Agent": "marketmind-cron-trigger" },
      // Body is surfaced in the healthchecks.io event log — handy for
      // seeing *which* workflow and *why* without opening CF logs.
      body: detail.slice(0, 1000),
    });
  } catch {
    // Swallow: monitor unreachable is strictly less important than the
    // dispatch we already attempted. CF still logs the dispatch outcome.
  }
}

/**
 * Maps each cron expression to the workflow file it should dispatch.
 * Keep this in lockstep with `[triggers] crons = [...]` in wrangler.toml —
 * a cron that fires but isn't in this map will log an error and no-op.
 */
const CRON_TO_WORKFLOW: Record<string, string> = {
  // 00:00 UTC Tue–Sat = 20:00 ET Mon–Fri. Fetches Tier-1/2 data, computes
  // verdicts, writes marketmind_predictions for the next trading day.
  "0 0 * * 2-6": "fetch-insights.yml",
  // 21:15 UTC Mon–Fri = 17:15 ET Mon–Fri (75 min after the 16:00 ET close).
  // Resolves yesterday's predictions to WIN/LOSS/VOID, settles credits,
  // awards badges.
  "15 21 * * 1-5": "resolve-predictions.yml",
  // 23:00 UTC Sunday = 19:00 ET Sunday. Aggregates the prior week's
  // accuracy into the leaderboard view. Note: CF requires "SUN" rather
  // than 0 here — see wrangler.toml comment.
  "0 23 * * SUN": "compute-leaderboard.yml",
  // 12:00 UTC Sunday = ~07:00-08:00 ET Sunday. Weekly universe rotation
  // (Phase 2 of ADR 0018). Bets are closed all Sunday per
  // market-schedule.ts, so the rotation happens in a quiet window with
  // no in-flight user actions on the stocks table.
  "0 12 * * SUN": "compute-stock-rotation.yml",
};

export default {
  async scheduled(
    event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const workflow = CRON_TO_WORKFLOW[event.cron];
    if (!workflow) {
      // Unknown cron — wrangler.toml drifted from the map above. Log loud
      // so it surfaces in `wrangler tail`; nothing actionable to do at run
      // time other than refuse to dispatch a workflow we can't identify.
      console.error(`[cron-trigger] unknown cron expression: ${event.cron}`);
      return;
    }

    const url = `https://api.github.com/repos/${env.REPO}/actions/workflows/${workflow}/dispatches`;
    const startedAt = Date.now();

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_PAT}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        // GitHub requires a User-Agent for all API requests; use a stable
        // identifier so any rate-limit logs are easy to attribute.
        "User-Agent": "marketmind-cron-trigger",
      },
      body: JSON.stringify({ ref: "main" }),
    });

    const elapsedMs = Date.now() - startedAt;

    if (!resp.ok) {
      // 401 = bad/absent PAT; 404 = workflow not found or PAT lacks
      // actions:write on this repo; 422 = ref doesn't exist. The body
      // usually tells you which. We fire an IMMEDIATE failure ping (this is
      // the exact case that ran silent for a week) and then throw so CF also
      // records the exception. Await the ping so it lands before the
      // isolate is torn down by the throw.
      const body = await resp.text();
      const msg = `[cron-trigger] dispatch failed for ${workflow} (cron=${event.cron}): HTTP ${resp.status} after ${elapsedMs}ms — ${body}`;
      await pingMonitor(env, false, msg);
      throw new Error(msg);
    }

    // 204 No Content is the success response per GitHub's docs. Log so
    // `wrangler tail` shows a positive heartbeat — useful when debugging
    // "did anything fire" questions without round-tripping to the GH UI.
    const okMsg = `[cron-trigger] dispatched ${workflow} (cron=${event.cron}) in ${elapsedMs}ms — HTTP ${resp.status}`;
    console.log(okMsg);
    // Success heartbeat to the dead-man's-switch. waitUntil so it doesn't
    // add latency to the handler; if the monitor is down we don't care.
    ctx.waitUntil(pingMonitor(env, true, okMsg));
  },
};
