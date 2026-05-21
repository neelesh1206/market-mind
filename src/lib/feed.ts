import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  InsightArticle,
  MarketMindPrediction,
  StockCardData,
  StockInsight,
} from "@/types/insight";
import { pickTopRelevantArticle } from "@/lib/articles";
import { computeSyntheticVerdict } from "@/lib/verdict";
import { wilsonInterval } from "@/lib/wilson";

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

  // Fetch top-3 articles per insight so we can pick the highest-ranked
  // *relevant* one — the rank-1 article is occasionally off-topic (sector
  // pieces, comparables) and would leave the card with no article block if
  // we only fetched display_rank=1. Top-3 is plenty of fallback at 3x rows.
  const insightIds = Array.from(latestByStock.values()).map((i) => i.id);
  const articleByInsight = new Map<string, InsightArticle>();
  const verdictByStock = new Map<string, MarketMindPrediction>();
  if (insightIds.length > 0) {
    const [articlesRes, verdictsRes] = await Promise.all([
      client
        .from("insight_articles")
        .select("*")
        .in("insight_id", insightIds)
        .lte("display_rank", 3),
      // Defensive: the marketmind_predictions table is a recent migration;
      // a missing-table error here shouldn't 500 the whole feed.
      client.from("marketmind_predictions").select("*").in("insight_id", insightIds),
    ]);
    if (articlesRes.error) {
      throw new Error(`fetchHomeFeed articles: ${articlesRes.error.message}`);
    }
    if (verdictsRes.error) {
      console.warn(
        `[feed] marketmind_predictions query failed (likely migration not applied): ${verdictsRes.error.message}`,
      );
    } else {
      for (const row of (verdictsRes.data ?? []) as MarketMindPrediction[]) {
        verdictByStock.set(row.stock_id, row);
      }
    }
    // Bucket by insight_id, then pick the first relevant article per insight.
    const articlesByInsight = new Map<string, InsightArticle[]>();
    for (const row of (articlesRes.data ?? []) as InsightArticle[]) {
      const arr = articlesByInsight.get(row.insight_id) ?? [];
      arr.push(row);
      articlesByInsight.set(row.insight_id, arr);
    }
    for (const [insightId, arr] of articlesByInsight) {
      const top = pickTopRelevantArticle(arr);
      if (top) articleByInsight.set(insightId, top);
    }
  }

  return watchlistStocks.map((stock) => {
    const insight = latestByStock.get(stock.id) ?? null;
    const topArticle = insight ? (articleByInsight.get(insight.id) ?? null) : null;
    // Stored verdict wins when it exists (carries reasoning + resolution outcome).
    // Otherwise synthesize one from the bucket scores so the UI always has a prediction to show.
    const verdict =
      verdictByStock.get(stock.id) ?? (insight ? computeSyntheticVerdict(insight) : null);
    return { stock, insight, topArticle, verdict };
  });
}

/**
 * One entry in the conviction list. Shape is intentionally small —
 * we only need what the row renders.
 */
export type ConvictionEntry = {
  ticker: string;
  name: string;
  direction: "UP" | "DOWN" | "NEUTRAL";
  combined_score: number;
  rank_in_universe: number;
};

export type ConvictionList = {
  long: ConvictionEntry[];   // rank 1, 2, 3 ... (strongest bullish first)
  short: ConvictionEntry[];  // rank N, N-1, N-2 ... (strongest bearish first)
};

/**
 * MarketMind's strongest reads across the universe for a given trading day.
 *
 * Cross-sectional ranking (ADR 0015) gives every stock a `rank_in_universe`:
 * 1 = highest combined_score (strongest bullish), N = lowest (strongest
 * bearish). This helper returns the top-N from each end so the home page
 * can render a "today's conviction" surface independent of any individual
 * user's watchlist.
 *
 * Returns empty arrays if the pipeline hasn't ranked the universe yet
 * for that date — caller decides whether to render an empty state.
 */
