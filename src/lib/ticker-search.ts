import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Ticker search + validation, backed by `universe_eligible_stocks`
 * (Postgres). See ADR 0018's 2026-05-20 amendment for the rationale —
 * short version: search is multi-attribute filtering with relevance
 * scoring, which is what indexed SQL is for. Pre-loading the universe
 * weekly isolates Finnhub from the request-handling path entirely.
 *
 * Previous implementation called Finnhub `/search` + `/profile2` per
 * request with a Redis cache layer. Now the table is the cache; the
 * Redis layer is gone for search (still used for live prices + rate
 * limits, which have different access patterns).
 */

/** $2B threshold matches what the refresh pipeline filters on. Exposed
 *  for UI copy ("we restrict to top ~2000 by market cap"). */
export const MIN_MARKET_CAP_USD = Number(
  process.env.STOCK_REQUEST_MIN_MARKET_CAP_USD ?? 2_000_000_000,
);

export type TickerSearchResult = {
  ticker: string;        // primary key, upper-case
  displayName: string;   // company name
  exchange: string;      // NASDAQ / NYSE / etc.
};

/**
 * Autocomplete search across the eligible universe.
 *
 * Ranking (lower index = better match):
 *   0 — ticker exactly equals the query (case-insensitive)
 *   1 — ticker starts with the query
 *   2 — company name contains the query
 *
 * Ties broken by market cap descending — so among "Bank of" matches, the
 * largest bank surfaces first. Limit 15 — that's the dropdown's max.
 *
 * Empty/whitespace query returns []. Caller (UI) should debounce before
 * calling so we don't fire on every keystroke.
 */
export async function searchTickers(
  client: SupabaseClient,
  query: string,
): Promise<TickerSearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  // Supabase's PostgREST doesn't expose CASE WHEN in `order`, so we can't
  // do the relevance-tiered sort purely in the query API. We instead use
  // an .or() filter to fetch matches, then re-rank in code. With limit
  // 50 from the DB and ~2000 rows in the table, this is cheap.
  //
  // `ilike` patterns:
  //   ticker.ilike.X%       → starts with (uses ticker_pattern_ops index)
  //   company_name.ilike.%X% → contains (uses lower(company_name) index
  //                            on case-insensitive match)
  const pattern = q.replace(/[%_]/g, ""); // strip wildcards; we control them

  const { data, error } = await client
    .from("universe_eligible_stocks")
    .select("ticker, company_name, exchange, market_cap_usd")
    .or(`ticker.ilike.${pattern}%,company_name.ilike.%${pattern}%`)
    .order("market_cap_usd", { ascending: false })
    .limit(50);

  if (error) {
    console.warn(`[ticker-search] searchTickers failed: ${error.message}`);
    return [];
  }

  type Row = {
    ticker: string;
    company_name: string;
    exchange: string | null;
    market_cap_usd: number;
  };
  const rows = (data ?? []) as Row[];
  const upper = q.toUpperCase();
  const lower = q.toLowerCase();

  // Re-rank with the relevance tiers; market cap desc breaks ties.
  const ranked = rows
    .map((r) => {
      const upperTicker = r.ticker.toUpperCase();
      let tier: number;
      if (upperTicker === upper) tier = 0;
      else if (upperTicker.startsWith(upper)) tier = 1;
      else if (r.company_name.toLowerCase().includes(lower)) tier = 2;
      else tier = 3;
      return { row: r, tier };
    })
    // Drop rows that didn't match either predicate (shouldn't happen given
    // the .or() filter, but defensive).
    .filter((x) => x.tier <= 2)
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return b.row.market_cap_usd - a.row.market_cap_usd;
    })
    .slice(0, 15)
    .map(({ row }) => ({
      ticker: row.ticker,
      displayName: row.company_name,
      exchange: row.exchange ?? "",
    }));

  return ranked;
}

/**
 * Validation outcome — same shape as before so the server-action call
 * site doesn't change. The reasons collapse since we're no longer going
 * to Finnhub:
 *
 *   ok             - row found in universe_eligible_stocks
 *   not_eligible   - covers all old "invalid_ticker / not_us_listed /
 *                    market_cap_too_low" cases. The user copy folds them
 *                    into one message because we can't distinguish (we
 *                    don't know WHY a ticker isn't in the table — it
 *                    could be any of the prior reasons).
 *   profile_unavailable - kept for forward compatibility if we ever
 *                    fall back to Finnhub on a cache miss.
 */
export type TickerValidation =
  | {
      ok: true;
      ticker: string;
      companyName: string;
      marketCapUsd: number;
    }
  | { ok: false; reason: "not_eligible" }
  | { ok: false; reason: "profile_unavailable" };

/**
 * Validate a ticker against the eligibility table. No network calls;
 * pure indexed Postgres lookup.
 */
export async function validateTickerForRequest(
  client: SupabaseClient,
  rawTicker: string,
): Promise<TickerValidation> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, reason: "not_eligible" };
  }

  const { data, error } = await client
    .from("universe_eligible_stocks")
    .select("ticker, company_name, market_cap_usd")
    .eq("ticker", ticker)
    .maybeSingle();

  if (error) {
    console.warn(`[ticker-search] validateTicker failed: ${error.message}`);
    return { ok: false, reason: "profile_unavailable" };
  }
  if (!data) {
    return { ok: false, reason: "not_eligible" };
  }
  return {
    ok: true,
    ticker: data.ticker,
    companyName: data.company_name,
    marketCapUsd: data.market_cap_usd,
  };
}
