import type { SupabaseClient } from "@supabase/supabase-js";
import type { InsightArticle, MarketMindPrediction, StockInsight } from "@/types/insight";

export type StockDetail = {
  stock: {
    id: string;
    ticker: string;
    name: string;
    sector: string;
    sub_sector: string | null;
    market_cap_tier: string | null;
    description: string | null;
  };
  insight: StockInsight | null;
  articles: InsightArticle[];
  verdict: MarketMindPrediction | null;
};

/**
 * Fetch everything we need to render /stock/[ticker]:
 * stock metadata + latest insight + all top-ranked articles for that insight.
 *
 * Returns null when the ticker isn't in our active pool.
 */
export async function fetchStockDetail(
  client: SupabaseClient,
  ticker: string,
): Promise<StockDetail | null> {
  const upper = ticker.toUpperCase();

  const { data: stockRow, error: stockErr } = await client
    .from("stocks")
    .select("id, ticker, name, sector, sub_sector, market_cap_tier, description")
    .eq("ticker", upper)
    .eq("is_active", true)
    .maybeSingle();

  if (stockErr) {
    throw new Error(`fetchStockDetail stock: ${stockErr.message}`);
  }
  if (!stockRow) return null;

  // Most recent insight for this stock (LIMIT 1)
  const { data: insightRows, error: insightErr } = await client
    .from("stock_insights")
    .select("*")
    .eq("stock_id", stockRow.id)
    .order("insight_date", { ascending: false })
    .limit(1);
  if (insightErr) {
    throw new Error(`fetchStockDetail insight: ${insightErr.message}`);
  }
  const insight = ((insightRows ?? []) as StockInsight[])[0] ?? null;

  let articles: InsightArticle[] = [];
  let verdict: MarketMindPrediction | null = null;
  if (insight) {
    const [articlesRes, verdictRes] = await Promise.all([
      client
        .from("insight_articles")
        .select("*")
        .eq("insight_id", insight.id)
        .order("display_rank", { ascending: true, nullsFirst: false }),
      client.from("marketmind_predictions").select("*").eq("insight_id", insight.id).maybeSingle(),
    ]);
    if (articlesRes.error) {
      throw new Error(`fetchStockDetail articles: ${articlesRes.error.message}`);
    }
    if (verdictRes.error) {
      // Defensive: marketmind_predictions table may not exist pre-migration.
      console.warn(
        `[stock-detail] verdict query failed (likely migration not applied): ${verdictRes.error.message}`,
      );
    } else {
      verdict = (verdictRes.data as MarketMindPrediction | null) ?? null;
    }
    articles = (articlesRes.data ?? []) as InsightArticle[];
  }

  return {
    stock: stockRow,
    insight,
    articles,
    verdict,
  };
}
