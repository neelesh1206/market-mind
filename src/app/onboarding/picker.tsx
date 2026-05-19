"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Stock } from "@/lib/watchlist";
import { WATCHLIST_MAX, WATCHLIST_MIN } from "@/lib/watchlist";
import { saveWatchlist } from "./actions";

type Props = {
  stocks: Stock[];
};

export function StockPicker({ stocks }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeSector, setActiveSector] = useState<string>("All");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sectors = useMemo(() => {
    const set = new Set(stocks.map((s) => s.sector));
    return ["All", ...Array.from(set).sort()];
  }, [stocks]);

  const filtered = useMemo(() => {
    if (activeSector === "All") return stocks;
    return stocks.filter((s) => s.sector === activeSector);
  }, [stocks, activeSector]);

  const count = selected.size;
  const canSubmit = count >= WATCHLIST_MIN && count <= WATCHLIST_MAX;

  function toggle(id: string) {
    setError(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size >= WATCHLIST_MAX) {
        setError(`You can pick up to ${WATCHLIST_MAX} stocks`);
        return prev;
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function submit() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const result = await saveWatchlist(Array.from(selected));
      // Server action redirects on success; if it returns, it failed.
      if (result && !result.ok) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Sector tabs */}
      <nav
        className="border-border/60 -mx-6 flex gap-1 overflow-x-auto border-b px-6 pb-px"
        aria-label="Sector filter"
      >
        {sectors.map((sector) => (
          <button
            key={sector}
            type="button"
            onClick={() => setActiveSector(sector)}
            className={cn(
              "shrink-0 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              activeSector === sector
                ? "border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {sector}
          </button>
        ))}
      </nav>

      {/* Stock grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {filtered.map((stock) => {
          const isSelected = selected.has(stock.id);
          return (
            <button
              key={stock.id}
              type="button"
              onClick={() => toggle(stock.id)}
              aria-pressed={isSelected}
              className={cn(
                "group relative flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition-all",
                isSelected
                  ? "border-foreground bg-card shadow-sm"
                  : "border-border/60 bg-card/30 hover:border-border hover:bg-card/60",
              )}
            >
              <span className="text-base font-semibold tracking-tight">{stock.ticker}</span>
              <span className="text-muted-foreground line-clamp-2 text-xs leading-snug">
                {stock.name}
              </span>
              {stock.sub_sector && (
                <span className="text-muted-foreground/70 mt-1 text-[10px] tracking-wider uppercase">
                  {stock.sub_sector}
                </span>
              )}

              {/* Selected indicator */}
              <span
                aria-hidden
                className={cn(
                  "absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full border transition-all",
                  isSelected
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/60 bg-transparent",
                )}
              >
                {isSelected && (
                  <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
                    <path
                      d="M2 6.5L5 9.5L10 3.5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Footer bar */}
      <div className="bg-background/80 border-border/60 sticky bottom-0 -mx-6 mt-8 border-t px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              {count} {count === 1 ? "stock" : "stocks"} selected
            </p>
            <p className="text-muted-foreground text-xs">
              Pick {WATCHLIST_MIN}–{WATCHLIST_MAX} to continue
            </p>
          </div>

          <div className="flex items-center gap-3">
            {error && (
              <p role="alert" className="text-destructive text-xs">
                {error}
              </p>
            )}
            <Button onClick={submit} disabled={!canSubmit || pending} size="lg">
              {pending ? "Saving…" : "Continue"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
