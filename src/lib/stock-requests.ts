import type { SupabaseClient } from "@supabase/supabase-js";

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
