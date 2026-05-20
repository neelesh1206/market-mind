import { Redis } from "@upstash/redis";

/**
 * Ticker search + validation for the stock-request feature.
 *
 * Architecture (restored 2026-05-20 — see ADR 0018's "Reversed" amendment):
 *
 *   1. `searchTickers(query)` — backs the autocomplete dropdown. Hits
 *      Finnhub's `/search?q=` which only returns active US-listed equities
 *      (auto-filters OTC junk + delisted tickers). Results cached in
 *      Upstash for 1 hour so a popular query "AAP" doesn't burn quota on
 *      every keystroke from every user.
 *
 *   2. `validateTickerForRequest(ticker)` — pre-submit gate. Confirms the
 *      ticker is real, listed on a US exchange, AND has market cap >=
 *      MIN_MARKET_CAP_USD (currently $2B — approximately the dividing
 *      line at rank ~1800 in US equities, aligning with the "top ~2000
 *      by market cap" universe restriction).
 *
 * The 5-per-week request cap (enforced in `submit_stock_request` RPC)
 * structurally limits how much this call pattern can grow — at 30 active
 * users × 5 requests/week, total Finnhub additions are ~250-400/week,
 * well under the 60/min quota. We previously experimented with a
 * pre-loaded eligibility table but rolled it back because the operational
 * burden (refresh cron, seed file, etc.) was disproportionate.
 *
 * Both endpoints fail gracefully — if Finnhub is down we return an empty
 * search (UI shows "couldn't search — try again") rather than a crash.
 * Validation returns a tagged-result type so the server action can map
 * each failure mode to specific user-facing copy.
 */

const FINNHUB_BASE = "https://finnhub.io/api/v1";
const FINNHUB_KEY = process.env.FINNHUB_API_KEY;

/** $2B threshold — corresponds roughly to top-2000 by US market cap.
 *  Configurable so the threshold can be tuned without a code change. */
const MIN_MARKET_CAP_USD = Number(process.env.STOCK_REQUEST_MIN_MARKET_CAP_USD ?? 2_000_000_000);

/** Cache TTL for search queries — popular queries amortize across users. */
const SEARCH_CACHE_TTL_SECONDS = 60 * 60; // 1h
/** Cache TTL for profile2 lookups — market cap doesn't move minute-to-minute. */
const PROFILE_CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
let redis: Redis | null = null;
if (REDIS_URL && REDIS_TOKEN) {
  redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
}

export type TickerSearchResult = {
  ticker: string;        // normalized, upper-case
  displayName: string;   // company name for the dropdown row
  exchange: string;      // "NASDAQ", "NYSE", etc. — sometimes empty
};

/**
 * Autocomplete search. Returns empty list on any failure (UI handles).
 * Query must be ≥ 1 char; we don't fan out for the empty case.
 */
