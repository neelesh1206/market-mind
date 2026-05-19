"use client";

import { cn } from "@/lib/utils";

type Props = {
  technical: number | null;
  sentiment: number | null;
  professional: number | null;
  social: number | null;
};

/**
 * 4-cell horizontal "signal strip" — a glanceable summary of all 4 bucket
 * scores rendered as colored chips. Inspired by Bloomberg Terminal's
 * compact gauge displays.
 *
 *   ┃ T ┃ S ┃ P ┃ s ┃    each cell colored by its bucket direction
 *
 * Tooltip on hover surfaces the exact score. Used in card headers so the
 * full signal picture is visible at a single glance.
 */
const LABELS = ["T", "S", "P", "s"] as const;
const NAMES = ["Technical", "Sentiment", "Professional", "Social"] as const;

export function SignalStrip({ technical, sentiment, professional, social }: Props) {
  const scores: Array<number | null> = [technical, sentiment, professional, social];

  return (
    <div
      className="border-border/40 inline-flex overflow-hidden rounded-md border"
      role="img"
      aria-label="Signal summary across technical, sentiment, professional, social"
    >
      {scores.map((score, i) => (
        <div
          key={i}
          className={cn(
            "flex h-6 w-6 items-center justify-center font-mono text-[10px] font-medium",
            cellClass(score),
          )}
          title={`${NAMES[i]}: ${score == null ? "—" : score > 0 ? `+${score.toFixed(2)}` : score.toFixed(2)}`}
        >
          {LABELS[i]}
        </div>
      ))}
    </div>
  );
}

function cellClass(score: number | null): string {
  if (score == null) return "bg-muted text-muted-foreground/50";
  if (score > 0.5) return "bg-emerald-500/80 text-white";
  if (score > 0.1) return "bg-emerald-500/30 text-emerald-700 dark:text-emerald-300";
  if (score < -0.5) return "bg-red-500/80 text-white";
  if (score < -0.1) return "bg-red-500/30 text-red-700 dark:text-red-300";
  return "bg-zinc-500/20 text-zinc-700 dark:text-zinc-300";
}
