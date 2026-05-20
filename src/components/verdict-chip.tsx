import { ArrowDown, ArrowUp, HelpCircle, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { isSyntheticVerdict } from "@/lib/verdict";
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
 * Three distinct visual treatments:
 *   - UP / DOWN — colored chip with direction icon and confidence pct
 *   - NEUTRAL — DELIBERATELY DIFFERENT: dashed border, help icon, "no clear
 *     read today" copy, no percentage. Reads as a chosen abstention, not a
 *     third color in the same lineup. Crucial UX honesty: when buckets
 *     disagree we say so loudly instead of looking like a coin flip.
 *   - Resolved — chip mutes to historical WIN/LOSS/VOID coloring
 *
 * Outcome-aware: if the verdict has already resolved, the chip switches to
 * showing the outcome (WIN/LOSS/VOID) instead of the (now-historical) call.
 */
export function VerdictChip({ verdict, showReasoning = false }: Props) {
  const isNeutral = verdict.direction === "NEUTRAL";
  const tone =
    verdict.direction === "UP" ? "bullish" : verdict.direction === "DOWN" ? "bearish" : "neutral";

  const Icon =
    verdict.direction === "UP" ? ArrowUp : verdict.direction === "DOWN" ? ArrowDown : HelpCircle;

  const confidencePct = Math.round(verdict.confidence * 100);
  const isSynthetic = isSyntheticVerdict(verdict);

  // For directional calls: standard solid chip.
  // For NEUTRAL (unresolved): dashed border, help icon, abstention copy.
  // For resolved (any direction): muted historical styling overrides.
  const isResolved = verdict.resolved;
  const useAbstentionStyle = isNeutral && !isResolved;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <div
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium",
            useAbstentionStyle
              ? "border border-dashed border-muted-foreground/40 bg-transparent text-muted-foreground"
              : chipTone(tone, isResolved, verdict.outcome),
          )}
        >
          <Target className="h-3 w-3" aria-hidden />
          <span className="tracking-wider uppercase opacity-70">MarketMind:</span>
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {useAbstentionStyle ? (
            <span className="font-semibold">no clear read today</span>
          ) : (
            <>
              <span className="font-semibold">{verdict.direction}</span>
              <span className="font-mono opacity-80">· {confidencePct}%</span>
            </>
          )}
          {isResolved && verdict.outcome && (
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
        {isSynthetic && (
          <span
            className="text-muted-foreground inline-flex items-center gap-1 text-[10px] tracking-wider uppercase"
            title="Computed from today's signals but not yet tracked toward accuracy. Run the pipeline + apply migration to start tracking."
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500/70" aria-hidden />
            Live · not tracked
          </span>
        )}
      </div>
      {/* For NEUTRAL we always want some text — make abstention concrete
          even when there's no LLM reasoning attached. */}
      {showReasoning && (verdict.reasoning || useAbstentionStyle) && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {verdict.reasoning ||
            "Signals are pointing in different directions — we don't have a confident read on this one today. Better to skip than to call a coin flip."}
        </p>
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
  // NEUTRAL fallthrough only happens for resolved-NEUTRAL (i.e. VOIDed or
  // resolved while sitting on the abstention) — keep the muted neutral.
  return "bg-muted text-foreground/70";
}

function outcomeTone(outcome: string): string {
  if (outcome === "WIN") return "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300";
  if (outcome === "LOSS") return "bg-red-500/20 text-red-700 dark:text-red-300";
  return "bg-zinc-500/20 text-zinc-700 dark:text-zinc-300";
}
