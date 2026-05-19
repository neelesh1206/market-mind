import type { SupabaseClient } from "@supabase/supabase-js";

export type BadgeType =
  | "FIRST_BET"
  | "FIRST_WIN"
  | "STREAK_3"
  | "STREAK_7"
  | "STREAK_14"
  | "STREAK_30";

export type BadgeMeta = {
  type: BadgeType;
  label: string;
  description: string;
  /** Emoji used as the icon — works in OG cards, terminals, and any rendering surface. */
  emoji: string;
  /** Visual tier — "bronze" / "silver" / "gold" / "platinum". Drives card styling. */
  tier: "bronze" | "silver" | "gold" | "platinum";
};

/**
 * Single source of truth for badge presentation. Keep in sync with the SQL
 * insertion points (place_bet, resolve_predictions.py, claim_daily_bonus).
 *
 * Order matters — used as the display order in the badge grid.
 */
export const BADGE_CATALOG: BadgeMeta[] = [
  {
    type: "FIRST_BET",
    label: "First Bet",
    description: "Placed your first prediction. The ritual begins.",
    emoji: "🎯",
    tier: "bronze",
  },
  {
    type: "FIRST_WIN",
    label: "First Win",
    description: "Called the direction right and the market agreed.",
    emoji: "🏆",
    tier: "silver",
  },
  {
    type: "STREAK_3",
    label: "3-Day Streak",
    description: "Three days of daily check-ins in a row.",
    emoji: "🔥",
    tier: "bronze",
  },
  {
    type: "STREAK_7",
    label: "Week Streak",
    description: "Seven consecutive days — habit established.",
    emoji: "🔥",
    tier: "silver",
  },
  {
    type: "STREAK_14",
    label: "Fortnight Streak",
    description: "Two weeks of unbroken daily ritual.",
    emoji: "🔥",
    tier: "gold",
  },
  {
    type: "STREAK_30",
    label: "Month Streak",
    description: "Thirty days. You're built for this.",
    emoji: "🔥",
    tier: "platinum",
  },
];

const BADGE_BY_TYPE = new Map(BADGE_CATALOG.map((b) => [b.type, b]));

export function badgeMetaFor(type: string): BadgeMeta | null {
  return BADGE_BY_TYPE.get(type as BadgeType) ?? null;
}

export type EarnedBadge = {
  type: BadgeType;
  earned_at: string;
  metadata: Record<string, unknown> | null;
};

/**
 * All badges the user has earned, in earned-at descending order. Filters out
 * any rows whose `badge_type` isn't in the current catalog — that way an
 * orphaned/deprecated badge type in the DB doesn't crash the UI.
 */
export async function fetchUserBadges(
  client: SupabaseClient,
  userId: string,
): Promise<EarnedBadge[]> {
  const { data, error } = await client
    .from("user_badges")
    .select("badge_type, earned_at, metadata")
    .eq("user_id", userId)
    .order("earned_at", { ascending: false });

  if (error) {
    console.warn(`[badges] fetchUserBadges: ${error.message}`);
    return [];
  }

  type Row = { badge_type: string; earned_at: string; metadata: Record<string, unknown> | null };
  return ((data ?? []) as Row[])
    .filter((r) => BADGE_BY_TYPE.has(r.badge_type as BadgeType))
    .map((r) => ({
      type: r.badge_type as BadgeType,
      earned_at: r.earned_at,
      metadata: r.metadata,
    }));
}
