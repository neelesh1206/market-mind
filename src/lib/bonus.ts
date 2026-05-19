import type { SupabaseClient } from "@supabase/supabase-js";

export type DailyBonusStatus = {
  /** Can the user click the claim button right now? */
  available: boolean;
  /** Current streak — 0 if user has never claimed. */
  currentStreak: number;
  /** Longest streak achieved historically. */
  longestStreak: number;
  /** Last claim date as ISO YYYY-MM-DD, or null if never claimed. */
  lastClaim: string | null;
  /** What they'd get if they clicked claim now (next streak day's bonus). */
  nextBonusAmount: number;
  /** Will claiming today continue the streak, or restart it? */
  streakWouldContinue: boolean;
};

/**
 * Pure read — figures out the daily-bonus UX without mutating anything.
 *
 * The truth source for "can claim today" is the RPC's `last_login_date ==
 * today` check; this helper mirrors that logic so the UI can render the
 * right banner before the user clicks. The RPC re-checks server-side so a
 * stale client can't double-claim.
 */
export async function getDailyBonusStatus(
  client: SupabaseClient,
  userId: string,
  todayDate: string,
): Promise<DailyBonusStatus> {
  const { data, error } = await client
    .from("user_profiles")
    .select("current_streak, longest_streak, last_login_date")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) {
    // Defensive: assume not-available so we don't tempt the user to click a
    // claim button that'll just error out.
    return {
      available: false,
      currentStreak: 0,
      longestStreak: 0,
      lastClaim: null,
      nextBonusAmount: 100,
      streakWouldContinue: false,
    };
  }

  const last = data.last_login_date as string | null;
  const current = (data.current_streak ?? 0) as number;
  const longest = (data.longest_streak ?? 0) as number;
  const available = last !== todayDate;

  // Mirrors the RPC's streak math:
  //   - last claim yesterday → continue (current + 1)
  //   - otherwise (never claimed, or > 1 day gap) → restart at 1
  const yesterday = isoDateMinusOne(todayDate);
  const streakWouldContinue = last === yesterday;
  const projectedStreak = streakWouldContinue ? current + 1 : 1;

  // Bonus formula matches the RPC: 100 + (streak - 1) * 20, capped at 300.
  const nextBonusAmount = Math.min(100 + (projectedStreak - 1) * 20, 300);

  return {
    available,
    currentStreak: current,
    longestStreak: longest,
    lastClaim: last,
    nextBonusAmount,
    streakWouldContinue,
  };
}

function isoDateMinusOne(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  // Compute in UTC to avoid local-tz date shift. The input is an ET calendar
  // date string and we just want the day before in that same calendar.
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}
