import type { MarketMindPrediction, StockInsight } from "@/types/insight";

/**
 * Client-side verdict synthesis from the already-computed bucket scores.
 *
 * Mirrors `pipeline/processors/verdict.py` so the UI can show a prediction
 * even before today's pipeline has populated `marketmind_predictions`.
 *
 * When a stored verdict exists, that wins — it carries the reasoning + the
 * eventual resolution outcome. The synthetic verdict is a "live preview"
 * that is NEVER tracked toward the published accuracy stats.
 *
 * Stored vs synthetic is distinguishable by `id` starting with "synthetic-".
 */
const WEIGHTS_V1 = {
  technical: 0.3,
  sentiment: 0.25,
  professional: 0.3,
  social: 0.15,
} as const;

const DIRECTION_THRESHOLD = 0.15;

const BUCKET_LABELS: Record<keyof typeof WEIGHTS_V1, string> = {
  technical: "technical",
  sentiment: "sentiment",
  professional: "professional",
  social: "social",
};

function coerce(v: number | null | undefined): number {
  return typeof v === "number" ? v : 0;
}

/** Returns a fake-id'd MarketMindPrediction row for cards that have insight data but no stored verdict. */
export function computeSyntheticVerdict(insight: StockInsight): MarketMindPrediction {
  const scores = {
    technical: coerce(insight.technical_score),
    sentiment: coerce(insight.sentiment_score),
    professional: coerce(insight.professional_score),
    social: coerce(insight.social_score),
  };

  const combined =
    scores.technical * WEIGHTS_V1.technical +
    scores.sentiment * WEIGHTS_V1.sentiment +
    scores.professional * WEIGHTS_V1.professional +
    scores.social * WEIGHTS_V1.social;

  const direction: "UP" | "DOWN" | "NEUTRAL" =
    combined > DIRECTION_THRESHOLD ? "UP" : combined < -DIRECTION_THRESHOLD ? "DOWN" : "NEUTRAL";

  const confidence = Math.min(Math.abs(combined), 1);

  // Pick top 1-2 bucket drivers in the direction of the verdict for reasoning
  let reasoning: string;
  if (direction === "NEUTRAL") {
    reasoning = "Mixed signals across buckets — no clear read for tomorrow.";
  } else {
    const sign = direction === "UP" ? 1 : -1;
    const aligned = (Object.keys(scores) as Array<keyof typeof scores>)
      .filter((k) => scores[k] * sign > 0.1)
      .sort((a, b) => Math.abs(scores[b]) - Math.abs(scores[a]));
    const drivers = aligned.slice(0, 2).map((k) => BUCKET_LABELS[k]);
    const prefix = direction === "UP" ? "Bullish" : "Bearish";
    reasoning =
      drivers.length > 0
        ? `${prefix} — driven primarily by ${drivers.join(" and ")} signals.`
        : `${prefix} — weighted signal slightly above threshold.`;
  }

  return {
    id: `synthetic-${insight.id}`,
    insight_id: insight.id,
    stock_id: insight.stock_id,
    prediction_date: insight.insight_date,
    direction,
    confidence: Math.round(confidence * 1000) / 1000,
    reasoning,
    bucket_scores: scores,
    weights_version: "v1",
    resolved: false,
    outcome: null,
    open_price: null,
    close_price: null,
    resolved_at: null,
    created_at: insight.computed_at,
  };
}

export function isSyntheticVerdict(verdict: MarketMindPrediction): boolean {
  return verdict.id.startsWith("synthetic-");
}
