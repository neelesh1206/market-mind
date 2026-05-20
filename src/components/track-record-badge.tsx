import { cn } from "@/lib/utils";

type Props = {
  total: number;
  correct: number;
  accuracy: number | null;
  /** Wilson 95% lower bound, as a decimal in [0, 1]. Null when total = 0. */
  ciLower?: number | null;
  /** Wilson 95% upper bound, as a decimal in [0, 1]. Null when total = 0. */
  ciUpper?: number | null;
  /** "30 days" or similar — describes what window total/correct came from. */
  windowLabel?: string;
  /** When true, the CI is dropped from the display even at small N — used in
   *  compact contexts (e.g. the stock-card footer) where the headline number
   *  is enough. The /about and detail pages keep it on. */
  compact?: boolean;
};

/**
 * Always-show-with-N track-record badge.
 *
 * Per ADR 0007: small samples are noisy, so we ALWAYS show the denominator.
 * We now also show a 95% Wilson confidence interval when available — see
 * `src/lib/wilson.ts`. At very small N (≤ 5) the interval is intentionally
 * wide; the visible width is a feature, not a flaw — it tells users *how
 * much* to trust the headline number.
 *
 * "Right 3 of 5 · 60% (24–88%)"  →  "Right 18 of 27 · 67% (48–81%)"  →  ...
 */
export function TrackRecordBadge({
  total,
  correct,
  accuracy,
  ciLower,
  ciUpper,
  windowLabel,
  compact = false,
}: Props) {
  if (total === 0) {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
        <span className="bg-muted h-1.5 w-1.5 rounded-full" aria-hidden />
        Building track record
      </span>
    );
  }

  const pct = accuracy != null ? Math.round(accuracy * 100) : null;
  const tone =
    accuracy == null ? "muted" : accuracy >= 0.6 ? "good" : accuracy >= 0.5 ? "mid" : "bad";

  const showCi = !compact && ciLower != null && ciUpper != null;
  const ciText =
    showCi ? `${Math.round(ciLower! * 100)}–${Math.round(ciUpper! * 100)}%` : null;

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className={cn("h-1.5 w-1.5 rounded-full", dotClass(tone))} aria-hidden />
      <span className="text-muted-foreground">
        Right{" "}
        <span className="text-foreground font-mono tabular-nums">
          {correct} of {total}
        </span>
        {pct != null && (
          <>
            {" "}
            · <span className={cn("font-mono tabular-nums", textClass(tone))}>{pct}%</span>
          </>
        )}
        {ciText && (
          <span
            className="text-muted-foreground/80 ml-1 font-mono text-[10px] tabular-nums"
            title={`95% confidence interval — the true accuracy is most likely between ${ciText} given a sample size of ${total}.`}
          >
            ({ciText})
          </span>
        )}
        {windowLabel && <span className="opacity-60"> · last {windowLabel}</span>}
      </span>
    </span>
  );
}

function dotClass(tone: "good" | "mid" | "bad" | "muted"): string {
  if (tone === "good") return "bg-emerald-500";
  if (tone === "bad") return "bg-red-500";
  if (tone === "mid") return "bg-amber-500";
  return "bg-muted-foreground";
}

function textClass(tone: "good" | "mid" | "bad" | "muted"): string {
  if (tone === "good") return "text-emerald-500";
  if (tone === "bad") return "text-red-500";
  if (tone === "mid") return "text-amber-500";
  return "text-muted-foreground";
}
