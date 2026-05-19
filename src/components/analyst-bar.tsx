"use client";

import { cn } from "@/lib/utils";

type Props = {
  buy: number | null;
  hold: number | null;
  sell: number | null;
  /** Render compact (height: 4px) for cards, default (height: 8px) for detail */
  compact?: boolean;
};

/**
 * Horizontal stacked bar showing Buy / Hold / Sell analyst split.
 * Bloomberg-style: emerald → zinc → red, with counts on hover.
 * Renders nothing if no analyst data.
 */
export function AnalystBar({ buy, hold, sell, compact = false }: Props) {
  const total = (buy ?? 0) + (hold ?? 0) + (sell ?? 0);
  if (total === 0) return null;

  const buyPct = ((buy ?? 0) / total) * 100;
  const holdPct = ((hold ?? 0) / total) * 100;
  const sellPct = ((sell ?? 0) / total) * 100;

  return (
    <div className="space-y-1.5">
      <div className="text-muted-foreground flex items-center justify-between text-[10px] tracking-wider uppercase">
        <span>Analyst consensus</span>
        <span className="font-mono tracking-normal normal-case">
          <span className="text-emerald-500">{buy ?? 0}</span>
          <span className="opacity-50"> · </span>
          <span>{hold ?? 0}</span>
          <span className="opacity-50"> · </span>
          <span className="text-red-500">{sell ?? 0}</span>
        </span>
      </div>
      <div className={cn("flex w-full overflow-hidden rounded-full", compact ? "h-1" : "h-2")}>
        {buy != null && buy > 0 && (
          <div
            className="bg-emerald-500"
            style={{ width: `${buyPct}%` }}
            title={`${buy} Buy`}
            aria-label={`${buy} Buy`}
          />
        )}
        {hold != null && hold > 0 && (
          <div
            className="bg-zinc-500/60"
            style={{ width: `${holdPct}%` }}
            title={`${hold} Hold`}
            aria-label={`${hold} Hold`}
          />
        )}
        {sell != null && sell > 0 && (
          <div
            className="bg-red-500"
            style={{ width: `${sellPct}%` }}
            title={`${sell} Sell`}
            aria-label={`${sell} Sell`}
          />
        )}
      </div>
    </div>
  );
}
