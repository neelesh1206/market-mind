"use client";

import { useMemo, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Stock } from "@/lib/watchlist";
import { WATCHLIST_MAX, WATCHLIST_MIN } from "@/lib/watchlist";
import { saveWatchlist } from "./actions";

type Props = {
  stocks: Stock[];
};

/** Subtle color accent per sector — kept muted so cards still feel uniform. */
const SECTOR_COLORS: Record<string, { dot: string; ring: string }> = {
  Technology: { dot: "bg-blue-500", ring: "ring-blue-500/20" },
  Financial: { dot: "bg-emerald-500", ring: "ring-emerald-500/20" },
  Healthcare: { dot: "bg-teal-500", ring: "ring-teal-500/20" },
  Consumer: { dot: "bg-amber-500", ring: "ring-amber-500/20" },
  Energy: { dot: "bg-orange-500", ring: "ring-orange-500/20" },
};
const DEFAULT_COLOR = { dot: "bg-zinc-500", ring: "ring-zinc-500/20" };

export function StockPicker({ stocks }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeSector, setActiveSector] = useState<string>("All");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sectors = useMemo(() => {
    const set = new Set(stocks.map((s) => s.sector));
    return ["All", ...Array.from(set).sort()];
  }, [stocks]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stocks.filter((s) => {
      const sectorOk = activeSector === "All" || s.sector === activeSector;
      if (!sectorOk) return false;
      if (!q) return true;
      return (
        s.ticker.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.sub_sector?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [stocks, activeSector, query]);

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
      if (result && !result.ok) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div className="relative">
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by ticker, name, or industry…"
          className={cn(
            "border-border bg-card/40 placeholder:text-muted-foreground/70",
            "focus:border-foreground/40 focus:ring-foreground/10",
            "w-full rounded-xl border py-3 pr-4 pl-10 text-sm focus:ring-4 focus:outline-none",
          )}
          aria-label="Search stocks"
        />
      </div>

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
            {sector !== "All" && (
              <span className="text-muted-foreground/60 ml-1.5 text-xs">
                {stocks.filter((s) => s.sector === sector).length}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Stock grid */}
      {filtered.length === 0 ? (
        <div className="border-border/60 bg-card/30 rounded-xl border p-12 text-center">
          <p className="text-muted-foreground text-sm">No stocks match &quot;{query}&quot;.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((stock) => {
            const isSelected = selected.has(stock.id);
            const colors = SECTOR_COLORS[stock.sector] ?? DEFAULT_COLOR;
            return (
              <button
                key={stock.id}
                type="button"
                onClick={() => toggle(stock.id)}
                aria-pressed={isSelected}
                className={cn(
                  "group relative flex flex-col items-start gap-2 overflow-hidden rounded-xl border p-4 text-left transition-all duration-150",
                  "hover:-translate-y-px",
                  isSelected
                    ? cn("border-foreground bg-card shadow-md ring-4", colors.ring)
                    : "border-border/60 bg-card/30 hover:border-border/80 hover:bg-card/60",
                )}
              >
                {/* Sector dot + ticker row */}
                <div className="flex w-full items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full transition-transform",
                      colors.dot,
                      isSelected && "scale-150",
                    )}
                  />
                  <span className="font-mono text-base font-semibold tracking-tight">
                    {stock.ticker}
                  </span>
                </div>

                {/* Company name */}
                <span className="text-muted-foreground line-clamp-2 text-xs leading-snug">
                  {stock.name}
                </span>

                {/* Sub-sector chip */}
                {stock.sub_sector && (
                  <span className="text-muted-foreground/70 mt-auto text-[10px] tracking-wider uppercase">
                    {stock.sub_sector}
                  </span>
                )}

                {/* Selected check */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full border transition-all",
                    isSelected
                      ? "border-foreground bg-foreground text-background scale-100"
                      : "border-border/60 scale-90 bg-transparent opacity-0 group-hover:opacity-60",
                  )}
                >
                  <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
                    <path
                      d="M2 6.5L5 9.5L10 3.5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Footer bar */}
      <div className="bg-background/80 border-border/60 sticky bottom-0 -mx-6 mt-8 border-t px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium tabular-nums">
              <span className={count >= WATCHLIST_MIN ? "text-emerald-500" : ""}>{count}</span>{" "}
              {count === 1 ? "stock" : "stocks"} selected
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
              {pending ? "Saving…" : `Continue${canSubmit ? ` →` : ""}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
