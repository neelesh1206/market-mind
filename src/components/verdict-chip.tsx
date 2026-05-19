import { ArrowDown, ArrowRight, ArrowUp, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MarketMindPrediction } from "@/types/insight";

type Props = {
  verdict: MarketMindPrediction;
  /** Show the reasoning sentence underneath. Default: false (compact). */
  showReasoning?: boolean;
};

/**
 * "MarketMind's read" chip — surfaces the daily verdict alongside the signal
 * data. Direction is paired with a confidence pct and (optionally) the
 * one-sentence reasoning generated at prediction time.
 *
 * Outcome-aware: if the verdict has already resolved, the chip switches to
 * showing the outcome (WIN/LOSS/VOID) instead of the (now-historical) call.
 */
export function VerdictChip({ verdict, showReasoning = false }: Props) {
  const tone =
    verdict.direction === "UP" ? "bullish" : verdict.direction === "DOWN" ? "bearish" : "neutral";

  const Icon =
    verdict.direction === "UP" ? ArrowUp : verdict.direction === "DOWN" ? ArrowDown : ArrowRight;

  const confidencePct = Math.round(verdict.confidence * 100);

  return (
    <div className="space-y-1.5">
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium",
          chipTone(tone, verdict.resolved, verdict.outcome),
        )}
      >
        <Target className="h-3 w-3" aria-hidden />
        <span className="tracking-wider uppercase opacity-70">MarketMind&apos;s read:</span>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        <span className="font-semibold">{verdict.direction}</span>
        {verdict.direction !== "NEUTRAL" && (
          <span className="font-mono opacity-80">· {confidencePct}%</span>
        )}
        {verdict.resolved && verdict.outcome && (
          <span
            className={cn(
              "ml-1 rounded-sm px-1 text-[10px] font-bold uppercase",
              outcomeTone(verdict.outcome),
            )}
          >
            {verdict.outcome}
          </span>
        )}
      </div>
      {showReasoning && verdict.reasoning && (
        <p className="text-muted-foreground text-[11px] leading-snug">{verdict.reasoning}</p>
      )}
    </div>
  );
}

function chipTone(
  tone: "bullish" | "bearish" | "neutral",
  resolved: boolean,
  outcome: string | null,
): string {
  // After resolution, the chip mutes — it's now historical.
  if (resolved && outcome === "WIN") {
    return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  }
  if (resolved && outcome === "LOSS") {
    return "bg-red-500/10 text-red-600 dark:text-red-400";
  }
  if (resolved) {
    return "bg-muted text-muted-foreground";
  }
  // Active call — colored by predicted direction
  if (tone === "bullish") return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (tone === "bearish") return "bg-red-500/15 text-red-600 dark:text-red-400";
  return "bg-muted text-foreground/70";
}

function outcomeTone(outcome: string): string {
  if (outcome === "WIN") return "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300";
  if (outcome === "LOSS") return "bg-red-500/20 text-red-700 dark:text-red-300";
  return "bg-zinc-500/20 text-zinc-700 dark:text-zinc-300";
}
