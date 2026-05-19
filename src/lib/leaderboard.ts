import type { SupabaseClient } from "@supabase/supabase-js";

export type LeaderboardTier = "diamond" | "platinum" | "gold" | null;

export type LeaderboardRow = {
  rank: number;
  user_id: string;
  /** May be null if user hasn't set a display name; UI falls back to "Anonymous". */
  display_name: string | null;
  accuracy: number; // 0-100 (stored as numeric(5,2))
  predictions: number; // count of decisive bets (WIN + LOSS)
  credits_won: number; // net profit across the week
  tier: LeaderboardTier;
};

export type LeaderboardSnapshot = {
  weekStart: string | null; // ISO YYYY-MM-DD, null when no snapshot exists yet
  rows: LeaderboardRow[];
};

/**
 * Latest weekly leaderboard. Returns the most-recent `week_start` group, up
 * to `limit` rows ordered by rank ascending.
 *
 * The snapshot's display_name is read via a follow-up join against
 * `user_profiles` — `weekly_leaderboard_snapshots` deliberately doesn't
 * denormalize names (user can change display name post-snapshot and we want
 * the leaderboard to reflect the latest).
 */
export async function fetchLatestLeaderboard(
  client: SupabaseClient,
  limit = 20,
): Promise<LeaderboardSnapshot> {
  // Find the most recent week_start that has any snapshots.
  const { data: weekRows, error: weekErr } = await client
    .from("weekly_leaderboard_snapshots")
    .select("week_start")
    .order("week_start", { ascending: false })
    .limit(1);

  if (weekErr) {
    console.warn(`[leaderboard] week lookup failed: ${weekErr.message}`);
    return { weekStart: null, rows: [] };
  }

  const weekStart = weekRows?.[0]?.week_start ?? null;
  if (!weekStart) {
    return { weekStart: null, rows: [] };
  }

  const { data: snapRows, error: snapErr } = await client
    .from("weekly_leaderboard_snapshots")
    .select("rank, user_id, accuracy, predictions, credits_won, tier, display_name")
    .eq("week_start", weekStart)
    .order("rank", { ascending: true })
    .limit(limit);

  if (snapErr) {
    console.warn(`[leaderboard] snapshot fetch failed: ${snapErr.message}`);
    return { weekStart, rows: [] };
  }

  const rows: LeaderboardRow[] = (snapRows ?? []).map((r) => ({
    rank: r.rank as number,
    user_id: r.user_id as string,
    display_name: (r.display_name as string | null) ?? null,
    accuracy: Number(r.accuracy ?? 0),
    predictions: (r.predictions as number) ?? 0,
    credits_won: (r.credits_won as number) ?? 0,
    tier: (r.tier as LeaderboardTier) ?? null,
  }));

  return { weekStart, rows };
}
