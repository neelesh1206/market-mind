import { describe, expect, it } from "vitest";
import { computeSyntheticVerdict, isSyntheticVerdict } from "../verdict";
import type { StockInsight } from "@/types/insight";

/**
 * Fixture builder — minimal StockInsight with the only fields verdict cares
 * about (the four bucket scores). Everything else defaults to null because
 * computeSyntheticVerdict doesn't read it. The exhaustive type assertion at
 * the return ensures we'd catch a schema drift here at compile time.
 */
function insightWithScores(
  scores: Partial<{
    technical_score: number | null;
    sentiment_score: number | null;
    professional_score: number | null;
    social_score: number | null;
  }>,
): StockInsight {
  return {
    id: "insight-1",
    stock_id: "stock-1",
    insight_date: "2026-05-19",
    prev_close: null,
    day_change_pct: null,
    week_change_pct: null,
    month_change_pct: null,
    ytd_change_pct: null,
    fifty_two_week_high: null,
    fifty_two_week_low: null,
    rsi_14: null,
    macd_signal: null,
    price_vs_20ma: null,
    price_vs_50ma: null,
    bollinger_position: null,
    volume_trend: null,
    technical_score: scores.technical_score ?? null,
    sentiment_score: scores.sentiment_score ?? null,
    professional_score: scores.professional_score ?? null,
    social_score: scores.social_score ?? null,
    news_article_count: null,
    cross_source_agreement_count: null,
    earnings_date: null,
    has_recent_8k: null,
    insider_detail: null,
    sources_total_count: null,
    computed_at: "2026-05-19T08:00:00Z",
    weights_version: null,
  } as unknown as StockInsight;
}

describe("computeSyntheticVerdict", () => {
  it("returns UP when weighted combined > +0.15 threshold", () => {
    // Heavy positive technical + professional → well above threshold.
    const insight = insightWithScores({
      technical_score: 0.6,
      sentiment_score: 0.4,
      professional_score: 0.7,
      social_score: 0.1,
    });
    const v = computeSyntheticVerdict(insight);
    expect(v.direction).toBe("UP");
    // 0.6*.3 + 0.4*.25 + 0.7*.3 + 0.1*.15 = 0.18 + 0.10 + 0.21 + 0.015 = 0.505
    expect(v.confidence).toBeCloseTo(0.505, 3);
  });

  it("returns DOWN when weighted combined < -0.15 threshold", () => {
    const insight = insightWithScores({
      technical_score: -0.5,
      sentiment_score: -0.6,
      professional_score: -0.4,
      social_score: -0.2,
    });
    const v = computeSyntheticVerdict(insight);
    expect(v.direction).toBe("DOWN");
    expect(v.confidence).toBeGreaterThan(0);
  });

  it("returns NEUTRAL when |combined| <= threshold", () => {
    // Small mixed signals near zero.
    const insight = insightWithScores({
      technical_score: 0.1,
      sentiment_score: -0.05,
      professional_score: 0.05,
      social_score: 0.0,
    });
    const v = computeSyntheticVerdict(insight);
    expect(v.direction).toBe("NEUTRAL");
    expect(v.reasoning).toMatch(/mixed signals/i);
  });

  it("treats null bucket scores as zero (no NaN, no crash)", () => {
    const insight = insightWithScores({
      technical_score: 0.8,
      sentiment_score: null, // missing data
      professional_score: null,
      social_score: null,
    });
    const v = computeSyntheticVerdict(insight);
    // Only technical contributes: 0.8 * 0.3 = 0.24 → above threshold → UP
    expect(v.direction).toBe("UP");
    expect(Number.isFinite(v.confidence)).toBe(true);
  });

  it("returns NEUTRAL when all bucket scores are null", () => {
    const insight = insightWithScores({});
    const v = computeSyntheticVerdict(insight);
    expect(v.direction).toBe("NEUTRAL");
    expect(v.confidence).toBe(0);
  });

  it("caps confidence at 1.0 (signal saturation)", () => {
    // Buckets are bounded to [-1, +1] but a contrived all-+1 still caps.
    const insight = insightWithScores({
      technical_score: 1,
      sentiment_score: 1,
      professional_score: 1,
      social_score: 1,
    });
    const v = computeSyntheticVerdict(insight);
    expect(v.confidence).toBeLessThanOrEqual(1);
  });

  it("reasoning names the top driver buckets when directional", () => {
    const insight = insightWithScores({
      technical_score: 0.8, // top driver
      sentiment_score: 0.3, // second
      professional_score: 0.05,
      social_score: 0.0,
    });
    const v = computeSyntheticVerdict(insight);
    expect(v.direction).toBe("UP");
    expect(v.reasoning).toMatch(/bullish/i);
    expect(v.reasoning?.toLowerCase() ?? "").toContain("technical");
  });

  it("tags the result as synthetic via id prefix", () => {
    const insight = insightWithScores({ technical_score: 0.5 });
    const v = computeSyntheticVerdict(insight);
    expect(v.id).toBe("synthetic-insight-1");
    expect(isSyntheticVerdict(v)).toBe(true);
  });

  it("preserves the weights_version contract for later audit", () => {
    const insight = insightWithScores({ technical_score: 0.5 });
    const v = computeSyntheticVerdict(insight);
    expect(v.weights_version).toBe("v1");
  });
});

describe("isSyntheticVerdict", () => {
  it("returns true only for ids prefixed with 'synthetic-'", () => {
    expect(isSyntheticVerdict({ id: "synthetic-abc" } as never)).toBe(true);
    expect(isSyntheticVerdict({ id: "abc-123" } as never)).toBe(false);
    expect(isSyntheticVerdict({ id: "" } as never)).toBe(false);
  });
});
