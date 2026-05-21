/**
 * Promo-code redemption — types, constants, read helpers.
 *
 * The redeem mutation lives in `src/app/actions/promo-codes.ts` (server
 * action). This module is safe to import from client components.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-user inflow cap from codes per ET calendar day. Mirrored in the
 * `redeem_promo_code` RPC (`v_daily_cap constant integer := 1000`); keep
 * them in sync if you change one. The UI uses this for the "X / 1000 used
 * today" counter and to short-circuit submissions when the user is already
 * at the cap.
 */
export const DAILY_PROMO_CAP = 1000;

/**
 * Validation for the user's input. Mirrors the Postgres check constraint:
 * uppercase A-Z + digits + hyphen, 4-32 chars. Normalization (upper + trim)
 * happens both client- and server-side.
 */
export const CODE_PATTERN = /^[A-Z0-9-]{4,32}$/;

export function normalizeCode(input: string): string {
  return input.trim().toUpperCase();
}

export type RedeemError =
  | "not_authenticated"
  | "not_found"
  | "inactive"
  | "expired"
  | "exhausted"
  | "already_redeemed"
  | "daily_cap_exceeded"
  | "rate_limited"
  | "invalid_format"
  | "unknown";

/**
 * User-facing copy for each error. The error key maps to a complete
 * sentence the dialog can show via sonner toast. Vague-by-design for
 * not_found / invalid_format so a brute-forcer can't tell whether a code
 * exists or was malformed.
 */
export const REDEEM_ERROR_COPY: Record<RedeemError, string> = {
  not_authenticated: "Sign in to redeem codes.",
  not_found: "That code isn't valid.",
  inactive: "That code isn't valid.",
  expired: "That code has expired.",
  exhausted: "That code has been fully redeemed.",
  already_redeemed: "You've already redeemed this code.",
  daily_cap_exceeded: `You're at today's ${DAILY_PROMO_CAP.toLocaleString()}-credit cap. Try again tomorrow.`,
  rate_limited: "Too many attempts. Wait a minute and try again.",
  invalid_format: "Codes are 4-32 characters, letters and digits only.",
  unknown: "Something went wrong. Try again in a moment.",
};

export type RecentRedemption = {
  code: string;
  credits: number;
  redeemedAt: string; // ISO timestamp
};

/**
 * Sum of credits this user has redeemed in the current ET calendar day.
 * The redeem RPC enforces the cap atomically; this is purely for the UI
 * counter. Returns 0 on any error (defensive — the cap is server-authoritative).
 */
export async function fetchDailyPromoUsed(
  client: SupabaseClient,
  opts: { userId: string; etDate: string },
): Promise<number> {
  const { userId, etDate } = opts;
  // ET day start as ISO (used to filter redeemed_at >= start). The RPC uses
  // (redeemed_at at time zone 'America/New_York')::date = p_today_date —
  // but PostgREST doesn't easily express that, so we approximate via a
  // half-open range in the day's UTC equivalent. Off-by-a-millisecond at
  // the edges doesn't matter because the cap is enforced in the RPC.
  const dayStart = new Date(`${etDate}T05:00:00Z`); // ET midnight is 04/05 UTC (DST-dependent)
  // We deliberately do *not* try to nail DST here — the visible counter
  // can be off by one redemption near the DST boundary, but the RPC's
  // `at time zone 'America/New_York'` cast is authoritative.

  const { data, error } = await client
    .from("promo_code_redemptions")
    .select("credits")
    .eq("user_id", userId)
    .gte("redeemed_at", dayStart.toISOString());

  if (error) {
    console.warn("fetchDailyPromoUsed_error", error);
    return 0;
  }
  return (data ?? []).reduce((acc, row) => acc + (row.credits ?? 0), 0);
}

/**
 * Most-recent redemptions for the current user (own-read RLS allows this).
 * Joins to promo_codes for the human-readable code string. Returns empty on
 * any error (defensive — the dialog still shows the redeem form without it).
 */
export async function fetchRecentRedemptions(
  client: SupabaseClient,
  opts: { userId: string; limit?: number },
): Promise<RecentRedemption[]> {
  const { userId, limit = 5 } = opts;
  const { data, error } = await client
    .from("promo_code_redemptions")
    .select("credits, redeemed_at, promo_codes!inner(code)")
    .eq("user_id", userId)
    .order("redeemed_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("fetchRecentRedemptions_error", error);
    return [];
  }

  return (data ?? []).map((row: {
    credits: number;
    redeemed_at: string;
    promo_codes: { code: string } | { code: string }[];
  }) => {
    // PostgREST returns the joined row either as an object or a single-elem
    // array depending on relationship metadata. Handle both.
    const codeRow = Array.isArray(row.promo_codes) ? row.promo_codes[0] : row.promo_codes;
    return {
      code: codeRow?.code ?? "",
      credits: row.credits,
      redeemedAt: row.redeemed_at,
    };
  });
}

/**
 * Admin-only — list all codes for the management page. Reads with the
 * service-role client (passed in from the page) because promo_codes has
 * no RLS read policy for regular users.
 */
export type PromoCodeRow = {
  id: string;
  code: string;
  credits: number;
  description: string | null;
  maxRedemptions: number | null;
  redeemCount: number;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
};

export async function fetchAllPromoCodes(
  serviceClient: SupabaseClient,
): Promise<PromoCodeRow[]> {
  const { data, error } = await serviceClient
    .from("promo_codes")
    .select(
      "id, code, credits, description, max_redemptions, redeem_count, expires_at, is_active, created_at",
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("fetchAllPromoCodes_error", error);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    credits: r.credits,
    description: r.description,
    maxRedemptions: r.max_redemptions,
    redeemCount: r.redeem_count,
    expiresAt: r.expires_at,
    isActive: r.is_active,
    createdAt: r.created_at,
  }));
}

/**
 * Derive the user-visible status of a code from its fields.
 *   "exhausted" — max_redemptions hit
 *   "expired"   — past expires_at
 *   "inactive"  — admin disabled it
 *   "active"    — still spendable
 */
export function codeStatus(row: PromoCodeRow, now: Date = new Date()):
  | "active"
  | "inactive"
  | "expired"
  | "exhausted" {
  if (!row.isActive) return "inactive";
  if (row.expiresAt && new Date(row.expiresAt) < now) return "expired";
  if (row.maxRedemptions !== null && row.redeemCount >= row.maxRedemptions) {
    return "exhausted";
  }
  return "active";
}
