import { cn } from "@/lib/utils";

type Props = {
  total: number;
  correct: number;
  accuracy: number | null;
  /** "30 days" or similar — describes what window total/correct came from. */
  windowLabel?: string;
};

/**
 * Always-show-with-N track-record badge.
 * Per ADR 0007: small samples are noisy, so we ALWAYS show the denominator.
 *
 * "Right 3 of 5"  →  "Right 18 of 27 (67%)"  →  ...
 */
export function TrackRecordBadge({ total, correct, accuracy, windowLabel }: Props) {
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

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]">
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
