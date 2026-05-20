import { Redis } from "@upstash/redis";

/**
 * Live-price layer for the home feed + stock detail page.
 *
 * **Why a shared Redis cache instead of `unstable_cache`:** Vercel runs each
 * request on potentially a different function instance with its own
 * `unstable_cache` store. With 50 stocks × N instances we'd blow through
 * Polygon's free-tier 5/min quota the moment traffic picks up. Upstash gives
 * us one global cache that every function instance reads from — Polygon sees
 * AT MOST `(stocks / 60s) * cache_ttl_minutes` calls, regardless of how
 * many users are browsing. With our 5-minute TTL on 50 stocks, that's
 * worst-case 10 calls/minute spread across the universe.
 *
 * **Graceful degradation paths:**
 *   1. No Upstash creds → fetch direct from Polygon every time (works, slow)
 *   2. No Polygon key → return all nulls (callers must tolerate)
 *   3. Polygon 429/timeout for a ticker → cache the null briefly so we don't
 *      hammer a failing endpoint; UI shows "—" gracefully
 *   4. Redis network blip → fall through to direct Polygon (fail-open)
 *
 * Pricing intent: free-tier Polygon delivers 15-min delayed quotes; that's
 * fine for the at-a-glance "is this stock up or down today" surface. The
 * UI labels prices as "Delayed ~15min" so users don't expect tick-by-tick.
 */

const POLYGON_BASE = "https://api.polygon.io";

/** Cache TTL — 5 minutes balances staleness vs Polygon quota. */
const CACHE_TTL_SECONDS = 300;

/** Short TTL on "tried Polygon, got null" so we don't hammer a failing ticker. */
const NEGATIVE_CACHE_TTL_SECONDS = 60;

/** Per-fetch timeout — page render shouldn't wait long on Polygon. */
const POLYGON_TIMEOUT_MS = 2_000;

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
let redis: Redis | null = null;
if (REDIS_URL && REDIS_TOKEN) {
  redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
}

/**
 * What we render per ticker. `null` price means we tried and failed — render
 * a placeholder, don't crash.
 */
export type LivePrice = {
  ticker: string;
  /** Last trade price in USD, or null when unavailable. */
  price: number | null;
  /** Day-over-prior-close percent change, or null when unavailable. */
  changePct: number | null;
  /** Unix ms when this snapshot was fetched (or pulled from cache). */
  fetchedAt: number;
  /** True if the value came from the Redis cache, false if direct from Polygon. */
  fromCache: boolean;
};

/** Cache-row schema. Kept as a typed wrapper so format bumps are obvious. */
type CachedPrice = {
  v: 1; // schema version — bump if shape changes, old rows become misses
  price: number | null;
  changePct: number | null;
  fetchedAt: number;
};

function cacheKey(ticker: string): string {
  return `mm:price:${ticker.toUpperCase()}`;
}

/**
 * Convert dotted class-share ticker (BRK.B) to the dash form Polygon
 * expects (BRK-B). Mirrors the same normalize step the Python pipeline
 * uses for Yahoo/SEC — Polygon shares the convention. Idempotent.
 */
function toPolygonSymbol(ticker: string): string {
  return ticker.toUpperCase().replaceAll(".", "-");
}

/**
 * Single-ticker fetch from Polygon's snapshot endpoint. Returns null when:
 *   - no API key configured
 *   - request times out (>2s)
 *   - Polygon returns non-2xx
 *   - response shape doesn't contain a finite number
 *
 * Doesn't throw — the caller treats null as "fetch failed, cache briefly".
 */
async function fetchSnapshot(ticker: string): Promise<{
  price: number | null;
  changePct: number | null;
} | null> {
  const apiKey = process.env.MASSIVE_API_KEY;
  if (!apiKey) return null;

  const symbol = toPolygonSymbol(ticker);
  const url =
    `${POLYGON_BASE}/v3/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(symbol)}` +
    `?apiKey=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POLYGON_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // No Next caching here — Upstash IS our cache layer.
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) {
      // 403 = ticker not on plan, 404 = unknown, 429 = rate-limited, 5xx = upstream
      console.warn(`[live-prices] ${symbol}: ${res.status} ${res.statusText}`);
      return { price: null, changePct: null };
    }
    const payload = (await res.json()) as {
      ticker?: {
        lastTrade?: { p?: number };
        min?: { c?: number };
        day?: { c?: number };
        prevDay?: { c?: number };
        todaysChangePerc?: number;
      };
    };

    const t = payload.ticker;
    // Prefer last trade for current price; fall back to minute-bar close,
    // then day close — covers extended-hours, regular session, and EOD.
    const rawPrice = t?.lastTrade?.p ?? t?.min?.c ?? t?.day?.c ?? null;
    const price =
      typeof rawPrice === "number" && Number.isFinite(rawPrice) ? rawPrice : null;

    // todaysChangePerc covers the common case. If absent, derive from
    // current vs prevDay.c so we still show *something* useful.
    let changePct: number | null = null;
    if (typeof t?.todaysChangePerc === "number" && Number.isFinite(t.todaysChangePerc)) {
      changePct = t.todaysChangePerc;
    } else if (
      price != null &&
      typeof t?.prevDay?.c === "number" &&
      Number.isFinite(t.prevDay.c) &&
      t.prevDay.c > 0
    ) {
      changePct = ((price - t.prevDay.c) / t.prevDay.c) * 100;
    }

    return { price, changePct };
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[live-prices] ${symbol}: fetch failed`, err);
    return { price: null, changePct: null };
  }
}

