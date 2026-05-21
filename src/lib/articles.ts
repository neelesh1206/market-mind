import type { InsightArticle } from "@/types/insight";

/**
 * Relevance filter for article cards.
 *
 * The news fetchers occasionally drag in articles that mention a ticker
 * in passing (sector pieces, comparables, M&A coverage of an adjacent
 * company) but aren't actually *about* that stock. The pipeline's LLM
 * summary step correctly identifies these — the TL;DR field says things
 * like "CVX stock not mentioned in the article" or "X unaffected by Y's
 * acquisition." We just weren't filtering on it.
 *
 * Strategy: scan the TL;DR for explicit irrelevance phrases (the LLM is
 * remarkably consistent about how it phrases this). Falls through to
 * "relevant" by default — we'd rather show a borderline article than
 * silently drop a real one.
 *
 * Why not filter on signal_influence ("Neutral — no direct signal")?
 * That phrase shows up on genuinely relevant articles too — when the LLM
 * decides a Chevron-vs-Devon comparison is bullish-ish on Chevron but
 * doesn't move the needle, it'll write "Neutral — no direct signal, but
 * Chevron's stable long-term investment profile may..." Dropping all
 * "no direct signal" articles would over-filter. TL;DR is the cleaner
 * source of truth for *aboutness*.
 */
const IRRELEVANCE_PATTERNS = [
  "not mentioned",
  "unaffected",
  "does not affect",
  "doesn't affect",
  "no direct mention",
  "not directly affected",
  "not directly mentioned",
  "no mention of",
] as const;

export function isArticleRelevant(article: InsightArticle): boolean {
  const tldr = (article.tldr ?? "").toLowerCase();
  if (!tldr) {
    // No TL;DR yet (LLM didn't process or stored null) — keep, since we
    // have no signal either way.
    return true;
  }
  for (const phrase of IRRELEVANCE_PATTERNS) {
    if (tldr.includes(phrase)) return false;
  }
  return true;
}

/**
 * Given an array of articles for one insight, pick the highest-ranked
 * one that's actually about the stock. Returns null if nothing qualifies.
 *
 * Callers should fetch top-N rows (lte display_rank N) per insight so we
 * have fallbacks when the rank-1 article happens to be irrelevant —
 * otherwise the card or detail page drops the article entirely when only
 * one was fetched.
 */
export function pickTopRelevantArticle(articles: InsightArticle[]): InsightArticle | null {
  // Assumes input is sorted by display_rank ascending. Defensive sort.
  const sorted = [...articles].sort(
    (a, b) => (a.display_rank ?? Infinity) - (b.display_rank ?? Infinity),
  );
  return sorted.find(isArticleRelevant) ?? null;
}
