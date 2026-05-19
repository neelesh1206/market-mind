/**
 * Type definitions for stock_insights and insight_articles rows.
 * Mirrors the database schema in `supabase/migrations/20260518000001_initial_schema.sql`.
 *
 * Kept hand-written for now — we can replace with `supabase gen types typescript`
 * output later once the schema stabilizes.
 */

export type InsightArticle = {
  id: string;
  insight_id: string;
  headline: string;
  url: string;
  source: string;
  published_at: string | null;
  sentiment: number | null;
  tldr: string | null;
  summary: string | null;
  signal_influence: string | null;
  display_rank: number | null;
};

export type StockInsight = {
  id: string;
  stock_id: string;
  insight_date: string;

  // Price context
  prev_close: number | null;
  day_change_pct: number | null;
  week_change_pct: number | null;
  month_change_pct: number | null;
  ytd_change_pct: number | null;
  fifty_two_week_high: number | null;
  fifty_two_week_low: number | null;

  // Technical bucket
  rsi_14: number | null;
  macd_signal: "bullish_crossover" | "bearish_crossover" | "neutral" | null;
  price_vs_20ma: "above" | "below" | null;
  price_vs_50ma: "above" | "below" | null;
  bollinger_position: "upper" | "middle" | "lower" | null;
  volume_trend: "increasing" | "decreasing" | "neutral" | null;
  technical_score: number | null;

  // Sentiment bucket
  news_sentiment_score: number | null;
  news_article_count: number | null;
  top_headline: string | null;
  top_headline_url: string | null;
  top_headline_source: string | null;
  sources_agree_count: number | null;
  sources_total_count: number | null;
  sentiment_score: number | null;

  // Professional bucket
  analyst_count: number | null;
  analyst_buy: number | null;
  analyst_hold: number | null;
  analyst_sell: number | null;
  analyst_price_target: number | null;
  analyst_rating_change: string | null;
  insider_activity: "buying" | "selling" | "neutral" | null;
  insider_detail: string | null;
  earnings_date: string | null;
  earnings_in_days: number | null;
  has_recent_8k: boolean | null;
  professional_score: number | null;

  // Social bucket
  reddit_mention_count: number | null;
  reddit_mention_delta: number | null;
  apewisdom_rank: number | null;
  stocktwits_bullish: number | null;
  stocktwits_messages: number | null;
  google_trend_score: number | null;
  social_score: number | null;

  // Macro
  sector_etf_change_pct: number | null;
  vix_level: number | null;

  signal_breakdown: Record<string, unknown> | null;
  computed_at: string;
};

/**
 * MarketMind's daily verdict per stock. See ADR 0007.
 * Public-read; resolved by the 4:15 PM cron alongside user predictions.
 */
export type MarketMindPrediction = {
  id: string;
  insight_id: string;
  stock_id: string;
  prediction_date: string;
  direction: "UP" | "DOWN" | "NEUTRAL";
  confidence: number;
  reasoning: string | null;
  bucket_scores: Record<string, number | null>;
  weights_version: string;
  resolved: boolean;
  outcome: "WIN" | "LOSS" | "VOID" | null;
  open_price: number | null;
  close_price: number | null;
  resolved_at: string | null;
  created_at: string;
};

/**
 * What gets rendered on a home-feed card: the stock metadata, today's insight,
 * MarketMind's verdict, and the top article with its summaries.
 */
export type StockCardData = {
  stock: {
    id: string;
    ticker: string;
    name: string;
    sector: string;
    sub_sector: string | null;
  };
  insight: StockInsight | null;
  topArticle: InsightArticle | null;
  verdict: MarketMindPrediction | null;
};
