import type { SupabaseClient } from "@supabase/supabase-js";

export type Stock = {
  id: string;
  ticker: string;
  name: string;
  sector: string;
  sub_sector: string | null;
  market_cap_tier: string | null;
};

/** Read all active stocks ordered by sector then ticker. Public read via RLS. */
export async function fetchAllStocks(client: SupabaseClient): Promise<Stock[]> {
  const { data, error } = await client
    .from("stocks")
    .select("id, ticker, name, sector, sub_sector, market_cap_tier")
    .eq("is_active", true)
    .order("sector")
    .order("ticker");

  if (error) {
    throw new Error(`fetchAllStocks: ${error.message}`);
  }
  return (data ?? []) as Stock[];
}

/** Read the current user's watchlist as full stock rows. Empty if no auth or no entries. */
export async function fetchUserWatchlist(client: SupabaseClient, userId: string): Promise<Stock[]> {
  const { data, error } = await client
    .from("user_watchlist")
    .select("stocks(id, ticker, name, sector, sub_sector, market_cap_tier)")
    .eq("user_id", userId);

  if (error) {
    throw new Error(`fetchUserWatchlist: ${error.message}`);
  }

  // PostgREST returns `{stocks: {...}}` rows because of the inner join.
  return (data ?? []).map((row) => row.stocks).filter(Boolean) as unknown as Stock[];
}

/**
 * Replace the user's watchlist with the given stock IDs.
 * Atomic in app sense: we DELETE then INSERT — RLS-scoped so safe.
 */
export async function setUserWatchlist(
  client: SupabaseClient,
  userId: string,
  stockIds: string[],
): Promise<void> {
  const { error: delErr } = await client.from("user_watchlist").delete().eq("user_id", userId);
  if (delErr) {
    throw new Error(`setUserWatchlist (delete): ${delErr.message}`);
  }

  if (stockIds.length === 0) return;

  const rows = stockIds.map((stock_id) => ({ user_id: userId, stock_id }));
  const { error: insErr } = await client.from("user_watchlist").insert(rows);
  if (insErr) {
    throw new Error(`setUserWatchlist (insert): ${insErr.message}`);
  }
}

export const WATCHLIST_MIN = 3;
export const WATCHLIST_MAX = 15;
