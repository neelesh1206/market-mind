import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, Star, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConvictionEntry } from "@/lib/feed";

type Props = {
  long: ConvictionEntry[];
  short: ConvictionEntry[];
  /** Tickers in the current user's watchlist — flagged with a star + tone shift. */
  watchlistTickers: Set<string>;
};

/**
 * "Today's conviction" — surfaces MarketMind's strongest reads across the
 * full universe (not just the user's watchlist), sourced from
 * marketmind_predictions.rank_in_universe (ADR 0015).
 *
 * Rank 1 = strongest bullish (top of the "Long" column).
 * Rank N = strongest bearish (top of the "Short" column).
 *
 * Stocks already in the user's watchlist are marked with a star + small
 * tone shift so the surface acts as both discovery (stocks you don't yet
 * follow) and personalized context (today's conviction within your
 * watchlist).
 *
 * Renders nothing if both sides are empty — caller decides whether to
 * show a placeholder instead (e.g. before the day's pipeline ranks).
 */
export function ConvictionList({ long, short, watchlistTickers }: Props) {
  if (long.length === 0 && short.length === 0) {
    return (
      <section className="border-border/60 bg-card/30 space-y-2 rounded-xl border p-5">
        <header className="flex items-center gap-2">
          <TrendingUp className="text-muted-foreground h-4 w-4" aria-hidden />
          <h2 className="text-sm font-semibold">Today&apos;s conviction</h2>
        </header>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Cross-sectional ranks aren&apos;t available yet for this trading day. The pipeline
          ranks at the end of each nightly run — check back after 8:25 PM ET.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <TrendingUp className="text-muted-foreground h-4 w-4" aria-hidden />
          <h2 className="text-sm font-semibold">Today&apos;s conviction</h2>
        </div>
        <p className="text-muted-foreground text-xs leading-relaxed">
          MarketMind&apos;s strongest reads ranked across the full 50-stock universe. Stars
          mark stocks already on your watchlist.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ConvictionColumn
          title="Highest conviction long"
          entries={long}
          tone="long"
          watchlistTickers={watchlistTickers}
        />
        <ConvictionColumn
          title="Highest conviction short"
          entries={short}
          tone="short"
          watchlistTickers={watchlistTickers}
        />
      </div>
    </section>
  );
}

function ConvictionColumn({
  title,
  entries,
  tone,
  watchlistTickers,
}: {
  title: string;
  entries: ConvictionEntry[];
  tone: "long" | "short";
  watchlistTickers: Set<string>;
}) {
  const accent =
    tone === "long" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";

  return (
    <div className="border-border/60 bg-card/30 overflow-hidden rounded-xl border">
      <div className="border-border/40 flex items-center justify-between border-b px-4 py-2">
        <span className={cn("text-[10px] font-medium tracking-wider uppercase", accent)}>
          {title}
        </span>
        <span className="text-muted-foreground text-[10px]">{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <p className="text-muted-foreground p-4 text-xs">No qualifying entries yet.</p>
      ) : (
        <ul className="divide-border/40 divide-y">
          {entries.map((entry) => (
            <ConvictionRow
              key={entry.ticker}
              entry={entry}
              isWatching={watchlistTickers.has(entry.ticker)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ConvictionRow({ entry, isWatching }: { entry: ConvictionEntry; isWatching: boolean }) {
  const Icon =
    entry.direction === "UP" ? ArrowUp : entry.direction === "DOWN" ? ArrowDown : ArrowRight;

  const directionTone =
    entry.direction === "UP"
      ? "text-emerald-600 dark:text-emerald-400"
      : entry.direction === "DOWN"
        ? "text-red-600 dark:text-red-400"
        : "text-muted-foreground";

  const scoreTone =
    entry.combined_score > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : entry.combined_score < 0
        ? "text-red-600 dark:text-red-400"
        : "text-muted-foreground";

  return (
    <li>
      <Link
        href={`/stock/${entry.ticker}`}
        className={cn(
          "hover:bg-muted/30 flex items-center gap-3 px-4 py-2.5 transition-colors",
          isWatching && "bg-emerald-500/[0.03]",
        )}
      >
        {/* Rank badge */}
        <span
          className={cn(
            "bg-muted text-muted-foreground inline-flex h-6 w-8 shrink-0 items-center justify-center rounded-md font-mono text-[10px] tabular-nums",
          )}
          aria-label={`Rank ${entry.rank_in_universe}`}
        >
          #{entry.rank_in_universe}
        </span>

        {/* Ticker + name */}
        <div className="flex-1 overflow-hidden">
          <div className="flex items-center gap-1.5">
            <span className="text-foreground font-mono text-sm font-semibold">
              {entry.ticker}
            </span>
            {isWatching && (
              <Star
                className="h-3 w-3 fill-amber-500 text-amber-500"
                aria-label="In your watchlist"
              />
            )}
          </div>
          <p className="text-muted-foreground truncate text-[11px] leading-tight">{entry.name}</p>
        </div>

        {/* Direction + combined_score */}
        <div className="flex shrink-0 items-center gap-2">
          <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", directionTone)}>
            <Icon className="h-3 w-3" aria-hidden />
            {entry.direction}
          </span>
          <span className={cn("font-mono text-xs tabular-nums", scoreTone)}>
            {entry.combined_score >= 0 ? "+" : ""}
            {entry.combined_score.toFixed(2)}
          </span>
        </div>
      </Link>
    </li>
  );
}
