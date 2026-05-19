"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMarketSchedule } from "@/lib/market-schedule";
import type { Prediction } from "@/lib/bets";

export type PlaceBetInput = {
  stockId: string;
  direction: "UP" | "DOWN";
  credits: number;
};

export type PlaceBetResult = { ok: true; prediction: Prediction } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Place a bet for the current user. Wraps the `place_bet` Postgres RPC, which
 * runs the entire (validate → insert → debit → ledger) sequence in one
 * transaction with a row lock on `user_profiles`.
 *
 * Server-side window gate: re-checks `MarketSchedule.betWindowOpen` here so a
 * stale client tab can't sneak a bet through after lock. The schedule helper
 * is also the source of truth for *which* trading day this bet is for
 * (passed to the RPC as `p_prediction_date`).
 */
export async function placeBet(input: PlaceBetInput): Promise<PlaceBetResult> {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Invalid request" };
  }
  if (typeof input.stockId !== "string" || !UUID_RE.test(input.stockId)) {
    return { ok: false, error: "Invalid stock" };
  }
  if (input.direction !== "UP" && input.direction !== "DOWN") {
    return { ok: false, error: "Pick a direction" };
  }
  if (
    typeof input.credits !== "number" ||
    !Number.isInteger(input.credits) ||
    input.credits < 50 ||
    input.credits > 500 ||
    input.credits % 50 !== 0
  ) {
    return { ok: false, error: "Stake must be 50–500 in steps of 50" };
  }

  const schedule = getMarketSchedule();
  if (!schedule.betWindowOpen) {
    return {
      ok: false,
      error: "Bet window is closed — try again when it reopens",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return { ok: false, error: "Not authenticated" };
  }

  const { data, error } = await supabase.rpc("place_bet", {
    p_stock_id: input.stockId,
    p_direction: input.direction,
    p_credits: input.credits,
    p_prediction_date: schedule.tradingDayLabel,
  });

  if (error) {
    console.error("placeBet: rpc failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return { ok: false, error: mapBetError(error) };
  }

  const prediction = (Array.isArray(data) ? data[0] : data) as Prediction | undefined;
  if (!prediction) {
    return { ok: false, error: "Bet placed but response was empty — refresh to confirm" };
  }

  revalidatePath("/");
  revalidatePath("/stock/[ticker]", "page");

  return { ok: true, prediction };
}

export type CancelBetResult = { ok: true } | { ok: false; error: string };

/**
 * Cancel an unresolved bet placed by the current user. Wraps `cancel_bet`
 * Postgres RPC which atomically deletes the prediction, refunds the stake,
 * decrements total_predictions, and appends a REFUND ledger row.
 *
 * Symmetric with placeBet: same `betWindowOpen` server-side gate so a tab
 * left open past 1 PM can't sneak a cancel through. After lock, the only
 * way out is the resolution job's WIN/LOSS/VOID call.
 */
export async function cancelBet(input: { predictionId: string }): Promise<CancelBetResult> {
  if (
    !input ||
    typeof input.predictionId !== "string" ||
    !UUID_RE.test(input.predictionId)
  ) {
    return { ok: false, error: "Invalid request" };
  }

  const schedule = getMarketSchedule();
  if (!schedule.betWindowOpen) {
    return {
      ok: false,
      error: "Bet window is locked — cancellation only allowed before 1 PM ET",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return { ok: false, error: "Not authenticated" };
  }

  const { error } = await supabase.rpc("cancel_bet", {
    p_prediction_id: input.predictionId,
  });

  if (error) {
    // Surface in server logs so unmapped failures aren't a black box.
    console.error("cancelBet: rpc failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return { ok: false, error: mapCancelError(error) };
  }

  revalidatePath("/");
  revalidatePath("/stock/[ticker]", "page");
  revalidatePath("/bets");

  return { ok: true };
}

type PgError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

function mapCancelError(err: PgError): string {
  const msg = err.message ?? "";
  // Function-missing — most likely the cancel_bet migration hasn't been
  // applied to prod yet. Tell the dev so they don't chase ghosts.
  if (err.code === "PGRST202" || /could not find the function|function .* does not exist/i.test(msg)) {
    return "Cancel isn't enabled on the server yet (migration pending)";
  }
  if (msg.includes("prediction_not_found")) return "That bet no longer exists";
  if (msg.includes("prediction_already_resolved")) return "Already resolved — too late to cancel";
  if (msg.includes("not_owner")) return "Not your bet";
  if (msg.includes("not_authenticated")) return "Not authenticated";
  return "Couldn't cancel bet — try again";
}

function mapBetError(err: PgError): string {
  if (err.code === "23505") {
    return "You've already bet on this stock today";
  }
  const msg = err.message ?? "";
  if (msg.includes("insufficient_credits")) return "Not enough credits for that stake";
  if (msg.includes("invalid_direction")) return "Pick a direction";
  if (msg.includes("invalid_credits")) return "Stake must be 50–500 in steps of 50";
  if (msg.includes("profile_missing")) return "Account not ready — refresh and retry";
  if (msg.includes("not_authenticated")) return "Not authenticated";
  return "Couldn't place bet — try again";
}
