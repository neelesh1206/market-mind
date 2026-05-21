"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/service";
import { etCalendarDate } from "@/lib/market-schedule";
import { rateLimit } from "@/lib/rate-limit";
import { isAdminEmail } from "@/lib/admin";
import {
  CODE_PATTERN,
  DAILY_PROMO_CAP,
  fetchDailyPromoUsed,
  fetchRecentRedemptions,
  normalizeCode,
  type RecentRedemption,
  type RedeemError,
} from "@/lib/promo-codes";

// ============================================================================
// Lazy-load: dialog data
// ============================================================================

export type CreditsDialogData = {
  ok: true;
  dailyUsed: number;
  dailyRemaining: number;
  recent: RecentRedemption[];
} | {
  ok: false;
  error: string;
};

/**
 * Fetched when the user opens the credits dialog. Two reads: how much of
 * the daily cap they've used (for the counter) and their recent redemption
 * history (for the list). Anon users get an empty payload.
 */
export async function getCreditsDialogData(): Promise<CreditsDialogData> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: true, dailyUsed: 0, dailyRemaining: DAILY_PROMO_CAP, recent: [] };
  }

  const [dailyUsed, recent] = await Promise.all([
    fetchDailyPromoUsed(supabase, { userId: user.id, etDate: etCalendarDate() }),
    fetchRecentRedemptions(supabase, { userId: user.id, limit: 5 }),
  ]);
  return {
    ok: true,
    dailyUsed,
    dailyRemaining: Math.max(0, DAILY_PROMO_CAP - dailyUsed),
    recent,
  };
}

// ============================================================================
// User-facing: redeem
// ============================================================================

export type RedeemResult =
  | {
      ok: true;
      creditsAwarded: number;
      newBalance: number;
      dailyUsed: number;
      dailyRemaining: number;
    }
  | { ok: false; error: RedeemError };

/**
 * Redeem a promo code. Wraps the `redeem_promo_code` Postgres RPC which
 * runs atomically: validates the code, enforces daily cap, increments
 * balance, writes ledger + redemption rows.
 *
 * Error mapping is deliberately a bit terse — `not_found`, `inactive`, and
 * `invalid_format` all surface as "code isn't valid" in the UI so a
 * brute-forcer can't probe which codes exist.
 */
export async function redeemPromoCode(rawCode: string): Promise<RedeemResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return { ok: false, error: "not_authenticated" };
  }

  const code = normalizeCode(rawCode);
  if (!CODE_PATTERN.test(code)) {
    return { ok: false, error: "invalid_format" };
  }

  const rl = await rateLimit("redeemCode", user.id);
  if (!rl.ok) {
    return { ok: false, error: "rate_limited" };
  }

  const { data, error } = await supabase.rpc("redeem_promo_code", {
    p_code: code,
    p_today_date: etCalendarDate(),
  });

  if (error) {
    console.error("redeemPromoCode: rpc failed", {
      code: error.code,
      message: error.message,
      details: error.details,
    });
    return { ok: false, error: mapRedeemError(error) };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        credits_awarded: number;
        new_balance: number;
        daily_used: number;
        daily_remaining: number;
      }
    | undefined;

  if (!row) {
    return { ok: false, error: "unknown" };
  }

  // Refresh anywhere the balance is rendered.
  revalidatePath("/");
  revalidatePath("/bets");
  revalidatePath("/profile");

  return {
    ok: true,
    creditsAwarded: row.credits_awarded,
    newBalance: row.new_balance,
    dailyUsed: row.daily_used,
    dailyRemaining: row.daily_remaining,
  };
}

type PgError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

function mapRedeemError(err: PgError): RedeemError {
  const msg = err.message ?? "";
  if (err.code === "PGRST202" || /could not find the function|function .* does not exist/i.test(msg)) {
    return "unknown"; // migration pending
  }
  if (msg.includes("not_authenticated")) return "not_authenticated";
  if (msg.includes("not_found")) return "not_found";
  if (msg.includes("inactive")) return "inactive";
  if (msg.includes("expired")) return "expired";
  if (msg.includes("exhausted")) return "exhausted";
  if (msg.includes("already_redeemed")) return "already_redeemed";
  if (msg.includes("daily_cap_exceeded")) return "daily_cap_exceeded";
  return "unknown";
}

// ============================================================================
// Admin-facing: create + deactivate
// ============================================================================

export type CreatePromoCodeResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

export type CreatePromoCodeInput = {
  code: string;
  credits: number;
  description?: string;
  maxRedemptions?: number | null;
  expiresAt?: string | null; // ISO timestamp
};

/**
 * Admin: create a new promo code. Uses the service-role client to bypass
 * RLS (promo_codes has no client-side write policy). Email-allowlist guard
 * via ADMIN_EMAILS.
 */
export async function createPromoCode(
  input: CreatePromoCodeInput,
): Promise<CreatePromoCodeResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return { ok: false, error: "Not authenticated" };
  }
  if (!isAdminEmail(user.email)) {
    return { ok: false, error: "Not authorized" };
  }

  const rl = await rateLimit("createPromoCode", user.id);
  if (!rl.ok) {
    return { ok: false, error: `Slow down — try again in ${rl.retryAfter}s` };
  }

  const code = normalizeCode(input.code);
  if (!CODE_PATTERN.test(code)) {
    return { ok: false, error: "Code must be 4-32 chars, A-Z / 0-9 / hyphen." };
  }
  if (!Number.isInteger(input.credits) || input.credits <= 0 || input.credits > 1000) {
    return { ok: false, error: "Credits must be a whole number between 1 and 1000." };
  }
  if (
    input.maxRedemptions !== null &&
    input.maxRedemptions !== undefined &&
    (!Number.isInteger(input.maxRedemptions) || input.maxRedemptions < 1)
  ) {
    return { ok: false, error: "Max redemptions must be a positive whole number, or empty for unlimited." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("promo_codes").insert({
    code,
    credits: input.credits,
    description: input.description?.trim() || null,
    max_redemptions: input.maxRedemptions ?? null,
    expires_at: input.expiresAt ?? null,
    created_by: user.id,
  });

  if (error) {
    // Unique violation = code already exists.
    if (error.code === "23505") {
      return { ok: false, error: "A code with that name already exists." };
    }
    console.error("createPromoCode: insert failed", error);
    return { ok: false, error: "Couldn't create code — try again." };
  }

  revalidatePath("/admin/codes");
  return { ok: true, code };
}

export type DeactivatePromoCodeResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Admin: deactivate a code (set is_active=false). Existing redemptions are
 * preserved (we never delete from the ledger). Idempotent — calling on an
 * already-inactive code is a no-op success.
 */
export async function deactivatePromoCode(
  codeId: string,
): Promise<DeactivatePromoCodeResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return { ok: false, error: "Not authenticated" };
  }
  if (!isAdminEmail(user.email)) {
    return { ok: false, error: "Not authorized" };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("promo_codes")
    .update({ is_active: false })
    .eq("id", codeId);

  if (error) {
    console.error("deactivatePromoCode: update failed", error);
    return { ok: false, error: "Couldn't deactivate code — try again." };
  }

  revalidatePath("/admin/codes");
  return { ok: true };
}
