"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import {
  searchTickers,
  validateTickerForRequest,
  type TickerSearchResult,
} from "@/lib/ticker-search";

// =============================================================================
// Submit a stock request.
// =============================================================================

export type SubmitRequestResult =
  | {
      ok: true;
      ticker: string;
      companyName: string;
      marketCapUsd: number;
    }
  | { ok: false; error: string };

/**
 * Validate + submit a stock request.
 *
 * Validation chain (in order; first failure short-circuits):
 *   1. Auth — caller must be signed in
 *   2. Rate limit — 10/min per user
 *   3. Finnhub validation — ticker exists, US-listed, market cap >= threshold
 *   4. Already in universe — reject if the ticker is currently active in `stocks`
 *   5. RPC — idempotent upsert on (user_id, ticker)
 *
 * Returns a tagged-result so the client can surface the specific failure
 * mode (market cap too low needs different copy than "not a real ticker").
 */
export async function submitStockRequest(
  rawTicker: string,
): Promise<SubmitRequestResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Sign in to request a stock." };
  }

  const rl = await rateLimit("submitStockRequest", user.id);
  if (!rl.ok) {
    return { ok: false, error: `Slow down — try again in ${rl.retryAfter}s.` };
  }

  // Step 1: Finnhub validation (network call, takes ~250ms)
  const validation = await validateTickerForRequest(rawTicker);
  if (!validation.ok) {
    switch (validation.reason) {
      case "invalid_ticker":
        return { ok: false, error: "Couldn't find that ticker on a US exchange." };
      case "not_us_listed":
        return { ok: false, error: "MarketMind only covers US-listed equities." };
      case "market_cap_too_low": {
        const billionUsd = (validation.threshold / 1_000_000_000).toFixed(0);
        return {
          ok: false,
          error: `Below our market-cap threshold (we accept ≥ $${billionUsd}B). This keeps the request list focused on liquid, broadly-followed names.`,
        };
      }
      case "profile_unavailable":
        return { ok: false, error: "Couldn't reach our data provider. Try again in a moment." };
    }
  }

  // Step 2: already-in-universe check (Supabase round-trip)
  const { data: existing } = await supabase
    .from("stocks")
    .select("ticker")
    .ilike("ticker", validation.ticker)
    .eq("is_active", true)
    .maybeSingle();
  if (existing) {
    return {
      ok: false,
      error: `${validation.ticker} is already in MarketMind's universe.`,
    };
  }

  // Step 3: idempotent RPC upsert
  const { error: rpcErr } = await supabase.rpc("submit_stock_request", {
    p_ticker: validation.ticker,
    p_company_name: validation.companyName,
    p_market_cap: validation.marketCapUsd,
  });
  if (rpcErr) {
    console.error("[stock-requests] submit_stock_request failed:", rpcErr);
    if (rpcErr.message.includes("already_in_universe")) {
      return { ok: false, error: `${validation.ticker} is already in MarketMind's universe.` };
    }
    if (
      rpcErr.code === "PGRST202" ||
      (rpcErr.message.includes("function") && rpcErr.message.includes("does not exist"))
    ) {
      return { ok: false, error: "Stock requests aren't enabled on the server yet (migration pending)." };
    }
    return { ok: false, error: "Couldn't save the request. Try again?" };
  }

  revalidatePath("/requests");
  return {
    ok: true,
    ticker: validation.ticker,
    companyName: validation.companyName,
    marketCapUsd: validation.marketCapUsd,
  };
}

// =============================================================================
// Remove a previously-cast vote.
// =============================================================================

export type RemoveRequestResult = { ok: true } | { ok: false; error: string };

export async function removeStockRequest(
  rawTicker: string,
): Promise<RemoveRequestResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const rl = await rateLimit("submitStockRequest", user.id);
  if (!rl.ok) {
    return { ok: false, error: `Slow down — try again in ${rl.retryAfter}s.` };
  }

  const { error } = await supabase.rpc("remove_stock_request", {
    p_ticker: rawTicker.trim().toUpperCase(),
  });
  if (error) {
    console.error("[stock-requests] remove_stock_request failed:", error);
    return { ok: false, error: "Couldn't remove the vote. Try again?" };
  }
  revalidatePath("/requests");
  return { ok: true };
}

// =============================================================================
// Search action — wraps the lib helper so it can be invoked from a client
// component. The lib helper itself doesn't have "use server" so we can't call
// it directly from the browser; this is the thin RPC layer.
// =============================================================================

export async function searchTickersAction(
  query: string,
): Promise<TickerSearchResult[]> {
  // Search is read-only and idempotent; no auth gate. Anyone can use the
  // autocomplete. The submit endpoint requires auth + does the heavy lifting.
  return searchTickers(query);
}
