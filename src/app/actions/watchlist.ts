"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { WATCHLIST_MAX } from "@/lib/watchlist";

export type WatchlistMutationResult =
  | { ok: true; watchlistCount: number }
  | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Add a single stock to the current user's watchlist. Enforces the
 * WATCHLIST_MAX cap server-side so a stale client tab can't push past 15.
 * Idempotent — adding an already-present stock is a no-op (unique violation
 * silently mapped to ok=true).
 */
export async function addToWatchlist(stockId: string): Promise<WatchlistMutationResult> {
  if (typeof stockId !== "string" || !UUID_RE.test(stockId)) {
    return { ok: false, error: "Invalid stock id" };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return { ok: false, error: "Not authenticated" };
  }

  // Check current count before inserting — cheap, avoids a race where two
  // tabs simultaneously add a 15th + 16th stock.
  const { count, error: countErr } = await supabase
    .from("user_watchlist")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (countErr) {
    return { ok: false, error: `Lookup failed: ${countErr.message}` };
  }
  if ((count ?? 0) >= WATCHLIST_MAX) {
    return { ok: false, error: `Watchlist limit (${WATCHLIST_MAX}) reached — remove one first` };
  }

  const { error } = await supabase
    .from("user_watchlist")
    .insert({ user_id: user.id, stock_id: stockId });

  if (error) {
    // Unique violation = already in watchlist → treat as success.
    if (error.code === "23505") {
      return { ok: true, watchlistCount: (count ?? 0) };
    }
    console.error("addToWatchlist failed", error);
    return { ok: false, error: "Couldn't add to watchlist" };
  }

  revalidatePath("/");
  revalidatePath("/stocks");
  return { ok: true, watchlistCount: (count ?? 0) + 1 };
}

/**
 * Remove a single stock from the current user's watchlist. Idempotent —
 * removing a not-present stock is a no-op.
 */
export async function removeFromWatchlist(stockId: string): Promise<WatchlistMutationResult> {
  if (typeof stockId !== "string" || !UUID_RE.test(stockId)) {
    return { ok: false, error: "Invalid stock id" };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return { ok: false, error: "Not authenticated" };
  }

  const { error } = await supabase
    .from("user_watchlist")
    .delete()
    .eq("user_id", user.id)
    .eq("stock_id", stockId);

  if (error) {
    console.error("removeFromWatchlist failed", error);
    return { ok: false, error: "Couldn't remove from watchlist" };
  }

  // Re-count for accurate UI feedback.
  const { count } = await supabase
    .from("user_watchlist")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  revalidatePath("/");
  revalidatePath("/stocks");
  return { ok: true, watchlistCount: count ?? 0 };
}
