"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { etCalendarDate } from "@/lib/market-schedule";

export type ClaimDailyBonusResult =
  | {
      ok: true;
      creditsAwarded: number;
      newBalance: number;
      newStreak: number;
      newLongest: number;
    }
  | { ok: false; error: string };

/**
 * Claim the daily login bonus. Wraps `claim_daily_bonus` Postgres RPC which
 * atomically: locks the profile, validates "not already claimed today",
 * computes streak + bonus, debits/credits, appends ledger row.
 *
 * Today's date is computed from `etCalendarDate()` so the per-day unit
 * matches the rest of the app (ET, not server-local).
 */
export async function claimDailyBonus(): Promise<ClaimDailyBonusResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return { ok: false, error: "Not authenticated" };
  }

  const today = etCalendarDate();

  const { data, error } = await supabase.rpc("claim_daily_bonus", {
    p_today_date: today,
  });

  if (error) {
    console.error("claimDailyBonus: rpc failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return { ok: false, error: mapBonusError(error) };
  }

  // RPC returns table — supabase-js wraps in an array.
  const row = (Array.isArray(data) ? data[0] : data) as
    | { credits_awarded: number; new_balance: number; new_streak: number; new_longest: number }
    | undefined;

  if (!row) {
    return { ok: false, error: "Bonus claimed but response was empty — refresh to confirm" };
  }

  revalidatePath("/");
  revalidatePath("/bets");

  return {
    ok: true,
    creditsAwarded: row.credits_awarded,
    newBalance: row.new_balance,
    newStreak: row.new_streak,
    newLongest: row.new_longest,
  };
}

type PgError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

function mapBonusError(err: PgError): string {
  const msg = err.message ?? "";
  if (err.code === "PGRST202" || /could not find the function|function .* does not exist/i.test(msg)) {
    return "Daily bonus isn't enabled on the server yet (migration pending)";
  }
  if (msg.includes("already_claimed_today")) return "Already claimed today — come back tomorrow";
  if (msg.includes("profile_missing")) return "Account not ready — refresh and retry";
  if (msg.includes("not_authenticated")) return "Not authenticated";
  return "Couldn't claim bonus — try again";
}
