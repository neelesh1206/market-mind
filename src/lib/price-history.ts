/**
 * Daily-bar price history for the stock detail sparkline.
 *
 * Fetches from Massive's `/v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}`
 * REST endpoint — same source the Python pipeline uses for technical
 * signals. Server-side only: reads `MASSIVE_API_KEY` from the process env
 * (never exposed to the client).
 *
 * Caching: Next's `fetch` cache with `revalidate: 3600`. Daily bars only
 * change once per trading day after market close, so hourly is plenty;
 * shared across all requests for a given ticker until the cache expires.
 *
 * Failure mode: returns `[]` on any error (missing key, 429, network, parse).
 * Never throws. The detail page already has a graceful empty state.
 */

const BASE_URL = "https://api.polygon.io"; // Massive still serves from the Polygon domain.

export type PriceBar = {
  /** ISO date `YYYY-MM-DD` in UTC — calendar date of the close. */
  date: string;
  /** Adjusted closing price. */
  close: number;
};

type MassiveAggsResponse = {
  results?: { t: number; c: number }[];
};

/**
 * Returns up to `days` most-recent daily bars in ascending order. We over-fetch
 * by ~50% to account for weekends + market holidays inside the window, then
 * trim back to `days`.
 */
export async function fetchDailyBars(ticker: string, days = 30): Promise<PriceBar[]> {
  const apiKey = process.env.MASSIVE_API_KEY;
  if (!apiKey) return [];

  // Calendar window: today back ~1.5× requested days so weekends/holidays
  // don't shortchange the chart.
  const lookbackDays = Math.ceil(days * 1.5);
  const to = new Date();
  const from = new Date(to.getTime() - lookbackDays * 86_400_000);
  const fromIso = isoDate(from);
  const toIso = isoDate(to);

  const upper = ticker.toUpperCase();
  const url =
    `${BASE_URL}/v2/aggs/ticker/${encodeURIComponent(upper)}/range/1/day/${fromIso}/${toIso}` +
    `?adjusted=true&sort=asc&apiKey=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, {
      // Hourly cache. Daily bars only mint at close.
      next: { revalidate: 3600, tags: [`price-history:${upper}`] },
    });
    if (!res.ok) {
      console.warn(`[price-history] ${upper}: ${res.status} ${res.statusText}`);
      return [];
    }
    const payload = (await res.json()) as MassiveAggsResponse;
    const results = payload.results ?? [];

    const bars: PriceBar[] = results.map((r) => ({
      date: isoDate(new Date(r.t)),
      close: r.c,
    }));

    // Trim to the most-recent `days` bars in case the window over-shot.
    return bars.slice(-days);
  } catch (err) {
    console.warn(`[price-history] ${upper}: fetch failed`, err);
    return [];
  }
}

function isoDate(d: Date): string {
  // YYYY-MM-DD in UTC — Massive accepts this format and trading-day calendar
  // is in ET anyway, so UTC date works (we're not slicing intraday).
  return d.toISOString().slice(0, 10);
}

/**
 * Last-traded price for a single ticker, used by placeBet to capture the
 * "price at placement" alongside the prediction. Massive Starter tier
 * delivers ~15-min delayed quotes, which is fine — this is the price the
 * user saw when committing, not a real-time anchor.
 *
 * Hits Massive's snapshot endpoint. Returns null on any failure (missing
 * key, 429, parse error, timeout) — the caller treats null as "fetch
 * failed, store NULL in the column, ship the bet anyway."
 *
 * Capped at 1.5s with AbortSignal so a slow Massive response can't keep the
 * user staring at the place-bet spinner for 10s.
 */
export async function fetchLivePrice(ticker: string): Promise<number | null> {
  const apiKey = process.env.MASSIVE_API_KEY;
  if (!apiKey) return null;

  const upper = ticker.toUpperCase();
  const url =
    `${BASE_URL}/v3/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(upper)}` +
    `?apiKey=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // No revalidate — we want the live snapshot, not a cached one.
      cache: "no-store",
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn(`[live-price] ${upper}: ${res.status} ${res.statusText}`);
      return null;
    }
    const payload = (await res.json()) as {
      ticker?: { lastTrade?: { p?: number }; min?: { c?: number }; day?: { c?: number } };
    };
    // Prefer last trade price; fall back to current minute close, then day close.
    const price =
      payload.ticker?.lastTrade?.p ??
      payload.ticker?.min?.c ??
      payload.ticker?.day?.c ??
      null;
    return typeof price === "number" && Number.isFinite(price) ? price : null;
  } catch (err) {
    clearTimeout(timeout);
    console.warn(`[live-price] ${upper}: fetch failed`, err);
    return null;
  }
}
