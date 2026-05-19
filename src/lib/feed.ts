import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  InsightArticle,
  MarketMindPrediction,
  StockCardData,
  StockInsight,
} from "@/types/insight";

/**
 * For a user's watchlist, fetch the most-recent stock_insight per stock plus
 * the top-ranked insight_article (display_rank=1) for each.
 *
 * Returns StockCardData[] in the same order as the input watchlist.
 */
export async function fetchHomeFeed(
  client: SupabaseClient,
  watchlistStocks: {
    id: string;
    ticker: string;
    name: string;
    sector: string;
    sub_sector: string | null;
  }[],
): Promise<StockCardData[]> {
  if (watchlistStocks.length === 0) return [];

  const stockIds = watchlistStocks.map((s) => s.id);

  // Pull the most-recent stock_insight per stock.
  // Postgres `distinct on` would be ideal but PostgREST doesn't expose it
  // directly; the order+limit per stock would need an RPC. For our scale
  // (≤15 stocks per user) we just fetch all recent rows and pick latest in JS.
  const { data: insightRows, error: insightErr } = await client
    .from("stock_insights")
    .select("*")
    .in("stock_id", stockIds)
    .order("insight_date", { ascending: false });

  if (insightErr) {
    throw new Error(`fetchHomeFeed insights: ${insightErr.message}`);
  }

  const latestByStock = new Map<string, StockInsight>();
  for (const row of (insightRows ?? []) as StockInsight[]) {
    if (!latestByStock.has(row.stock_id)) {
      latestByStock.set(row.stock_id, row);
    }
  }

  // Fetch top articles (display_rank=1) for those insights in one round-trip.
  const insightIds = Array.from(latestByStock.values()).map((i) => i.id);
  const articleByInsight = new Map<string, InsightArticle>();
  const verdictByStock = new Map<string, MarketMindPrediction>();
  if (insightIds.length > 0) {
    const [articlesRes, verdictsRes] = await Promise.all([
      client
        .from("insight_articles")
        .select("*")
        .in("insight_id", insightIds)
        .eq("display_rank", 1),
      client.from("marketmind_predictions").select("*").in("insight_id", insightIds),
    ]);
    if (articlesRes.error) {
      throw new Error(`fetchHomeFeed articles: ${articlesRes.error.message}`);
    }
    if (verdictsRes.error) {
      throw new Error(`fetchHomeFeed verdicts: ${verdictsRes.error.message}`);
    }
    for (const row of (articlesRes.data ?? []) as InsightArticle[]) {
      articleByInsight.set(row.insight_id, row);
    }
    for (const row of (verdictsRes.data ?? []) as MarketMindPrediction[]) {
      verdictByStock.set(row.stock_id, row);
    }
  }

  return watchlistStocks.map((stock) => {
    const insight = latestByStock.get(stock.id) ?? null;
    const topArticle = insight ? (articleByInsight.get(insight.id) ?? null) : null;
    const verdict = verdictByStock.get(stock.id) ?? null;
    return { stock, insight, topArticle, verdict };
  });
}

/**
 * Track-record stats across all resolved MarketMind predictions.
 * Always include sample size — small samples are noisy.
 */
export async function fetchTrackRecord(
  client: SupabaseClient,
  windowDays = 30,
): Promise<{ total: number; correct: number; accuracy: number | null }> {
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString().slice(0, 10);

  const { data, error } = await client
    .from("marketmind_predictions")
    .select("outcome")
    .eq("resolved", true)
    .gte("prediction_date", since)
    .neq("outcome", "VOID");

  if (error) {
    throw new Error(`fetchTrackRecord: ${error.message}`);
  }
  const rows = data ?? [];
  const total = rows.length;
  const correct = rows.filter((r: { outcome: string | null }) => r.outcome === "WIN").length;
  const accuracy = total > 0 ? correct / total : null;
  return { total, correct, accuracy };
}

/**
 * Rank a feed list by absolute signal strength: cards with stronger
 * directional signals float to the top. Cards with no insight sink to the
 * bottom (still rendered so the user knows we're working on them).
 */
export function rankFeed(feed: StockCardData[]): StockCardData[] {
  return [...feed].sort((a, b) => {
    const strength = (d: StockCardData) => {
      if (!d.insight) return -Infinity;
      const scores = [
        d.insight.technical_score,
        d.insight.sentiment_score,
        d.insight.professional_score,
        d.insight.social_score,
      ].filter((v): v is number => v != null);
      if (!scores.length) return 0;
      // Max absolute signal — what's the loudest single bucket?
      return Math.max(...scores.map(Math.abs));
    };
    return strength(b) - strength(a);
  });
}
