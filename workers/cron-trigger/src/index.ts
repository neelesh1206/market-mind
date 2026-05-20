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
 */

interface Env {
  /** Fine-grained PAT with `actions: write` on neelesh1206/market-mind. */
  GITHUB_PAT: string;
  /** `owner/repo` slug. Set via `wrangler.toml` [vars]. */
  REPO: string;
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
  // 04:00 UTC Sunday = ~midnight ET Sunday. Refreshes the eligibility
  // table from Finnhub. Runs early enough that the Phase 2 universe
  // rotation pipeline (still pending) can rely on fresh data. See ADR 0018.
  "0 4 * * SUN": "refresh-eligible-universe.yml",
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
      // 401 = bad PAT; 404 = workflow not found or PAT lacks actions:write
      // on this repo; 422 = ref doesn't exist. The body usually tells you
      // which. Throwing surfaces it in Cloudflare logs + (if wired) any
      // alerting on Worker errors.
      const body = await resp.text();
      throw new Error(
        `[cron-trigger] dispatch failed for ${workflow}: HTTP ${resp.status} after ${elapsedMs}ms — ${body}`,
      );
    }

    // 204 No Content is the success response per GitHub's docs. Log so
    // `wrangler tail` shows a positive heartbeat — useful when debugging
    // "did anything fire" questions without round-tripping to the GH UI.
    console.log(
      `[cron-trigger] dispatched ${workflow} (cron=${event.cron}) in ${elapsedMs}ms — HTTP ${resp.status}`,
    );
  },
};
