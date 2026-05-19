import { Flame, Snowflake } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  scores: Array<number | null>;
  /** Threshold above which a single bucket counts as "strong". */
  threshold?: number;
};

/**
 * Surfaces a HOT / COLD chip when any bucket exceeds the threshold.
 *
 * HOT  ≥ +threshold in any bucket  → emerald flame
 * COLD ≤ -threshold in any bucket  → red snowflake
 * Otherwise renders nothing.
 *
 * Lets users scan the feed and immediately spot stocks with strong directional signals.
 */
export function StrongSignalBadge({ scores, threshold = 0.6 }: Props) {
  const max = Math.max(...scores.map((s) => s ?? 0));
  const min = Math.min(...scores.map((s) => s ?? 0));

  if (max >= threshold) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-emerald-600 uppercase dark:text-emerald-400">
        <Flame className="h-3 w-3" aria-hidden />
        Hot
      </span>
    );
  }
  if (min <= -threshold) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-red-600 uppercase dark:text-red-400">
        <Snowflake className="h-3 w-3" aria-hidden />
        Cold
      </span>
    );
  }
  return null;
}

/**
 * Smaller "signal strength" badge used in compact spaces — just a colored
 * dot when the maximum absolute bucket is strong enough to warrant flagging.
 */
export function SignalStrengthDot({ scores, threshold = 0.6 }: Props) {
  const maxAbs = Math.max(...scores.map((s) => Math.abs(s ?? 0)));
  if (maxAbs < threshold) return null;
  return (
    <span className={cn("h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500")} aria-hidden />
  );
}
