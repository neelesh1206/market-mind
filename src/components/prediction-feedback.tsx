"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { submitPredictionFeedback } from "@/app/actions/feedback";
import { cn } from "@/lib/utils";

type Props = {
  predictionId: string;
  ticker: string;
  /** True if the viewer is signed in. Anon viewers see the aggregate +
   *  a sign-in CTA, but can't vote. */
  signedIn: boolean;
  /** Current viewer's existing vote, if any. */
  initialUserVote: boolean | null;
  /** Aggregate counts at page-load time. */
  initialSummary: {
    helpfulCount: number;
    totalCount: number;
  };
};

/**
 * Thumbs feedback on a MarketMind verdict.
 *
 * Display contract:
 *   - Anon: aggregate shown, buttons disabled, "Sign in to share" link
 *   - Signed-in, no prior vote: both buttons interactive
 *   - Signed-in, has voted: their button is filled + tagged "your vote"
 *
 * The aggregate display has three modes based on sample size:
 *   - N == 0   : "Be the first to weigh in"
 *   - N < 5    : "{helpful} of {total} found it helpful" (no percentage —
 *                a 1/1 = 100% display would be misleading)
 *   - N >= 5   : "{helpful} of {total} found it helpful · {pct}%"
 *
 * Optimistic update: button visually flips immediately, server action
 * runs in a transition. On failure the state rolls back + a toast surfaces
 * the error message.
 */
export function PredictionFeedback({
  predictionId,
  ticker,
  signedIn,
  initialUserVote,
  initialSummary,
}: Props) {
  const [userVote, setUserVote] = useState<boolean | null>(initialUserVote);
  const [summary, setSummary] = useState(initialSummary);
  const [isPending, startTransition] = useTransition();

  const onVote = (newVote: boolean) => {
    if (!signedIn) return; // anon can't vote
    const previousVote = userVote;
    const previousSummary = summary;

    // Optimistic update to summary counts. We compare against
    // previousVote rather than userVote because state updates batch.
    const helpfulDelta =
      (newVote ? 1 : 0) - (previousVote === true ? 1 : 0);
    const totalDelta = previousVote === null ? 1 : 0;

    setUserVote(newVote);
    setSummary({
      helpfulCount: Math.max(0, summary.helpfulCount + helpfulDelta),
      totalCount: Math.max(0, summary.totalCount + totalDelta),
    });

    startTransition(async () => {
      const result = await submitPredictionFeedback({
        predictionId,
        ticker,
        helpful: newVote,
      });
      if (!result.ok) {
        // Roll back
        setUserVote(previousVote);
        setSummary(previousSummary);
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="border-border/40 bg-background/30 space-y-2 rounded-md border px-3 py-2.5">
      <p className="text-foreground/90 text-xs font-medium">
        Did this verdict help you think about {ticker}?
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!signedIn || isPending}
          onClick={() => onVote(true)}
          aria-pressed={userVote === true}
          aria-label="Thumbs up — this verdict helped"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
            userVote === true
              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : "border-border/60 bg-card/40 text-muted-foreground hover:border-emerald-500/30 hover:text-foreground",
            (!signedIn || isPending) && "cursor-not-allowed opacity-60",
          )}
        >
          <ThumbsUp className="h-3 w-3" aria-hidden />
          Helpful
        </button>
        <button
          type="button"
          disabled={!signedIn || isPending}
          onClick={() => onVote(false)}
          aria-pressed={userVote === false}
          aria-label="Thumbs down — this verdict didn't help"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
            userVote === false
              ? "border-red-500/40 bg-red-500/15 text-red-600 dark:text-red-400"
              : "border-border/60 bg-card/40 text-muted-foreground hover:border-red-500/30 hover:text-foreground",
            (!signedIn || isPending) && "cursor-not-allowed opacity-60",
          )}
        >
          <ThumbsDown className="h-3 w-3" aria-hidden />
          Not for me
        </button>

        <span className="text-muted-foreground ml-1 flex-1 text-[11px] leading-tight">
          {!signedIn ? (
            <>
              <Link
                href="/login"
                className="text-foreground underline-offset-2 hover:underline"
              >
                Sign in
              </Link>{" "}
              to share feedback
              {summary.totalCount > 0 && <> — {renderSummary(summary)}</>}
            </>
          ) : (
            <>{renderSummary(summary)}</>
          )}
        </span>
      </div>
    </div>
  );
}

function renderSummary(s: { helpfulCount: number; totalCount: number }): string {
  if (s.totalCount === 0) return "Be the first to weigh in.";
  if (s.totalCount < 5) {
    const word = s.totalCount === 1 ? "person" : "people";
    return `${s.helpfulCount} of ${s.totalCount} ${word} found it helpful`;
  }
  const pct = Math.round((s.helpfulCount / s.totalCount) * 100);
  return `${s.helpfulCount} of ${s.totalCount} found it helpful · ${pct}%`;
}