/**
 * Fetch live prices for a list of tickers. Returns a Map keyed by the
 * INPUT ticker (preserves dotted form for callers joining back to the DB).
 *
 * Cache strategy:
 *   1. MGET all tickers' cache keys in one round-trip to Redis
 *   2. For misses, fetch from Polygon in parallel (Promise.allSettled —
 *      one ticker failing doesn't break the page)
 *   3. Write fresh fetches back to Redis with TTL (5min positive, 1min
 *      negative so a failing ticker doesn't get a 5-min black mark)
 *
 * Empty `tickers` short-circuits — common case on the logged-out home page
 * before the user has built their watchlist.
 */
export async function getLivePrices(tickers: string[]): Promise<Map<string, LivePrice>> {
  const result = new Map<string, LivePrice>();
  if (tickers.length === 0) return result;

  // Dedupe — caller may pass the same ticker multiple times; we only want
  // one Polygon call per unique symbol.
  const unique = Array.from(new Set(tickers.map((t) => t.toUpperCase())));

  // --- Step 1: read all cached values in one MGET. ---
  const cached: Array<CachedPrice | null> = redis
    ? await safeMget(unique.map((t) => cacheKey(t)))
    : unique.map(() => null);

  // --- Step 2: identify misses and refresh them in parallel. ---
  const misses: string[] = [];
  for (let i = 0; i < unique.length; i++) {
    const ticker = unique[i]!;
    const hit = cached[i];
    if (hit && hit.v === 1) {
      result.set(ticker, {
        ticker,
        price: hit.price,
        changePct: hit.changePct,
        fetchedAt: hit.fetchedAt,
        fromCache: true,
      });
    } else {
      misses.push(ticker);
    }
  }

  if (misses.length > 0) {
    const fetched = await Promise.allSettled(misses.map((t) => fetchSnapshot(t)));
    const now = Date.now();
    // Single pipeline write so N misses → 1 round-trip back to Redis.
    const writes: Array<{ key: string; value: CachedPrice; ttl: number }> = [];

    for (let i = 0; i < misses.length; i++) {
      const ticker = misses[i]!;
      const settled = fetched[i]!;
      const snap = settled.status === "fulfilled" ? settled.value : null;

      const price = snap?.price ?? null;
      const changePct = snap?.changePct ?? null;
      const row: CachedPrice = { v: 1, price, changePct, fetchedAt: now };

      result.set(ticker, {
        ticker,
        price,
        changePct,
        fetchedAt: now,
        fromCache: false,
      });

      // Cache failures briefly so we don't hammer a degraded ticker, but
      // give successful fetches the full 5-minute TTL.
      writes.push({
        key: cacheKey(ticker),
        value: row,
        ttl: price == null ? NEGATIVE_CACHE_TTL_SECONDS : CACHE_TTL_SECONDS,
      });
    }

    if (redis && writes.length > 0) {
      // Fire-and-forget — even if cache write fails the response is already
      // built. We `void` it so any rejection doesn't propagate as unhandled.
      void Promise.all(
        writes.map((w) =>
          redis!.set(w.key, w.value as unknown as Record<string, unknown>, { ex: w.ttl }),
        ),
      ).catch((err) => {
        console.warn("[live-prices] cache write failed:", err);
      });
    }
  }

  // --- Step 3: re-key the result by the input ticker shape (preserves "BRK.B"). ---
  const inputKeyed = new Map<string, LivePrice>();
  for (const original of tickers) {
    const upper = original.toUpperCase();
    const live = result.get(upper);
    if (live) {
      inputKeyed.set(original, { ...live, ticker: original });
    }
  }
  return inputKeyed;
}

/** MGET wrapper that swallows Redis errors and returns all nulls on failure. */
async function safeMget(keys: string[]): Promise<Array<CachedPrice | null>> {
  if (!redis || keys.length === 0) return keys.map(() => null);
  try {
    // @upstash/redis decodes JSON automatically — values come back typed.
    const rows = await redis.mget<Array<CachedPrice | null>>(...keys);
    return rows.map((r) => (r && (r as CachedPrice).v === 1 ? (r as CachedPrice) : null));
  } catch (err) {
    console.warn("[live-prices] MGET failed, falling through to Polygon:", err);
    return keys.map(() => null);
  }
}

/**
 * Convenience for the stock detail page — single ticker, same caching path.
 */
export async function getLivePrice(ticker: string): Promise<LivePrice | null> {
  const m = await getLivePrices([ticker]);
  return m.get(ticker) ?? null;
}
