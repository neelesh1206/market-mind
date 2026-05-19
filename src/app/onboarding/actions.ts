"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { setUserWatchlist, WATCHLIST_MAX, WATCHLIST_MIN } from "@/lib/watchlist";

export type SaveWatchlistResult = { ok: true } | { ok: false; error: string };

/**
 * Server action — commits the user's onboarding stock picks to user_watchlist.
 * Redirects to "/" on success (intentionally not returned — never reached).
 */
export async function saveWatchlist(stockIds: string[]): Promise<SaveWatchlistResult> {
  if (!Array.isArray(stockIds)) {
    return { ok: false, error: "Invalid selection" };
  }
  if (stockIds.length < WATCHLIST_MIN) {
    return { ok: false, error: `Pick at least ${WATCHLIST_MIN} stocks` };
  }
  if (stockIds.length > WATCHLIST_MAX) {
    return { ok: false, error: `Pick at most ${WATCHLIST_MAX} stocks` };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return { ok: false, error: "Not authenticated" };
  }

  try {
    await setUserWatchlist(supabase, user.id, stockIds);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }

  redirect("/");
}