export async function fetchConvictionList(
  client: SupabaseClient,
  tradingDayLabel: string,
  count = 5,
): Promise<ConvictionList> {
  // Two small queries instead of one big sort-in-JS pass — both indexed
  // by (prediction_date, rank_in_universe) per migration 20260519000010.
  const baseSelect =
    "direction, combined_score, rank_in_universe, stocks(ticker, name)";

  const [longRes, shortRes] = await Promise.all([
    client
      .from("marketmind_predictions")
      .select(baseSelect)
      .eq("prediction_date", tradingDayLabel)
      .not("rank_in_universe", "is", null)
      .order("rank_in_universe", { ascending: true })
      .limit(count),
    client
      .from("marketmind_predictions")
      .select(baseSelect)
      .eq("prediction_date", tradingDayLabel)
      .not("rank_in_universe", "is", null)
      .order("rank_in_universe", { ascending: false })
      .limit(count),
  ]);

  if (longRes.error) {
    console.warn(`[conviction] long-side query failed: ${longRes.error.message}`);
  }
  if (shortRes.error) {
    console.warn(`[conviction] short-side query failed: ${shortRes.error.message}`);
  }

  type Row = {
    direction: "UP" | "DOWN" | "NEUTRAL";
    combined_score: number | null;
    rank_in_universe: number | null;
    stocks: { ticker: string; name: string } | null;
  };

  const toEntry = (r: Row): ConvictionEntry | null => {
    if (!r.stocks || r.combined_score === null || r.rank_in_universe === null) {
      return null;
    }
    return {
      ticker: r.stocks.ticker,
      name: r.stocks.name,
      direction: r.direction,
      combined_score: r.combined_score,
      rank_in_universe: r.rank_in_universe,
    };
  };

  const long = ((longRes.data ?? []) as unknown as Row[])
    .map(toEntry)
    .filter((e): e is ConvictionEntry => e !== null);
  const short = ((shortRes.data ?? []) as unknown as Row[])
    .map(toEntry)
    .filter((e): e is ConvictionEntry => e !== null);

  return { long, short };
}

/**
 * Track-record stats across all resolved MarketMind predictions.
 * Always include sample size — small samples are noisy.
 */
/**
 * Result of a track-record query — point estimate plus Wilson 95% CI.
 * `ciLower`/`ciUpper` are null when `total = 0` (no information).
 */
export type TrackRecord = {
  total: number;
  correct: number;
  accuracy: number | null;
  ciLower: number | null;
  ciUpper: number | null;
};

export async function fetchTrackRecord(
  client: SupabaseClient,
  windowDays = 30,
): Promise<TrackRecord> {
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString().slice(0, 10);

  const { data, error } = await client
    .from("marketmind_predictions")
    .select("outcome")
    .eq("resolved", true)
    .gte("prediction_date", since)
    .neq("outcome", "VOID");

  if (error) {
    // Defensive: pre-migration the table may not exist yet. Report empty
    // track record rather than blowing up the page that called us.
    console.warn(`[feed] fetchTrackRecord failed (likely migration not applied): ${error.message}`);
    return { total: 0, correct: 0, accuracy: null, ciLower: null, ciUpper: null };
  }
  const rows = data ?? [];
  const total = rows.length;
  const correct = rows.filter((r: { outcome: string | null }) => r.outcome === "WIN").length;
  const accuracy = total > 0 ? correct / total : null;
  const ci = total > 0 ? wilsonInterval(correct, total) : null;
  return {
    total,
    correct,
    accuracy,
    ciLower: ci?.lower ?? null,
    ciUpper: ci?.upper ?? null,
  };
}

/**
 * Per-stock track record across all resolved verdicts for one stock.
 *
 * Surfaces on `/stock/[ticker]` as accountability ("MarketMind has been
 * right N of M times on AAPL specifically"). VOID outcomes drop out of
 * the denominator the same way as the universe-wide track record.
 */
