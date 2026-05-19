import Link from "next/link";
import { ArrowDown, ArrowUp, ExternalLink, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnalystBar } from "@/components/analyst-bar";
import { SignalBar } from "@/components/signal-bar";
import { SignalStrip } from "@/components/signal-strip";
import { StrongSignalBadge } from "@/components/strong-signal-badge";
import { cn } from "@/lib/utils";
import type { StockCardData } from "@/types/insight";

type Props = {
  data: StockCardData;
};

/**
 * Compact stock card for the home feed.
 *
 * Renders the 4 signal buckets (technical / sentiment / professional / social),
 * the top article with TL;DR + signal influence framing, and prediction CTAs.
 *
 * The full per-signal breakdown lives on /stock/[ticker]. This card is
 * intentionally dense-but-scannable — every row earns its place.
 */
export function StockCard({ data }: Props) {
  const { stock, insight, topArticle } = data;

  return (
    <article
      className={cn(
        "group bg-card relative overflow-hidden rounded-2xl border transition-colors",
        "border-border/60 hover:border-border",
      )}
    >
      {/* Header: ticker + name + price */}
      <header className="border-border/40 border-b px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="font-mono text-xl font-semibold tracking-tight">{stock.ticker}</h2>
              <StrongSignalBadge
                scores={[
                  insight?.technical_score ?? null,
                  insight?.sentiment_score ?? null,
                  insight?.professional_score ?? null,
                  insight?.social_score ?? null,
                ]}
              />
            </div>
            <p className="text-muted-foreground truncate text-sm">{stock.name}</p>
            <p className="text-muted-foreground/80 text-[10px] tracking-wider uppercase">
              {stock.sector}
              {stock.sub_sector && (
                <>
                  <span className="mx-1.5 opacity-50">·</span>
                  {stock.sub_sector}
                </>
              )}
            </p>
          </div>

          <div className="shrink-0 space-y-1 text-right">
            <p className="font-mono text-xl font-semibold tabular-nums">
              {insight?.prev_close != null ? `$${insight.prev_close.toFixed(2)}` : "—"}
            </p>
            <PriceChip pct={insight?.week_change_pct} suffix="wk" />
            {insight && (
              <div className="flex justify-end pt-1">
                <SignalStrip
                  technical={insight.technical_score}
                  sentiment={insight.sentiment_score}
                  professional={insight.professional_score}
                  social={insight.social_score}
                />
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Signals */}
      <section className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
        <SignalBar
          variant="technical"
          label="Technical"
          score={insight?.technical_score ?? null}
          detail={technicalDetail(insight)}
        />
        <SignalBar
          variant="sentiment"
          label="Sentiment"
          score={insight?.sentiment_score ?? null}
          detail={sentimentDetail(insight)}
        />
        <SignalBar
          variant="professional"
          label="Professional"
          score={insight?.professional_score ?? null}
          detail={professionalDetail(insight)}
        />
        <SignalBar
          variant="social"
          label="Social"
          score={insight?.social_score ?? null}
          detail={socialDetail(insight)}
        />
      </section>

      {/* Analyst rating bar — only when we have data */}
      {insight && (insight.analyst_buy || insight.analyst_hold || insight.analyst_sell) && (
        <section className="border-border/40 border-t px-5 py-3">
          <AnalystBar
            buy={insight.analyst_buy}
            hold={insight.analyst_hold}
            sell={insight.analyst_sell}
            compact
          />
        </section>
      )}

      {/* Top article with TL;DR + influence */}
      {topArticle && (topArticle.tldr || topArticle.signal_influence) && (
        <section className="border-border/40 bg-muted/30 space-y-2 border-t px-5 py-4">
          {topArticle.tldr && (
            <p className="text-foreground/90 text-sm leading-snug">
              <span className="text-muted-foreground">&ldquo;</span>
              {topArticle.tldr}
              <span className="text-muted-foreground">&rdquo;</span>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            {topArticle.source && (
              <span className="text-muted-foreground">— {topArticle.source}</span>
            )}
            {topArticle.published_at && (
              <span className="text-muted-foreground">{timeAgo(topArticle.published_at)}</span>
            )}
            {topArticle.url && (
              <a
                href={topArticle.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground/80 hover:text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
              >
                Read <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            )}
          </div>
          {topArticle.signal_influence && (
            <p
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs leading-snug font-medium",
                influenceTone(topArticle.signal_influence),
              )}
            >
              <span className="opacity-60">→ </span>
              {topArticle.signal_influence}
            </p>
          )}
        </section>
      )}

      {/* Footer: sources + CTAs */}
      <footer className="border-border/40 flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
        <div className="text-muted-foreground flex items-center gap-3 text-[11px]">
          {insight?.sources_total_count != null && (
            <span>{insight.sources_total_count} sources</span>
          )}
          {insight?.computed_at && <span>· updated {timeAgo(insight.computed_at)}</span>}
          <Link
            href={`/stock/${stock.ticker}`}
            className="text-foreground/80 hover:text-foreground ml-1 underline-offset-2 hover:underline"
          >
            Details →
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <BetButton direction="UP" Icon={ArrowUp} />
          <BetButton direction="DOWN" Icon={ArrowDown} />
        </div>
      </footer>
    </article>
  );
}

/* ------------------------- subcomponents & helpers ------------------------ */

function BetButton({ direction, Icon }: { direction: "UP" | "DOWN"; Icon: LucideIcon }) {
  // Wired to the bet sheet in Task #36. For now, a disabled placeholder so the
  // visual stays accurate.
  return (
    <Button
      variant={direction === "UP" ? "default" : "outline"}
      size="sm"
      className={cn(
        "h-8 gap-1 font-mono",
        direction === "UP"
          ? "bg-emerald-600 text-white hover:bg-emerald-600/90"
          : "border-red-500/50 text-red-500 hover:bg-red-500/10",
      )}
      disabled
      title="Bet placement comes online in Day 3 finale"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden /> {direction}
    </Button>
  );
}

function PriceChip({ pct, suffix }: { pct: number | null | undefined; suffix: string }) {
  if (pct == null) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  const up = pct > 0;
  const flat = Math.abs(pct) < 0.005;
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums",
        flat
          ? "text-muted-foreground bg-muted"
          : up
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "bg-red-500/10 text-red-600 dark:text-red-400",
      )}
    >
      <span aria-hidden>{up && !flat ? "▲" : !flat ? "▼" : "·"}</span>
      <span>
        {up ? "+" : ""}
        {pct.toFixed(2)}%
      </span>
      <span className="opacity-60">{suffix}</span>
    </span>
  );
}

