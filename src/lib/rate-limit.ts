import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Rate-limiting layer for mutation server actions.
 *
 * Per-user sliding-window limits backed by Upstash Redis. The Redis client
 * is initialized lazily once on first import and reused across requests —
 * the @upstash/* libraries are HTTP-based (REST API, not a TCP pool) so
 * they're cold-start friendly and work fine in edge + serverless functions.
 *
 * **Graceful degradation:** when `UPSTASH_REDIS_REST_URL` or
 * `UPSTASH_REDIS_REST_TOKEN` is unset (local dev without Upstash creds), we
 * log a one-time warning and every `check()` call returns `{ ok: true }` so
 * the app keeps working. Production should set both, but a misconfigured
 * deploy should not lock everyone out of the app.
 *
 * Pattern:
 *   const { ok, retryAfter } = await rateLimit("placeBet", userId);
 *   if (!ok) return { ok: false, error: `Slow down — retry in ${retryAfter}s` };
 */

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

let redis: Redis | null = null;
let warnedNoEnv = false;

if (REDIS_URL && REDIS_TOKEN) {
  redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
}

/**
 * Per-action limit configuration. Keep these conservative — they're the
 * upper bound for honest users, not a tuning knob. Anyone hitting these
 * limits is either abusing the API or there's a runaway useEffect.
 */
const LIMITERS: Record<string, { requests: number; windowSec: number }> = {
  // Bet flow — both placement and cancellation. 10/min is generous; a real
  // user might bet on 5 stocks back-to-back, never 10/minute.
  placeBet: { requests: 10, windowSec: 60 },
  cancelBet: { requests: 10, windowSec: 60 },

  // Once-per-ET-day mechanic. 3/min is a leak-stopper; the RPC itself
  // enforces "already claimed today" so this is just to throttle hammering.
  claimDailyBonus: { requests: 3, windowSec: 60 },

  // Watchlist toggles. Users sometimes toggle several stocks in a session.
  watchlist: { requests: 20, windowSec: 60 },
};

// Cache constructed limiters so we don't rebuild on every check.
const limiterCache = new Map<string, Ratelimit>();

function getLimiter(name: keyof typeof LIMITERS): Ratelimit | null {
  if (!redis) return null;
  const existing = limiterCache.get(name);
  if (existing) return existing;

  const cfg = LIMITERS[name];
  if (!cfg) {
    // Shouldn't happen — `name` is keyof typeof LIMITERS — but
    // `noUncheckedIndexedAccess` flags the lookup as nullable.
    return null;
  }
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(cfg.requests, `${cfg.windowSec} s`),
    // Use a per-action namespace so different actions don't share counters.
    prefix: `mm:rl:${name}`,
    // Disable analytics tracking — Upstash records every check by default,
    // doubling our request count. We'd rather see the actual limit hits in
    // application logs.
    analytics: false,
  });
  limiterCache.set(name, limiter);
  return limiter;
}

export type RateLimitResult = {
  ok: boolean;
  /** Seconds until the next allowed request when blocked. 0 when ok. */
  retryAfter: number;
  /** Remaining requests in the current window when ok. */
  remaining: number;
};

/**
 * Check + consume a token from the named limiter for the given user.
 *
 * Returns immediately with `{ ok: true, retryAfter: 0 }` when Upstash isn't
 * configured (graceful no-op for local dev). Returns `{ ok: false }` with
 * a `retryAfter` in seconds when the user has exhausted the window.
 */
export async function rateLimit(
  name: keyof typeof LIMITERS,
  userId: string,
): Promise<RateLimitResult> {
  const limiter = getLimiter(name);
  if (!limiter) {
    if (!warnedNoEnv) {
      console.warn(
        "[rate-limit] UPSTASH_REDIS_REST_URL / TOKEN not configured — rate limiting disabled. Set both env vars to enable.",
      );
      warnedNoEnv = true;
    }
    return { ok: true, retryAfter: 0, remaining: Infinity };
  }

  try {
    const { success, reset, remaining } = await limiter.limit(userId);
    return {
      ok: success,
      retryAfter: success ? 0 : Math.max(0, Math.ceil((reset - Date.now()) / 1000)),
      remaining,
    };
  } catch (err) {
    // Network blip / Upstash outage shouldn't lock users out of the app.
    // Log and fail-open. Sentry will pick this up if it's configured.
    console.error("[rate-limit] check failed, failing open:", err);
    return { ok: true, retryAfter: 0, remaining: Infinity };
  }
}
