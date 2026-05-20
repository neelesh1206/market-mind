"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowDown, ArrowUp, Clock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { isStuckPrediction, resolutionReferenceFor } from "@/lib/bets";
import type { BetHistoryRow } from "@/lib/bets";

type Props = {
  rows: BetHistoryRow[];
  /**
   * Today's ET calendar date (YYYY-MM-DD). Passed from the server so the
   * "delayed" derivation matches the rest of the app's ET-aware semantics
   * and stays consistent across hydration.
   */
  todayEt: string;
};

type Filter = "all" | "pending" | "resolved";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "resolved", label: "Resolved" },
];

/**
 * Bet history list — one row per prediction, newest first.
 *
 * Filter chips are client-side because we already loaded up to 200 rows at
 * page-render time. Past that we'd want server-side pagination, but 200 is
 * months of daily play for a casual user — fine for the MVP.
 */
export function BetHistoryList({ rows, todayEt }: Props) {
  const delayedCount = useMemo(
    () => rows.filter((r) => isStuckPrediction(r, todayEt)).length,
    [rows, todayEt],
  );
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(() => {
    if (filter === "pending") return rows.filter((r) => !r.resolved);
    if (filter === "resolved") return rows.filter((r) => r.resolved);
    return rows;
  }, [rows, filter]);

  const counts = useMemo(() => {
    let pending = 0;
    let resolved = 0;
    for (const r of rows) {
      if (r.resolved) resolved += 1;
      else pending += 1;
    }
    return { all: rows.length, pending, resolved };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No bets yet"
        description="Head back to the feed to place your first call."
        cta={{ label: "Browse today's signals", href: "/" }}
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Delayed-bets banner — surfaces when a cron failure or weekend bet
          has left predictions sitting past their resolution date. The user's
          stake is still safe (refundable via manual workflow re-run); this
          just makes the situation visible rather than silently stuck. */}
      {delayedCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-snug text-amber-600">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">
              {delayedCount} {delayedCount === 1 ? "bet is" : "bets are"} awaiting resolution.
            </span>{" "}
            Your stake is safe — we&apos;re investigating and will resolve automatically once
            the pipeline catches up.
          </span>
        </div>
      )}

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              filter === key
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card hover:border-foreground/40",
            )}
          >
            {label}
            <span
              className={cn(
                "ml-1.5 tabular-nums",
                filter === key ? "text-background/70" : "text-muted-foreground",
              )}
            >
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <p className="text-muted-foreground px-1 py-6 text-center text-xs">
          No bets match this filter.
        </p>
      ) : (
        <ul className="divide-border/40 border-border/60 bg-card/30 divide-y rounded-xl border">
          {visible.map((row) => (
            <BetRow key={row.id} row={row} todayEt={todayEt} />
          ))}
        </ul>
      )}
    </div>
  );
}

function BetRow({ row, todayEt }: { row: BetHistoryRow; todayEt: string }) {
  const DirectionIcon = row.direction === "UP" ? ArrowUp : ArrowDown;
  const directionTone =
    row.direction === "UP" ? "text-emerald-600" : "text-rose-600";

  const status = statusFor(row, todayEt);
  const net = row.payout !== null ? row.payout - row.credits_wagered : null;

  return (
    <li className="hover:bg-card/60 flex flex-col gap-2 px-4 py-3 transition-colors sm:flex-row sm:items-center sm:gap-4">
      {/* Ticker + name */}
      <Link
        href={`/stock/${row.stock.ticker}`}
        className="hover:text-foreground flex min-w-0 items-center gap-2 sm:w-40"
      >
        <span className="font-mono text-sm font-semibold">{row.stock.ticker}</span>
        <span className="text-muted-foreground truncate text-xs">{row.stock.name}</span>
      </Link>

      {/* Direction + stake + price action (when resolved) */}
      <div className="flex flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 font-mono text-xs font-medium",
              directionTone,
            )}
          >
            <DirectionIcon className="h-3.5 w-3.5" aria-hidden />
            {row.direction}
          </span>
          <span className="text-muted-foreground text-xs">· {row.credits_wagered} credits</span>
        </div>
        {row.resolved && row.close_price !== null && (() => {
          // Per ADR 0017: bets placed after market open with a recorded
          // entry price are scored entry → close; everything else still
          // open → close. The label and reference price both shift.
          const { price, mode } = resolutionReferenceFor(row);
          if (price == null) return null;
          return (
            <PriceActionLine
              referencePrice={price}
              referenceLabel={mode}
              closePrice={row.close_price}
              outcome={row.outcome}
            />
          );
        })()}
      </div>

      {/* Status badge */}
      <div className="flex items-center gap-3 sm:gap-4">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium tracking-wider uppercase",
            status.className,
          )}
        >
          {status.icon}
          {status.label}
        </span>

        {/* Payout — only for resolved rows */}
        {net !== null && (
          <span
            className={cn(
              "font-mono text-xs tabular-nums",
              net > 0
                ? "text-emerald-600"
                : net < 0
                  ? "text-rose-600"
                  : "text-muted-foreground",
            )}
          >
            {net > 0 ? "+" : ""}
            {net}
          </span>
        )}

        {/* Date */}
        <span className="text-muted-foreground ml-auto font-mono text-[11px] tabular-nums">
          {formatTradingDate(row.prediction_date)}
        </span>
      </div>
    </li>
  );
}