/** Map FinBERT influence framing to a colored chip background. */
function influenceTone(influence: string): string {
  const lower = influence.toLowerCase();
  if (lower.startsWith("bullish")) {
    return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  }
  if (lower.startsWith("bearish")) {
    return "bg-red-500/10 text-red-600 dark:text-red-400";
  }
  return "bg-muted text-muted-foreground";
}

/* ------------------------- detail-line builders --------------------------- */

function technicalDetail(insight: StockCardData["insight"]): string | null {
  if (!insight) return null;
  const parts: string[] = [];
  if (insight.rsi_14 != null) parts.push(`RSI ${insight.rsi_14.toFixed(0)}`);
  if (insight.macd_signal && insight.macd_signal !== "neutral") {
    parts.push(insight.macd_signal === "bullish_crossover" ? "MACD bullish" : "MACD bearish");
  }
  if (insight.price_vs_20ma) parts.push(`${insight.price_vs_20ma} 20-MA`);
  return parts.join(" · ") || null;
}

function sentimentDetail(insight: StockCardData["insight"]): string | null {
  if (!insight) return null;
  const parts: string[] = [];
  if (insight.news_article_count != null) {
    parts.push(`${insight.news_article_count} articles`);
  }
  if (insight.sources_agree_count != null && insight.sources_total_count != null) {
    parts.push(`${insight.sources_agree_count}/${insight.sources_total_count} agree`);
  }
  return parts.join(" · ") || null;
}

function professionalDetail(insight: StockCardData["insight"]): string | null {
  if (!insight) return null;
  const parts: string[] = [];
  if (insight.analyst_buy != null && insight.analyst_count != null) {
    parts.push(`${insight.analyst_buy} Buy of ${insight.analyst_count}`);
  }
  if (insight.insider_activity && insight.insider_activity !== "neutral") {
    parts.push(`Insider ${insight.insider_activity}`);
  }
  if (insight.earnings_in_days != null && insight.earnings_in_days <= 14) {
    parts.push(`Earnings in ${insight.earnings_in_days}d`);
  }
  return parts.join(" · ") || null;
}

function socialDetail(insight: StockCardData["insight"]): string | null {
  if (!insight) return null;
  const parts: string[] = [];
  if (insight.stocktwits_bullish != null) {
    parts.push(`${insight.stocktwits_bullish.toFixed(0)}% bullish on StockTwits`);
  }
  if (insight.apewisdom_rank != null && insight.apewisdom_rank <= 20) {
    parts.push(`WSB #${insight.apewisdom_rank}`);
  }
  if (insight.reddit_mention_delta != null && Math.abs(insight.reddit_mention_delta) > 50) {
    parts.push(
      `Mentions ${insight.reddit_mention_delta > 0 ? "+" : ""}${insight.reddit_mention_delta.toFixed(0)}%`,
    );
  }
  return parts.join(" · ") || null;
}

/** Simple relative time formatter — avoids pulling in date-fns just for this. */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(iso).toLocaleDateString();
}
