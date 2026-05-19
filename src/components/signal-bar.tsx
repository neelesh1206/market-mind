"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  icon: LucideIcon;
  label: string;
  /** Bucket score in [-1, 1]. `null` = no data. */
  score: number | null;
  /** Per-source detail line (e.g. "RSI 58 · MACD bullish"). */
  detail?: string | null;
};

/**
 * Visual signal bar.
 *
 * The track is full-width, centered at 0. A colored segment grows from the
 * center toward the score direction:
 *   - positive (bullish) → fills right, emerald
 *   - negative (bearish) → fills left, red
 *   - near-zero or null  → muted track with no fill
 *
 * Renders a label, icon, score number, and an optional supporting detail line.
 */
export function SignalBar({ icon: Icon, label, score, detail }: Props) {
  const clamped = score === null ? 0 : Math.max(-1, Math.min(1, score));
  const hasData = score !== null;
  const isBullish = hasData && clamped > 0.05;
  const isBearish = hasData && clamped < -0.05;

  const fillPct = Math.abs(clamped) * 50; // 0–50% width from center

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon
            className={cn(
              "h-3.5 w-3.5",
              isBullish ? "text-emerald-500" : isBearish ? "text-red-500" : "text-muted-foreground",
            )}
            aria-hidden
          />
          <span className="text-foreground/90 text-xs font-medium tracking-wider uppercase">
            {label}
          </span>
        </div>
        <span
          className={cn(
            "font-mono text-xs tabular-nums",
            isBullish ? "text-emerald-500" : isBearish ? "text-red-500" : "text-muted-foreground",
          )}
        >
          {hasData ? (clamped > 0 ? `+${clamped.toFixed(2)}` : clamped.toFixed(2)) : "—"}
        </span>
      </div>

      {/* Track */}
      <div className="bg-muted relative h-1.5 w-full overflow-hidden rounded-full">
        {/* Center marker */}
        <div
          className="bg-border absolute top-0 left-1/2 h-full w-px -translate-x-1/2"
          aria-hidden
        />
        {/* Fill */}
        {hasData && (
          <div
            className={cn(
              "absolute top-0 h-full rounded-full transition-all duration-300",
              isBullish ? "bg-emerald-500" : isBearish ? "bg-red-500" : "bg-zinc-500",
            )}
            style={{
              left: clamped >= 0 ? "50%" : `${50 - fillPct}%`,
              width: `${fillPct}%`,
            }}
            aria-hidden
          />
        )}
      </div>

      {detail && <p className="text-muted-foreground text-[11px] leading-snug">{detail}</p>}
    </div>
  );
}