export async function fetchStockTrackRecord(
  client: SupabaseClient,
  stockId: string,
): Promise<TrackRecord> {
  const { data, error } = await client
    .from("marketmind_predictions")
    .select("outcome")
    .eq("stock_id", stockId)
    .eq("resolved", true)
    .neq("outcome", "VOID");

  if (error) {
    console.warn(`[feed] fetchStockTrackRecord failed: ${error.message}`);
    return { total: 0, correct: 0, accuracy: null, ciLower: null, ciUpper: null };
  }
  const rows = data ?? [];
  const total = rows.length;
  const correct = rows.filter((r: { outcome: string | null }) => r.outcome === "WIN").length;
  const accuracy = total > 0 ? correct / total : null;
  const ci = total > 0 ? wilsonInterval(correct, total) : null;
  return {
    total,
    correct,
    accuracy,
    ciLower: ci?.lower ?? null,
    ciUpper: ci?.upper ?? null,
  };
}

/**
 * Rank a feed list by absolute signal strength: cards with stronger
 * directional signals float to the top. Cards with no insight sink to the
 * bottom (still rendered so the user knows we're working on them).
 */
/**
 * For the logged-out /login preview. Picks the top N highest-confidence
 * verdicts for the current trading day, joined with stock + latest insight
 * + top article — a teaser of what the user sees after signing up.
 *
 * Anon-readable: stocks/stock_insights/insight_articles/marketmind_predictions
 * all have public_read RLS policies.
 *
 * Returns [] on any error (or no verdicts today) — login page should never
 * hard-fail because a downstream table is empty.
 */
export async function fetchTopVerdictsForPreview(
  client: SupabaseClient,
  n = 2,
): Promise<StockCardData[]> {
  // Pull top-N verdicts by confidence. The most-recent batch is what we want
  // — order by prediction_date desc, then confidence desc, limit N.
  const { data: verdictRows, error: vErr } = await client
    .from("marketmind_predictions")
    .select("*, stocks(id, ticker, name, sector, sub_sector)")
    .order("prediction_date", { ascending: false })
    .order("confidence", { ascending: false })
    .limit(n);

  if (vErr || !verdictRows || verdictRows.length === 0) {
    if (vErr) {
      console.warn(`[preview] verdicts query failed: ${vErr.message}`);
    }
    return [];
  }

  type Row = MarketMindPrediction & {
    stocks: { id: string; ticker: string; name: string; sector: string; sub_sector: string | null } | null;
  };
  const rows = verdictRows as unknown as Row[];

  const insightIds = rows.map((r) => r.insight_id);
  const [insightRes, articleRes] = await Promise.all([
    client.from("stock_insights").select("*").in("id", insightIds),
    // Fetch top-3 per insight so we can fall back when rank-1 is off-topic.
    client.from("insight_articles").select("*").in("insight_id", insightIds).lte("display_rank", 3),
  ]);

  const insightById = new Map<string, StockInsight>();
  for (const row of (insightRes.data ?? []) as StockInsight[]) {
    insightById.set(row.id, row);
  }
  const articleByInsight = new Map<string, InsightArticle>();
  {
    const grouped = new Map<string, InsightArticle[]>();
    for (const row of (articleRes.data ?? []) as InsightArticle[]) {
      const arr = grouped.get(row.insight_id) ?? [];
      arr.push(row);
      grouped.set(row.insight_id, arr);
    }
    for (const [insightId, arr] of grouped) {
      const top = pickTopRelevantArticle(arr);
      if (top) articleByInsight.set(insightId, top);
    }
  }

  return rows
    .filter((r) => r.stocks !== null)
    .map((r) => {
      const stock = r.stocks!;
      const insight = insightById.get(r.insight_id) ?? null;
      const topArticle = articleByInsight.get(r.insight_id) ?? null;
      return { stock, insight, topArticle, verdict: r } as StockCardData;
    });
}

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
