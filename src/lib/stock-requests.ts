import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Soft + hard weekly limit on unique-ticker requests per user.
 *
 * Canonical source of truth — also enforced in the `submit_stock_request`
 * RPC (server-side authority). UI surfaces "X of 5 used" via this constant.
 *
 * Lives in `src/lib/` (not `src/app/actions/`) because constants can't be
 * exported from `"use server"` modules in Next.js — server-action files
 * are restricted to async-function exports only. Trying to export a `const`
 * from one breaks the Turbopack build with "Only async functions are
 * allowed to be exported in a "use server" file."
 */
export const WEEKLY_REQUEST_LIMIT = 5;

export type TopStockRequest = {
  ticker: string;
  companyName: string | null;
  voteCount: number;
  latestRequestAt: string; // ISO
};

/**
 * Public list of requested tickers sorted by vote count desc. Goes through
 * the SECURITY DEFINER `get_top_stock_requests` RPC so anon visitors can
 * see aggregates even though the per-user vote rows are RLS-protected.
 *
 * Defensive: returns empty list on any error (e.g., migration not applied).
 */
export async function fetchTopStockRequests(
  client: SupabaseClient,
  limit = 100,
): Promise<TopStockRequest[]> {
  const { data, error } = await client.rpc("get_top_stock_requests", {
    p_limit: limit,
  });

  if (error) {
    console.warn(
      `[stock-requests] get_top_stock_requests failed (likely migration not applied): ${error.message}`,
    );
    return [];
  }

  return ((data ?? []) as Array<{
    ticker: string;
    company_name: string | null;
    vote_count: number;
    latest_request_at: string;
  }>).map((row) => ({
    ticker: row.ticker,
    companyName: row.company_name,
    voteCount: row.vote_count,
    latestRequestAt: row.latest_request_at,
  }));
}

/**
 * How many unique-ticker requests the current user has made in the
 * last 7 days (rolling window). Used to drive the "X of 5 used" badge
 * on the request panel. Goes through the `get_user_weekly_request_count`
 * SECURITY DEFINER RPC, which infers the user from `auth.uid()`.
 *
 * Returns 0 on any error (e.g., migration not applied) so the UI keeps
 * working in a degraded state — the RPC's own enforcement is the
 * authoritative gate.
 */
export async function fetchUserWeeklyRequestCount(
  client: SupabaseClient,
): Promise<number> {
  const { data, error } = await client.rpc("get_user_weekly_request_count");
  if (error) {
    console.warn(
      `[stock-requests] get_user_weekly_request_count failed: ${error.message}`,
    );
    return 0;
  }
  return Number(data ?? 0);
}

/**
 * The tickers the current user has already voted for. Used to highlight
 * "your vote" in the UI and to show the toggle as already-pressed.
 *
 * Reads directly from stock_requests; RLS scopes to own rows so this is
 * safe to call with the user-session client.
 */
export async function fetchUserStockRequests(
  client: SupabaseClient,
  userId: string | null,
): Promise<Set<string>> {
  if (!userId) return new Set();
  const { data, error } = await client
    .from("stock_requests")
    .select("ticker")
    .eq("user_id", userId);
  if (error) {
    console.warn(`[stock-requests] fetchUserStockRequests failed: ${error.message}`);
    return new Set();
  }
  return new Set(((data ?? []) as Array<{ ticker: string }>).map((r) => r.ticker));
}
