import { describe, expect, it } from "vitest";
import { computeBetStats, isStuckPrediction, type BetHistoryRow } from "../bets";

// Test fixture builder — returns a fully-typed BetHistoryRow with overrides
// applied. Saves a lot of boilerplate vs spreading every field per test.
function makeBet(overrides: Partial<BetHistoryRow> = {}): BetHistoryRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    user_id: "00000000-0000-0000-0000-000000000002",
    stock_id: "00000000-0000-0000-0000-000000000003",
    prediction_date: "2026-05-19",
    direction: "UP",
    credits_wagered: 100,
    locked_at: "2026-05-19T09:00:00Z",
    resolved: false,
    outcome: null,
    open_price: null,
    close_price: null,
    price_at_placement: null,
    payout: null,
    resolved_at: null,
    created_at: "2026-05-19T08:00:00Z",
    stock: { ticker: "AAPL", name: "Apple Inc.", sector: "Technology" },
    ...overrides,
  };
}

describe("isStuckPrediction", () => {
  const today = "2026-05-19";

  it("returns true when prediction_date is before today and unresolved", () => {
    expect(
      isStuckPrediction({ prediction_date: "2026-05-18", resolved: false }, today),
    ).toBe(true);
  });

  it("returns false when prediction_date matches today (still in flight)", () => {
    expect(
      isStuckPrediction({ prediction_date: today, resolved: false }, today),
    ).toBe(false);
  });

  it("returns false when resolved=true, regardless of date", () => {
    expect(
      isStuckPrediction({ prediction_date: "2026-05-10", resolved: true }, today),
    ).toBe(false);
  });

  it("returns false when prediction_date is in the future", () => {
    // Shouldn't happen normally but the comparison shouldn't false-trigger.
    expect(
      isStuckPrediction({ prediction_date: "2026-05-20", resolved: false }, today),
    ).toBe(false);
  });
});

describe("computeBetStats", () => {
  it("returns zeroed stats for empty input", () => {
    expect(computeBetStats([])).toEqual({
      total: 0,
      pending: 0,
      wins: 0,
      losses: 0,
      voids: 0,
      accuracy: null,
      netCredits: 0,
    });
  });

  it("counts pending bets but excludes them from outcome math", () => {
    const stats = computeBetStats([
      makeBet({ resolved: false }),
      makeBet({ resolved: false, id: "x" }),
    ]);
    expect(stats.total).toBe(2);
    expect(stats.pending).toBe(2);
    expect(stats.wins).toBe(0);
    expect(stats.accuracy).toBeNull();
    expect(stats.netCredits).toBe(0);
  });

  it("computes accuracy from WIN/LOSS only, ignoring VOID and pending", () => {
    const stats = computeBetStats([
      makeBet({ resolved: true, outcome: "WIN", payout: 180 }),
      makeBet({ resolved: true, outcome: "WIN", payout: 180 }),
      makeBet({ resolved: true, outcome: "LOSS", payout: 0 }),
      makeBet({ resolved: true, outcome: "VOID", payout: 100 }), // refunded
      makeBet({ resolved: false }), // still in flight
    ]);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.voids).toBe(1);
    expect(stats.pending).toBe(1);
    // accuracy = wins / decisive = 2/3 = 0.666...
    expect(stats.accuracy).toBeCloseTo(2 / 3, 6);
  });

  it("returns null accuracy when no decisive bets (only voids + pending)", () => {
    const stats = computeBetStats([
      makeBet({ resolved: true, outcome: "VOID", payout: 100 }),
      makeBet({ resolved: false }),
    ]);
    expect(stats.accuracy).toBeNull();
  });

  it("netCredits is sum of (payout − stake) over resolved bets only", () => {
    const stats = computeBetStats([
      // WIN at 1.8× — net +80 per 100 staked.
      makeBet({ resolved: true, outcome: "WIN", credits_wagered: 100, payout: 180 }),
      makeBet({ resolved: true, outcome: "WIN", credits_wagered: 50, payout: 90 }), // +40
      // LOSS — payout 0, net -stake.
      makeBet({ resolved: true, outcome: "LOSS", credits_wagered: 200, payout: 0 }), // -200
      // VOID refund — payout == stake, net 0.
      makeBet({ resolved: true, outcome: "VOID", credits_wagered: 100, payout: 100 }),
      // Pending — excluded entirely.
      makeBet({ resolved: false, credits_wagered: 500 }),
    ]);
    // 80 + 40 - 200 + 0 = -80
    expect(stats.netCredits).toBe(-80);
  });

  it("treats null payout as zero net contribution", () => {
    // Shouldn't normally happen on a resolved bet (payout is set by the
    // resolver), but the math shouldn't NaN out if it does.
    const stats = computeBetStats([
      makeBet({ resolved: true, outcome: "WIN", payout: null, credits_wagered: 100 }),
    ]);
    expect(stats.netCredits).toBe(0);
    expect(stats.wins).toBe(1);
  });
});