export async function searchTickers(query: string): Promise<TickerSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  if (!FINNHUB_KEY) {
    console.warn("[ticker-search] FINNHUB_API_KEY not set — search disabled");
    return [];
  }

  const cacheKey = `mm:tsearch:${q.toLowerCase()}`;
  if (redis) {
    try {
      const cached = await redis.get<TickerSearchResult[]>(cacheKey);
      if (cached) return cached;
    } catch (err) {
      console.warn("[ticker-search] redis read failed, falling through:", err);
    }
  }

  // Finnhub's free /search endpoint:
  //   https://finnhub.io/docs/api/symbol-search
  // Returns { count: N, result: [{ description, displaySymbol, symbol, type }, ...] }
  // We filter to type='Common Stock' to drop ETFs, warrants, preferred shares —
  // those aren't in the spirit of the request feature.
  let results: TickerSearchResult[] = [];
  try {
    const url = `${FINNHUB_BASE}/search?q=${encodeURIComponent(q)}&exchange=US&token=${FINNHUB_KEY}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2_500);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = (await res.json()) as {
        count?: number;
        result?: Array<{
          description?: string;
          displaySymbol?: string;
          symbol?: string;
          type?: string;
        }>;
      };
      results = (data.result ?? [])
        .filter((r) => r.type === "Common Stock" && r.symbol && r.description)
        // Drop tickers with dots in the displaySymbol that are foreign listings
        // (e.g. "AAPL.DE" — Apple's Frankfurt ADR — would show up because
        // Finnhub doesn't perfectly scope by exchange).
        .filter((r) => !r.symbol!.includes(".") || /^[A-Z]+\.[A-Z]$/.test(r.symbol!))
        .slice(0, 15) // cap dropdown size; UI shouldn't ever need more
        .map((r) => ({
          ticker: r.symbol!.toUpperCase(),
          displayName: r.description!,
          exchange: r.displaySymbol ?? "",
        }));
    } else {
      console.warn(`[ticker-search] finnhub /search returned ${res.status}`);
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      console.warn("[ticker-search] finnhub /search threw:", err);
    }
  }

  if (redis && results.length > 0) {
    try {
      await redis.set(cacheKey, results, { ex: SEARCH_CACHE_TTL_SECONDS });
    } catch {
      // cache write failure is non-fatal
    }
  }
  return results;
}

/**
 * Validation outcome for a ticker the user wants to request.
 */
export type TickerValidation =
  | {
      ok: true;
      ticker: string;
      companyName: string;
      marketCapUsd: number;
    }
  | { ok: false; reason: "invalid_ticker" }
  | { ok: false; reason: "not_us_listed" }
  | { ok: false; reason: "market_cap_too_low"; marketCapUsd: number; threshold: number }
  | { ok: false; reason: "profile_unavailable" };

/**
 * Pre-submit validation. Hits Finnhub `/stock/profile2?symbol=X`, confirms:
 *   - the response is non-empty (ticker resolves)
 *   - exchange is US-listed (NASDAQ NMS, NYSE, etc.)
 *   - market cap (in MILLIONS per Finnhub's convention, converted here) is
 *     above MIN_MARKET_CAP_USD
 *
 * Already-in-universe check belongs in the server action (it queries
 * Supabase, this file doesn't); we focus on Finnhub-side concerns here.
 */
export async function validateTickerForRequest(
  rawTicker: string,
): Promise<TickerValidation> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker || !/^[A-Z][A-Z0-9.\-]{0,7}$/.test(ticker)) {
    return { ok: false, reason: "invalid_ticker" };
  }
  if (!FINNHUB_KEY) {
    return { ok: false, reason: "profile_unavailable" };
  }

  const cacheKey = `mm:tprofile:${ticker}`;
  type Profile = {
    name?: string;
    ticker?: string;
    exchange?: string;
    marketCapitalization?: number; // millions USD per Finnhub
    country?: string;
  };

  let profile: Profile | null = null;
  if (redis) {
    try {
      const cached = await redis.get<Profile>(cacheKey);
      if (cached) profile = cached;
    } catch {
      // ignore
    }
  }

  if (!profile) {
    try {
      const url = `${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2_500);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) {
        console.warn(`[ticker-search] finnhub /profile2 ${ticker} returned ${res.status}`);
        return { ok: false, reason: "profile_unavailable" };
      }
      profile = (await res.json()) as Profile;
      if (redis) {
        try {
          await redis.set(cacheKey, profile, { ex: PROFILE_CACHE_TTL_SECONDS });
        } catch {
          // cache write failure non-fatal
        }
      }
    } catch (err) {
      console.warn("[ticker-search] /profile2 threw:", err);
      return { ok: false, reason: "profile_unavailable" };
    }
  }

  if (!profile || !profile.ticker || !profile.name) {
    return { ok: false, reason: "invalid_ticker" };
  }

  const isUsListed =
    profile.country === "US" ||
    (profile.exchange ?? "").toUpperCase().includes("NASDAQ") ||
    (profile.exchange ?? "").toUpperCase().includes("NYSE");
  if (!isUsListed) {
    return { ok: false, reason: "not_us_listed" };
  }

  const marketCapUsd = Math.round(((profile.marketCapitalization ?? 0)) * 1_000_000);
  if (marketCapUsd < MIN_MARKET_CAP_USD) {
    return {
      ok: false,
      reason: "market_cap_too_low",
      marketCapUsd,
      threshold: MIN_MARKET_CAP_USD,
    };
  }

  return {
    ok: true,
    ticker,
    companyName: profile.name,
    marketCapUsd,
  };
}
