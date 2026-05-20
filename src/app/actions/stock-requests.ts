"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import {
  searchTickers,
  validateTickerForRequest,
  type TickerSearchResult,
} from "@/lib/ticker-search";

/** Soft limit — also enforced in the RPC. UI displays "X of 5 used". */
export const WEEKLY_REQUEST_LIMIT = 5;

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
 * Validate + submit a stock request. See ADR 0018 for the architecture.
 *
 * Validation chain:
 *   1. Auth — caller must be signed in
 *   2. Soft rate limit — 10 ops/min per user (Redis sliding window)
 *   3. Postgres validation — ticker is in `universe_eligible_stocks`
 *   4. RPC submit — enforces (a) ticker not in active universe, (b)
 *      ticker in eligibility table, (c) 5-unique-tickers-per-7d limit
 *      (only against genuinely NEW tickers; re-vote is exempt)
 *
 * Specific RPC errors are mapped to user copy here. The RPC raises with
 * named tags (`ticker_not_eligible`, `weekly_limit_reached`, etc.) so this
 * mapping is unambiguous.
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

  // Postgres-side validation. Fast — no network call.
  const validation = await validateTickerForRequest(supabase, rawTicker);
  if (!validation.ok) {
    if (validation.reason === "not_eligible") {
      return {
        ok: false,
        error: `${rawTicker.toUpperCase()} isn't in our eligibility list (top ~2000 US equities by market cap). The list refreshes weekly.`,
      };
    }
    return {
      ok: false,
      error: "Couldn't validate this ticker right now. Try again in a moment.",
    };
  }

  // Submit via RPC. The RPC re-validates eligibility, enforces the
  // already-in-universe guard, and enforces the weekly limit.
  const { error: rpcErr } = await supabase.rpc("submit_stock_request", {
    p_ticker: validation.ticker,
    p_company_name: validation.companyName,
    p_market_cap: validation.marketCapUsd,
  });

  if (rpcErr) {
    console.error("[stock-requests] submit_stock_request failed:", rpcErr);
    const msg = rpcErr.message.toLowerCase();
    if (msg.includes("already_in_universe")) {
      return {
        ok: false,
        error: `${validation.ticker} is already in MarketMind's universe.`,
      };
    }
    if (msg.includes("ticker_not_eligible")) {
      return {
        ok: false,
        error: `${validation.ticker} isn't in our eligibility list (top ~2000 US equities by market cap).`,
      };
    }
    if (msg.includes("weekly_limit_reached")) {
      return {
        ok: false,
        error: `You've used your ${WEEKLY_REQUEST_LIMIT} requests for this week. The oldest one ages out 7 days after you made it.`,
      };
    }
    if (
      rpcErr.code === "PGRST202" ||
      (msg.includes("function") && msg.includes("does not exist"))
    ) {
      return {
        ok: false,
        error: "Stock requests aren't enabled on the server yet (migration pending).",
      };
    }
    return { ok: false, error: "Couldn't save the request. Try again?" };
  }

  revalidatePath("/stocks");
  return {
    ok: true,
    ticker: validation.ticker,
    companyName: validation.companyName,
    marketCapUsd: validation.marketCapUsd,
  };
}

// =============================================================================
// Remove a previously-cast vote. Unchanged from prior implementation.
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
  revalidatePath("/stocks");
  return { ok: true };
}

// =============================================================================
// Search action — wraps the lib helper to be invokable from a client component.
// =============================================================================

export async function searchTickersAction(
  query: string,
): Promise<TickerSearchResult[]> {
  const supabase = await createClient();
  return searchTickers(supabase, query);
}
