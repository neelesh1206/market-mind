import { describe, expect, it } from "vitest";
import { BADGE_CATALOG, badgeMetaFor, type BadgeMeta } from "../badges";

describe("BADGE_CATALOG", () => {
  it("has exactly the six v1 badges in display order", () => {
    expect(BADGE_CATALOG).toHaveLength(6);
    const types = BADGE_CATALOG.map((b) => b.type);
    expect(types).toEqual([
      "FIRST_BET",
      "FIRST_WIN",
      "STREAK_3",
      "STREAK_7",
      "STREAK_14",
      "STREAK_30",
    ]);
  });

  it("every entry carries the required display fields", () => {
    for (const meta of BADGE_CATALOG) {
      expect(meta.label).toBeTruthy();
      expect(meta.description).toBeTruthy();
      expect(meta.emoji).toBeTruthy();
      expect(["bronze", "silver", "gold", "platinum"]).toContain(meta.tier);
    }
  });

  it("streak ladder uses ascending tier progression", () => {
    const streakBadges = BADGE_CATALOG.filter((b) => b.type.startsWith("STREAK_"));
    const tierOrder: Record<BadgeMeta["tier"], number> = {
      bronze: 0,
      silver: 1,
      gold: 2,
      platinum: 3,
    };
    for (let i = 1; i < streakBadges.length; i++) {
      expect(tierOrder[streakBadges[i]!.tier]).toBeGreaterThanOrEqual(
        tierOrder[streakBadges[i - 1]!.tier],
      );
    }
  });
});

describe("badgeMetaFor", () => {
  it("returns the catalog entry for a known badge type", () => {
    const meta = badgeMetaFor("FIRST_WIN");
    expect(meta).not.toBeNull();
    expect(meta?.type).toBe("FIRST_WIN");
    expect(meta?.label).toMatch(/first win/i);
  });

  it("returns null for an unknown badge type (forward-compat guard)", () => {
    // If the DB ever has a badge_type we've removed from the catalog
    // (deprecated badge, future badge from a later migration), this
    // returning null lets the UI filter it out instead of crashing.
    expect(badgeMetaFor("LEGENDARY_TRADER")).toBeNull();
    expect(badgeMetaFor("")).toBeNull();
  });

  it("is case-sensitive (badge types are canonical uppercase)", () => {
    // DB values are always uppercase; lowercase or mixed should miss.
    expect(badgeMetaFor("first_win")).toBeNull();
    expect(badgeMetaFor("First_Win")).toBeNull();
  });
});
