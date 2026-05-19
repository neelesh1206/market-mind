import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { getDailyBonusStatus } from "../bonus";

/**
 * Build a fake SupabaseClient that returns the given profile row from
 * `.from("user_profiles").select(...).eq(...).maybeSingle()`. Only stubs
 * the method chain `getDailyBonusStatus` actually uses; anything else
 * throws so unexpected DB calls surface loudly.
 */
function mockSupabase(profile: {
  current_streak: number | null;
  longest_streak: number | null;
  last_login_date: string | null;
} | null, opts: { error?: { message: string } } = {}): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: profile, error: opts.error ?? null }),
  };
  return {
    from: () => chain,
  } as unknown as SupabaseClient;
}

const USER = "11111111-1111-1111-1111-111111111111";
const TODAY = "2026-05-19";
const YESTERDAY = "2026-05-18";

describe("getDailyBonusStatus", () => {
  it("returns first-day defaults when the user has never claimed", () => {
    const client = mockSupabase({
      current_streak: 0,
      longest_streak: 0,
      last_login_date: null,
    });
    return getDailyBonusStatus(client, USER, TODAY).then((status) => {
      expect(status.available).toBe(true);
      expect(status.currentStreak).toBe(0);
      expect(status.lastClaim).toBeNull();
      expect(status.streakWouldContinue).toBe(false);
      // Day 1 bonus = 100 base.
      expect(status.nextBonusAmount).toBe(100);
    });
  });

  it("flags `available=false` when last claim was today", async () => {
    const client = mockSupabase({
      current_streak: 3,
      longest_streak: 7,
      last_login_date: TODAY,
    });
    const status = await getDailyBonusStatus(client, USER, TODAY);
    expect(status.available).toBe(false);
    expect(status.currentStreak).toBe(3);
  });

  it("projects streak+1 when last claim was yesterday", async () => {
    const client = mockSupabase({
      current_streak: 4,
      longest_streak: 4,
      last_login_date: YESTERDAY,
    });
    const status = await getDailyBonusStatus(client, USER, TODAY);
    expect(status.available).toBe(true);
    expect(status.streakWouldContinue).toBe(true);
    // Projected streak = 5 → bonus = 100 + 4*20 = 180.
    expect(status.nextBonusAmount).toBe(180);
  });

  it("resets streak projection to 1 when last claim was >1 day ago", async () => {
    const client = mockSupabase({
      current_streak: 9, // had a long streak then skipped a day
      longest_streak: 9,
      last_login_date: "2026-05-15", // 4 days ago, streak broken
    });
    const status = await getDailyBonusStatus(client, USER, TODAY);
    expect(status.available).toBe(true);
    expect(status.streakWouldContinue).toBe(false);
    // Projected streak = 1 → bonus = 100.
    expect(status.nextBonusAmount).toBe(100);
  });

  it("caps the next bonus at 300 once streak ≥ 10", async () => {
    const client = mockSupabase({
      current_streak: 14, // already at 14, yesterday's claim continues it
      longest_streak: 14,
      last_login_date: YESTERDAY,
    });
    const status = await getDailyBonusStatus(client, USER, TODAY);
    // Projected = 15 → 100 + 14*20 = 380, capped to 300.
    expect(status.nextBonusAmount).toBe(300);
  });

  it("returns safe defaults when the profile lookup fails", async () => {
    const client = mockSupabase(null, { error: { message: "boom" } });
    const status = await getDailyBonusStatus(client, USER, TODAY);
    // Defensive: claim button should NOT light up if we couldn't even
    // determine the user's state.
    expect(status.available).toBe(false);
    expect(status.currentStreak).toBe(0);
    expect(status.lastClaim).toBeNull();
  });
});