function statusFor(
  row: BetHistoryRow,
  todayEt: string,
): {
  label: string;
  className: string;
  icon: React.ReactNode;
} {
  if (!row.resolved) {
    // "Delayed" gets stronger amber + AlertCircle icon to distinguish from
    // normal-pending. Both share the same DB state — the difference is
    // purely whether the trading day has passed.
    if (isStuckPrediction(row, todayEt)) {
      return {
        label: "Delayed",
        className: "border-amber-500/60 bg-amber-500/20 text-amber-600",
        icon: <AlertCircle className="h-2.5 w-2.5" aria-hidden />,
      };
    }
    return {
      label: "Pending",
      className: "border-amber-500/40 bg-amber-500/10 text-amber-600",
      icon: <Clock className="h-2.5 w-2.5" aria-hidden />,
    };
  }
  if (row.outcome === "WIN") {
    return {
      label: "Win",
      className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
      icon: null,
    };
  }
  if (row.outcome === "LOSS") {
    return {
      label: "Loss",
      className: "border-rose-500/40 bg-rose-500/10 text-rose-600",
      icon: null,
    };
  }
  // VOID — flat tape, stake refunded
  return {
    label: "Void",
    className: "border-border bg-card text-muted-foreground",
    icon: null,
  };
}

/**
 * Displays the bar this bet was scored against and the movement to close.
 * Label is `referenceLabel` (open|entry) — same component handles both
 * resolution models (ADR 0008 and ADR 0017).
 */
function PriceActionLine({
  referencePrice,
  referenceLabel,
  closePrice,
  outcome,
}: {
  referencePrice: number;
  referenceLabel: "open" | "entry";
  closePrice: number;
  outcome: BetHistoryRow["outcome"];
}) {
  const delta = closePrice - referencePrice;
  const pct = referencePrice > 0 ? (delta / referencePrice) * 100 : 0;
  // Color the line by direction of price movement, not outcome — a +1% move
  // is green whether the user bet UP and won or bet DOWN and lost.
  const tone =
    delta > 0
      ? "text-emerald-500"
      : delta < 0
        ? "text-rose-500"
        : "text-muted-foreground";

  return (
    <div className="text-muted-foreground flex items-center gap-1.5 font-mono text-[11px]">
      <span>
        {referenceLabel} ${referencePrice.toFixed(2)}
      </span>
      <span className="opacity-60">→</span>
      <span>close ${closePrice.toFixed(2)}</span>
      <span className={cn("tabular-nums", tone)}>
        {pct >= 0 ? "+" : ""}
        {pct.toFixed(2)}%
      </span>
      {outcome === "VOID" && (
        <span className="text-muted-foreground opacity-70">· flat tape</span>
      )}
    </div>
  );
}

function formatTradingDate(iso: string): string {
  // Parse as UTC to avoid local-tz date shift, then format. The date column is
  // a calendar date (no tz), so we just want the calendar reading.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(date);
}
