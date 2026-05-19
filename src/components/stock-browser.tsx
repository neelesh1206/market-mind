"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Loader2, Plus, Search, SearchX, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { addToWatchlist, removeFromWatchlist } from "@/app/actions/watchlist";
import type { Stock } from "@/lib/watchlist";

type Props = {
  stocks: Stock[];
  initialWatchlistIds: string[];
  watchlistMax: number;
};

const ALL_SECTORS = "All";

/**
 * Full pool browser. Client-side search + sector filter (50 stocks is small
 * enough that no server-side index is needed). Per-row add/remove uses
 * granular server actions that enforce the cap server-side too.
 *
 * Optimistic UI: toggle flips locally on click, server action runs in a
 * transition, error toasts undo the optimistic state. revalidatePath
 * triggered server-side keeps the home feed in sync.
 */
export function StockBrowser({ stocks, initialWatchlistIds, watchlistMax }: Props) {
  const [watchlistIds, setWatchlistIds] = useState<Set<string>>(
    () => new Set(initialWatchlistIds),
  );
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState(ALL_SECTORS);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const sectors = useMemo(() => {
    const set = new Set<string>();
    for (const s of stocks) set.add(s.sector);
    return [ALL_SECTORS, ...Array.from(set).sort()];
  }, [stocks]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stocks.filter((s) => {
      if (sector !== ALL_SECTORS && s.sector !== sector) return false;
      if (!q) return true;
      return s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
    });
  }, [stocks, query, sector]);

  function handleToggle(stock: Stock) {
    const isIn = watchlistIds.has(stock.id);

    // Optimistic flip.
    setWatchlistIds((prev) => {
      const next = new Set(prev);
      if (isIn) next.delete(stock.id);
      else next.add(stock.id);
      return next;
    });
    setPendingId(stock.id);

    startTransition(async () => {
      const result = isIn
        ? await removeFromWatchlist(stock.id)
        : await addToWatchlist(stock.id);
      setPendingId(null);

      if (!result.ok) {
        // Undo optimistic state.
        setWatchlistIds((prev) => {
          const next = new Set(prev);
          if (isIn) next.add(stock.id);
          else next.delete(stock.id);
          return next;
        });
        toast.error(result.error);
        return;
      }
      toast.success(
        isIn
          ? `${stock.ticker} removed from watchlist`
          : `${stock.ticker} added to watchlist`,
      );
    });
  }

  const watchlistCount = watchlistIds.size;
  const atCap = watchlistCount >= watchlistMax;

  return (
    <div className="space-y-4">
      {/* Search + counter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ticker or company name…"
            className="border-border bg-card focus-visible:ring-ring h-9 w-full rounded-md border pr-9 pl-9 text-sm focus-visible:ring-2 focus-visible:outline-none"
            aria-label="Search stocks"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div
          className={cn(
            "text-muted-foreground shrink-0 text-xs tabular-nums",
            atCap && "text-amber-500",
          )}
        >
          <span className="text-foreground font-mono font-semibold">{watchlistCount}</span> /{" "}
          {watchlistMax} on watchlist
          {atCap && <span className="ml-2 text-[11px]">· cap reached</span>}
        </div>
      </div>

      {/* Sector pills */}
      <div className="flex flex-wrap gap-1.5">
        {sectors.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSector(s)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              sector === s
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card hover:border-foreground/40",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No stocks match"
          description={
            query
              ? `Nothing in the pool matched "${query}". Try a different ticker or company name.`
              : "Try another sector or clear filters."
          }
        />
      ) : (
        <ul className="divide-border/40 border-border/60 bg-card/30 divide-y rounded-xl border">
          {visible.map((s) => {
            const isIn = watchlistIds.has(s.id);
            const isPending = pendingId === s.id;
            return (
              <StockRow
                key={s.id}
                stock={s}
                inWatchlist={isIn}
                isPending={isPending}
                atCap={atCap}
                onToggle={() => handleToggle(s)}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StockRow({
  stock,
  inWatchlist,
  isPending,
  atCap,
  onToggle,
}: {
  stock: Stock;
  inWatchlist: boolean;
  isPending: boolean;
  atCap: boolean;
  onToggle: () => void;
}) {
  const blockedFromAdding = atCap && !inWatchlist;
  return (
    <li className="hover:bg-card/60 flex items-center gap-3 px-4 py-3 transition-colors">
      <Link
        href={`/stock/${stock.ticker}`}
        className="hover:text-foreground flex min-w-0 flex-1 items-center gap-3"
      >
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-sm font-semibold">{stock.ticker}</span>
            <span className="text-muted-foreground truncate text-xs">{stock.name}</span>
          </div>
          <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[11px]">
            <span>{stock.sector}</span>
            {stock.sub_sector && <span className="opacity-60">· {stock.sub_sector}</span>}
            {stock.market_cap_tier && (
              <span className="opacity-60">· {stock.market_cap_tier}</span>
            )}
          </div>
        </div>
      </Link>

      <Button
        type="button"
        size="sm"
        variant={inWatchlist ? "outline" : "default"}
        onClick={onToggle}
        disabled={isPending || blockedFromAdding}
        className={cn(
          "shrink-0 gap-1.5",
          inWatchlist && "border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10",
          !inWatchlist && !blockedFromAdding && "bg-emerald-600 text-white hover:bg-emerald-600/90",
        )}
        title={blockedFromAdding ? "Watchlist is full — remove one first" : undefined}
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : inWatchlist ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
        <span className="text-xs">{inWatchlist ? "In watchlist" : "Add"}</span>
      </Button>
    </li>
  );
}
