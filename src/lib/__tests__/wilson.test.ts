import { describe, expect, it } from "vitest";
import { Z_95, formatWilsonRange, wilsonInterval } from "../wilson";

describe("wilsonInterval", () => {
  it("returns [0, 1] when total = 0 (no information)", () => {
    const ci = wilsonInterval(0, 0);
    expect(ci.lower).toBe(0);
    expect(ci.upper).toBe(1);
  });

  it("never returns bounds outside [0, 1]", () => {
    const cases: Array<[number, number]> = [
      [0, 1], [1, 1], [0, 5], [5, 5], [0, 100], [100, 100],
    ];
    for (const [c, n] of cases) {
      const ci = wilsonInterval(c, n);
      expect(ci.lower).toBeGreaterThanOrEqual(0);
      expect(ci.upper).toBeLessThanOrEqual(1);
      expect(ci.lower).toBeLessThanOrEqual(ci.upper);
    }
  });

  it("matches a known reference value (18/27 at 95%)", () => {
    // Standard Wilson (no continuity correction), per Wikipedia formula and
    // statsmodels.proportion_confint(method='wilson'):
    //   center ≈ 0.6459, lower ≈ 0.4783, upper ≈ 0.8136
    // Different from R's binom.confint(method='wilson') which adds a
    // continuity correction by default (~0.002 wider on each side).
    const ci = wilsonInterval(18, 27);
    expect(ci.lower).toBeCloseTo(0.4783, 3);
    expect(ci.upper).toBeCloseTo(0.8136, 3);
  });

  it("matches a known reference value (3/5 at 95%) — wide CI on small sample", () => {
    // Standard Wilson at 3/5: lower ≈ 0.2307, upper ≈ 0.8821
    const ci = wilsonInterval(3, 5);
    expect(ci.lower).toBeCloseTo(0.2307, 3);
    expect(ci.upper).toBeCloseTo(0.8821, 3);
    expect(ci.upper - ci.lower).toBeGreaterThan(0.5); // very wide
  });

  it("matches a known reference value (50/100 at 95%) — moderate sample", () => {
    // 50/100 Wilson: (0.4038, 0.5962)
    const ci = wilsonInterval(50, 100);
    expect(ci.lower).toBeCloseTo(0.4038, 2);
    expect(ci.upper).toBeCloseTo(0.5962, 2);
  });

  it("at p=0 produces lower=0 (not negative) and a finite upper", () => {
    const ci = wilsonInterval(0, 10);
    expect(ci.lower).toBe(0);
    expect(ci.upper).toBeGreaterThan(0);
    expect(ci.upper).toBeLessThan(0.35); // small upper at n=10
  });

  it("at p=1 produces upper=1 (not >1) and a finite lower", () => {
    const ci = wilsonInterval(10, 10);
    // The Math.min(1, ...) clamp may leave it at 1-epsilon due to floating
    // point in the underlying formula; tolerate that.
    expect(ci.upper).toBeCloseTo(1, 5);
    expect(ci.upper).toBeLessThanOrEqual(1);
    expect(ci.lower).toBeGreaterThan(0.65); // lower bound has grown
    expect(ci.lower).toBeLessThan(1);
  });

  it("CI width shrinks monotonically as sample size grows at fixed p", () => {
    const widthAt = (n: number): number => {
      const correct = Math.round(n * 0.6);
      const { lower, upper } = wilsonInterval(correct, n);
      return upper - lower;
    };
    expect(widthAt(10)).toBeGreaterThan(widthAt(100));
    expect(widthAt(100)).toBeGreaterThan(widthAt(1000));
  });

  it("Z_95 is the 1.96 critical value", () => {
    // Sanity: 1.96 to 2 decimal places
    expect(Z_95).toBeCloseTo(1.96, 2);
  });
});

describe("formatWilsonRange", () => {
  it("returns null when total = 0", () => {
    expect(formatWilsonRange(0, 0)).toBeNull();
  });

  it("formats as 'X–Y%' rounded to integers", () => {
    expect(formatWilsonRange(18, 27)).toBe("48–81%");
  });

  it("formats endpoints with no decimals", () => {
    const s = formatWilsonRange(50, 100);
    expect(s).toMatch(/^\d+–\d+%$/);
  });
});
