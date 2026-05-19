"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Clock, Loader2, X } from "lucide-react";
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
import { cancelBet, placeBet } from "@/app/actions/bets";
import { haptic } from "@/lib/haptics";
import { formatET, formatRelative, formatResolutionCopy } from "@/lib/market-schedule";
import type { Prediction } from "@/lib/bets";
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
  /** When today's trading day resolves (close + 15 min). Used in success toast copy. */
  resolutionAt: Date;
  /**
   * If present, the sheet renders in "manage mode" — read-only summary of the
   * existing bet plus a Cancel button. Otherwise it renders the place flow.
   */
  existingBet?: Prediction | null;
};

/**
 * Bottom sheet (mobile) / right drawer (desktop) for the bet flow.
 *
 * Two modes share one shell:
 *   - Place mode (no existing bet) → direction + stake + payout preview
 *   - Manage mode (existing bet)   → summary + cancel-with-confirm
 *
 * Validation is also done server-side in `placeBet` / `cancelBet`; client
 * checks here are just for instant feedback before the round-trip.
 */
export function BetSheet({
  open,
  onOpenChange,
  stock,
  verdict,
  userCredits,
  betWindowClosesAt,
  resolutionAt,
  existingBet,
}: Props) {
  const isManageMode = !!existingBet;

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
          <SheetDescription className="text-xs">
            {isManageMode ? `Manage your bet · ${stock.name}` : stock.name}
          </SheetDescription>
        </SheetHeader>

        {isManageMode ? (
          <ManageBody
            stock={stock}
            existingBet={existingBet!}
            betWindowClosesAt={betWindowClosesAt}
            onSuccess={() => onOpenChange(false)}
          />
        ) : (
          <PlaceBody
            stock={stock}
            verdict={verdict}
            userCredits={userCredits}
            betWindowClosesAt={betWindowClosesAt}
            resolutionAt={resolutionAt}
            open={open}
            onSuccess={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------ place mode ------------------------------- */

function PlaceBody({
  stock,
  verdict,
  userCredits,
  betWindowClosesAt,
  resolutionAt,
  open,
  onSuccess,
}: {
  stock: { id: string; ticker: string; name: string };
  verdict: MarketMindPrediction | null;
  userCredits: number;
  betWindowClosesAt: Date | null;
  resolutionAt: Date;
  open: boolean;
  onSuccess: () => void;
}) {
  const initialDirection: "UP" | "DOWN" = verdict?.direction === "DOWN" ? "DOWN" : "UP";
  const [direction, setDirection] = useState<"UP" | "DOWN">(initialDirection);
  const [credits, setCredits] = useState<number>(100);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Reset state when the sheet opens for a new stock — otherwise stale
  // direction/error carries between cards. Legitimate "reset on open" sync.
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
        ticker: stock.ticker,
        direction,
        credits,
      });
      if (!result.ok) {
        setError(result.error);
        haptic("warning");
        return;
      }
      haptic("tap");
      toast.success(`Bet placed · ${credits} on ${direction}`, {
        description: `${stock.ticker} · ${formatResolutionCopy(resolutionAt)}`,
      });
      onSuccess();
    });
  }

  return (
    <>
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
    </>
  );
}

/* ------------------------------ manage mode ------------------------------ */

function ManageBody({
  stock,
  existingBet,
  betWindowClosesAt,
  onSuccess,
}: {
  stock: { id: string; ticker: string; name: string };
  existingBet: Prediction;
  betWindowClosesAt: Date | null;
  onSuccess: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const DirectionIcon = existingBet.direction === "UP" ? ArrowUp : ArrowDown;
  const directionTone =
    existingBet.direction === "UP"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
      : "border-rose-500/40 bg-rose-500/10 text-rose-600";
  const profitIfWin = Math.round(existingBet.credits_wagered * PAYOUT_MULT - existingBet.credits_wagered);

  function handleCancel() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await cancelBet({ predictionId: existingBet.id });
      if (!result.ok) {
        setError(result.error);
        setConfirming(false);
        haptic("warning");
        return;
      }
      haptic("double");
      toast.success(`Bet cancelled`, {
        description: `${stock.ticker} · ${existingBet.credits_wagered} credits refunded`,
      });
      onSuccess();
    });
  }

  return (
    <>
      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-4">
        {/* Locked-in summary */}
        <div
          className={cn(
            "flex items-center justify-between gap-3 rounded-lg border p-4",
            directionTone,
          )}
        >
          <div className="flex items-center gap-3">
            <DirectionIcon className="h-6 w-6" aria-hidden />
            <div>
              <p className="font-mono text-2xl font-semibold leading-none">
                {existingBet.direction}
              </p>
              <p className="text-[11px] opacity-80">Your call</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-mono text-2xl font-semibold leading-none tabular-nums">
              {existingBet.credits_wagered}
            </p>
            <p className="text-[11px] opacity-80">credits staked</p>
          </div>
        </div>

        {/* Outcome lookahead */}
        <div className="border-border/60 bg-card/40 space-y-1.5 rounded-lg border p-3">
          <p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
            What happens at close
          </p>
          <PayoutRow
            label={`If ${stock.ticker} closes ${existingBet.direction === "UP" ? "up" : "down"}`}
            value={`+${profitIfWin}`}
            tone="up"
            sub="WIN · payout 1.8× stake"
          />
          <PayoutRow
            label={`If ${stock.ticker} closes ${existingBet.direction === "UP" ? "down" : "up"}`}
            value={`−${existingBet.credits_wagered}`}
            tone="down"
            sub="LOSS · stake forfeited"
          />
          <PayoutRow
            label="If open = close (flat)"
            value="±0"
            tone="neutral"
            sub="VOID · stake refunded"
          />
        </div>

        {/* Cancel deadline — prominent, not buried in 11px gray */}
        {betWindowClosesAt && (
          <div className="border-border/60 bg-card/40 rounded-lg border p-4">
            <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-[11px] font-medium tracking-wider uppercase">
              <Clock className="h-3 w-3" aria-hidden />
              <span>Cancel deadline</span>
            </div>
            <p className="text-foreground text-base font-semibold">
              {formatRelative(betWindowClosesAt)}
            </p>
            <p className="text-muted-foreground text-xs">
              {formatET(betWindowClosesAt)} · after that, you&apos;re locked in until the
              4:15 PM ET resolution.
            </p>
          </div>
        )}

        {error && <p className="text-destructive text-xs">{error}</p>}
      </div>

      <SheetFooter className="border-border/60 flex flex-row gap-2 border-t px-6 py-4">
        <Button
          type="button"
          variant="outline"
          onClick={onSuccess}
          disabled={isPending}
          className="flex-1"
        >
          Keep bet
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={handleCancel}
          disabled={isPending}
          className="flex-1"
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {!isPending && <X className="mr-2 h-4 w-4" aria-hidden />}
          {confirming ? "Confirm cancel" : "Cancel bet"}
        </Button>
      </SheetFooter>
    </>
  );
}

/* ------------------------------ subcomponents ----------------------------- */

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
