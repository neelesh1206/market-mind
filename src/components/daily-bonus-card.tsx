"use client";

import { useState, useTransition } from "react";
import { Flame, Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { claimDailyBonus } from "@/app/actions/bonus";
import { haptic } from "@/lib/haptics";
import type { DailyBonusStatus } from "@/lib/bonus";

type Props = {
  status: DailyBonusStatus;
};

/**
 * Daily login bonus card — shown on top of the home feed.
 *
 * Two visual states:
 *   - available  → bright emerald card with claim button + streak flame
 *   - claimed    → muted card showing current streak + "come back tomorrow"
 *
 * The claim button does an optimistic flip to the claimed state on success
 * (server action revalidates the home page so subsequent renders match).
 */
export function DailyBonusCard({ status }: Props) {
  const [claimed, setClaimed] = useState(!status.available);
  const [streakAfterClaim, setStreakAfterClaim] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClaim() {
    startTransition(async () => {
      const result = await claimDailyBonus();
      if (!result.ok) {
        toast.error(result.error);
        haptic("warning");
        return;
      }
      setClaimed(true);
      setStreakAfterClaim(result.newStreak);
      // Stronger pattern when the streak grew — the daily ritual landing.
      haptic(result.newStreak > 1 ? "success" : "tap");
      toast.success(
        result.newStreak > 1
          ? `Day ${result.newStreak} streak! · +${result.creditsAwarded} credits`
          : `Welcome back · +${result.creditsAwarded} credits`,
        {
          description:
            result.newLongest > status.longestStreak && result.newStreak > 1
              ? `New longest streak: ${result.newStreak} days`
              : `Balance: ${result.newBalance.toLocaleString()}`,
        },
      );
    });
  }

  const displayStreak = streakAfterClaim ?? status.currentStreak;

  if (claimed) {
    return (
      <div
        className={cn(
          "border-border/60 bg-card/30 flex items-center justify-between gap-3 rounded-xl border px-4 py-3",
        )}
      >
        <div className="flex items-center gap-3">
          <div className="bg-card border-border/60 flex h-9 w-9 items-center justify-center rounded-full border">
            <Flame className="h-4 w-4 text-orange-500" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {displayStreak > 0
                ? `${displayStreak}-day streak`
                : "Daily bonus claimed"}
            </p>
            <p className="text-muted-foreground text-xs">
              Come back tomorrow to keep it alive.
            </p>
          </div>
        </div>
        {status.longestStreak > 0 && (
          <div className="text-muted-foreground hidden text-right text-[11px] sm:block">
            <span className="block">Longest</span>
            <span className="text-foreground font-mono font-semibold">
              {status.longestStreak}d
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border p-4",
        "border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-lg shadow-emerald-900/40">
          {status.streakWouldContinue && status.currentStreak > 0 ? (
            <Flame className="h-5 w-5 text-white" aria-hidden />
          ) : (
            <Gift className="h-5 w-5 text-white" aria-hidden />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {status.streakWouldContinue && status.currentStreak > 0
              ? `Day ${status.currentStreak + 1} of your streak`
              : status.currentStreak > 0
                ? "Streak broken — restart today"
                : "Your daily bonus is waiting"}
          </p>
          <p className="text-muted-foreground text-xs">
            Claim{" "}
            <span className="text-foreground font-mono font-semibold">
              +{status.nextBonusAmount}
            </span>{" "}
            credits · resets each ET day
          </p>
        </div>
      </div>
      <Button
        type="button"
        onClick={handleClaim}
        disabled={isPending}
        className="shrink-0 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-600/90"
      >
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {isPending ? "Claiming…" : `Claim +${status.nextBonusAmount}`}
      </Button>
    </div>
  );
}
