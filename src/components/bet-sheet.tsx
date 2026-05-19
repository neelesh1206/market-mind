"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { VerdictChip } from "@/components/verdict-chip";
import { cn } from "@/lib/utils";
import { placeBet } from "@/app/actions/bets";
import { formatET, formatRelative } from "@/lib/market-schedule";
import type { MarketMindPrediction } from "@/types/insight";

const STAKE_MIN = 50;
const STAKE_MAX = 500;
const STAKE_STEP = 50;
const STAKE_CHIPS = [50, 100, 250, 500] as const;
const PAYOUT_MULT = 1.8;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stock: { id: string; ticker: string; name: string };
  verdict: MarketMindPrediction | null;
  userCredits: number;
  /** When the bet window locks for this trading day. Null = already locked. */
  betWindowClosesAt: Date | null;
};

/**
 * Bottom sheet (mobile) / right drawer (desktop) for placing a bet.
 *
 * Validation is also done server-side in `placeBet`; client-side checks here
 * exist purely to disable the CTA + show inline error before round-tripping.
 */
export function BetSheet({
  open,
  onOpenChange,
  stock,
  verdict,
  userCredits,
  betWindowClosesAt,
}: Props) {
  const initialDirection: "UP" | "DOWN" = verdict?.direction === "DOWN" ? "DOWN" : "UP";
  const [direction, setDirection] = useState<"UP" | "DOWN">(initialDirection);
  const [credits, setCredits] = useState<number>(100);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Reset state when the sheet opens for a new stock — otherwise stale
  // direction/error carries between cards. The lint rule flags state-in-effect
  // by default; this *is* a legitimate "reset on open" sync, not derived state.
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setDirection(initialDirection);
    setCredits(100);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, initialDirection]);

  const insufficient = credits > userCredits;
  const canSubmit = !insufficient && !isPending;
  const profitIfWin = Math.round(credits * PAYOUT_MULT - credits);
  const lossIfWrong = credits;

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await placeBet({
        stockId: stock.id,
        direction,
        credits,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`Bet placed · ${credits} on ${direction}`, {
        description: `${stock.ticker} · resolves at 4:15 PM ET`,
      });
      onOpenChange(false);
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="data-[side=bottom]:rounded-t-2xl sm:!h-full sm:!max-h-none sm:!max-w-md sm:data-[side=bottom]:inset-y-0 sm:data-[side=bottom]:right-0 sm:data-[side=bottom]:left-auto sm:data-[side=bottom]:rounded-none sm:data-[side=bottom]:border-t-0 sm:data-[side=bottom]:border-l"
      >
        <SheetHeader className="pt-6">
          <div className="flex items-center gap-2">
            <SheetTitle className="font-mono text-lg">{stock.ticker}</SheetTitle>
            {verdict && <VerdictChip verdict={verdict} />}
          </div>
          <SheetDescription className="text-xs">{stock.name}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-4">
          {/* Direction toggle */}
          <div className="space-y-2">
            <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
              Your call
            </p>
            <div className="grid grid-cols-2 gap-2">
              <DirectionButton
                label="UP"
                Icon={ArrowUp}
                active={direction === "UP"}
                tone="up"
                onClick={() => setDirection("UP")}
              />
              <DirectionButton
                label="DOWN"
                Icon={ArrowDown}
                active={direction === "DOWN"}
                tone="down"
                onClick={() => setDirection("DOWN")}
              />
            </div>
            {verdict && verdict.direction !== "NEUTRAL" && (
              <p className="text-muted-foreground text-[11px]">
                {direction === verdict.direction
                  ? `You're confirming MarketMind's ${verdict.direction} call.`
                  : `You're fading MarketMind's ${verdict.direction} call.`}
              </p>
            )}
          </div>

          {/* Stake */}
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                Stake
              </p>
              <p className="font-mono text-sm font-semibold">{credits} credits</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {STAKE_CHIPS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setCredits(amt)}
                  className={cn(
                    "rounded-md border px-3 py-1 text-xs font-medium transition-colors",
                    credits === amt
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card hover:border-foreground/40",
                  )}
                >
                  {amt}
                </button>
              ))}
            </div>

            <Slider
              min={STAKE_MIN}
              max={STAKE_MAX}
              step={STAKE_STEP}
              value={[credits]}
              onValueChange={(value) => {
                const v = Array.isArray(value) ? value[0] : value;
                if (typeof v === "number") setCredits(v);
              }}
              aria-label="Stake"
            />

            <div className="text-muted-foreground flex justify-between text-[10px]">
              <span>min {STAKE_MIN}</span>
              <span>balance {userCredits.toLocaleString()}</span>
              <span>max {STAKE_MAX}</span>
            </div>
          </div>

          {/* Payout preview */}
          <div className="border-border/60 bg-card/40 space-y-1.5 rounded-lg border p-3">
            <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
              Payout preview
            </p>
            <PayoutRow
              label={`Win (${direction})`}
              value={`+${profitIfWin}`}
              tone="up"
              sub={`${credits} × ${PAYOUT_MULT} − stake`}
            />
            <PayoutRow
              label="Lose"
              value={`−${lossIfWrong}`}
              tone="down"
              sub="Full stake forfeited"
            />
            <PayoutRow
              label="Tie (open = close)"
              value="±0"
              tone="neutral"
              sub="Stake refunded as VOID"
            />
          </div>

          {/* Window status */}
          {betWindowClosesAt && (
            <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
              <Clock className="h-3 w-3" aria-hidden />
              <span>
                Bet locks {formatRelative(betWindowClosesAt)} · {formatET(betWindowClosesAt)}
              </span>
            </div>
          )}

          {/* Inline errors */}
          {insufficient && (
            <p className="text-destructive text-xs">
              Stake exceeds your {userCredits.toLocaleString()}-credit balance.
            </p>
          )}
          {error && <p className="text-destructive text-xs">{error}</p>}
        </div>

        <SheetFooter className="border-border/60 border-t px-6 py-4">
          <Button type="button" disabled={!canSubmit} onClick={handleSubmit} className="w-full">
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Place bet · {credits} credits on {direction}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function DirectionButton({
  label,
  Icon,
  active,
  tone,
  onClick,
}: {
  label: string;
  Icon: typeof ArrowUp;
  active: boolean;
  tone: "up" | "down";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-semibold transition-colors",
        active && tone === "up" && "border-emerald-500 bg-emerald-500/10 text-emerald-600",
        active && tone === "down" && "border-rose-500 bg-rose-500/10 text-rose-600",
        !active && "border-border bg-card text-muted-foreground hover:border-foreground/40",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}

function PayoutRow({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone: "up" | "down" | "neutral";
  sub: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs">{label}</p>
        <p className="text-muted-foreground text-[10px]">{sub}</p>
      </div>
      <p
        className={cn(
          "font-mono text-sm font-semibold",
          tone === "up" && "text-emerald-600",
          tone === "down" && "text-rose-600",
          tone === "neutral" && "text-muted-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}
