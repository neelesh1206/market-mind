"use client";

import { useState } from "react";
import { AlertCircle, ArrowDown, ArrowUp, CheckCircle2, Clock, Lock, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BetSheet } from "@/components/bet-sheet";
import { cn } from "@/lib/utils";
import { formatET, formatRelative } from "@/lib/market-schedule";
import { isStuckPrediction, type Prediction } from "@/lib/bets";
import type { MarketMindPrediction } from "@/types/insight";

type Stock = { id: string; ticker: string; name: string };

type Props = {
  stock: Stock;
  verdict: MarketMindPrediction | null;
  userBet: Prediction | null;
  userCredits: number;
  betWindowOpen: boolean;
  /** When the window locks today (null if already locked). */
  betWindowClosesAt: Date | null;
  /** When the window opens next (used when currently closed). */
  betWindowOpensAt: Date;
  /** When today's bets resolve. Used for the locked-in chip after the window closes. */
  resolutionAt: Date;
  /**
   * Today's ET calendar date (YYYY-MM-DD). Used to derive whether an
   * existing bet is past its resolution date but still unresolved — drives
   * the "Resolution delayed" UI variant of the chip.
   */
  todayEt: string;
  /** "sm" for card footer, "lg" for the detail-page section. */
  size?: "sm" | "lg";
};

/**
 * Three-state CTA for the bet flow:
 *   1. userBet present → locked-in chip (clickable to cancel while window open)
 *   2. window open + no bet → "Place bet" button that opens BetSheet
 *   3. window closed + no bet → muted "Bet window opens in 4h" label
 *
 * Centralized here so the StockCard footer and stock-detail section stay in
 * sync — same component, different `size`.
 */
export function BetCta({
  stock,
  verdict,
  userBet,
  userCredits,
  betWindowOpen,
  betWindowClosesAt,
  betWindowOpensAt,
  resolutionAt,
  todayEt,
  size = "sm",
}: Props) {
  const [open, setOpen] = useState(false);
  const cancellable = !!userBet && betWindowOpen;
  const stuck = !!userBet && isStuckPrediction(userBet, todayEt);

  // State 1: already bet today. Chip is clickable IFF the window is still open
  // (so the user can cancel); after lock it's a passive status indicator.
  if (userBet) {
    return (
      <>
        <LockedInChip
          bet={userBet}
          betWindowOpen={betWindowOpen}
          resolutionAt={resolutionAt}
          stuck={stuck}
          size={size}
          onClick={cancellable ? () => setOpen(true) : undefined}
        />
        {cancellable && (
          <BetSheet
            open={open}
            onOpenChange={setOpen}
            stock={stock}
            verdict={verdict}
            userCredits={userCredits}
            betWindowClosesAt={betWindowClosesAt}
            resolutionAt={resolutionAt}
            existingBet={userBet}
          />
        )}
      </>
    );
  }

  // State 3: window closed.
  if (!betWindowOpen) {
    return (
      <p
        className={cn(
          "text-muted-foreground inline-flex items-center gap-1.5",
          size === "lg" ? "text-sm" : "text-xs",
        )}
      >
        <Clock className={size === "lg" ? "h-4 w-4" : "h-3 w-3"} aria-hidden />
        Bet window opens {formatRelative(betWindowOpensAt)} · {formatET(betWindowOpensAt)}
      </p>
    );
  }

  // State 2: window open — render trigger + sheet.
  return (
    <>
      <Button
        type="button"
        size={size === "lg" ? "lg" : "sm"}
        onClick={() => setOpen(true)}
        className={cn(
          "gap-1.5 bg-emerald-600 text-white hover:bg-emerald-600/90",
          size === "sm" && "h-8",
        )}
      >
        <ArrowUp className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden />
        Place bet
      </Button>
      <BetSheet
        open={open}
        onOpenChange={setOpen}
        stock={stock}
        verdict={verdict}
        userCredits={userCredits}
        betWindowClosesAt={betWindowClosesAt}
        resolutionAt={resolutionAt}
      />
    </>
  );
}

function LockedInChip({
  bet,
  betWindowOpen,
  resolutionAt,
  stuck,
  size,
  onClick,
}: {
  bet: Prediction;
  betWindowOpen: boolean;
  resolutionAt: Date;
  /** True when prediction_date has passed but resolved is still false. */
  stuck: boolean;
  size: "sm" | "lg";
  /** When provided, the chip renders as a button (cancellable). */
  onClick?: () => void;
}) {
  const Icon = bet.direction === "UP" ? ArrowUp : ArrowDown;
  // Stuck chips override the direction tone with amber — the resolution
  // state is the most important fact to surface, not which way the user bet.
  const tone = stuck
    ? "border-amber-500/50 bg-amber-500/15 text-amber-600"
    : bet.direction === "UP"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
      : "border-rose-500/40 bg-rose-500/10 text-rose-600";

  const className = cn(
    "inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 transition-all",
    tone,
    size === "lg" && "px-3 py-2",
    onClick &&
      "cursor-pointer hover:brightness-110 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
    bet.direction === "UP" && onClick && "focus-visible:ring-emerald-500",
    bet.direction === "DOWN" && onClick && "focus-visible:ring-rose-500",
  );

  const tipText = onClick
    ? "Click to manage or cancel"
    : `Locked in at ${new Date(bet.locked_at).toLocaleString()}`;

  const content = (
    <>
      {onClick ? (
        <Pencil className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden />
      ) : (
        <CheckCircle2 className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden />
      )}
      <Icon className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden />
      <div className="flex items-baseline gap-1.5 font-mono">
        <span className={cn("font-semibold", size === "lg" ? "text-sm" : "text-xs")}>
          {bet.direction}
        </span>
        <span className={cn(size === "lg" ? "text-sm" : "text-xs")}>· {bet.credits_wagered}</span>
      </div>
      <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px] font-normal">
        {stuck ? (
          <>
            <AlertCircle className="h-3 w-3 text-amber-600" aria-hidden />
            Resolution delayed
          </>
        ) : (
          <>
            <Lock className="h-3 w-3" aria-hidden />
            {betWindowOpen ? "Cancel before 1 PM" : `Resolves ${formatRelative(resolutionAt)}`}
          </>
        )}
      </span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className} title={tipText}>
        {content}
      </button>
    );
  }

  return (
    <div className={className} title={tipText}>
      {content}
    </div>
  );
}
