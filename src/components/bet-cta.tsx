"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, Clock, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BetSheet } from "@/components/bet-sheet";
import { cn } from "@/lib/utils";
import { formatET, formatRelative } from "@/lib/market-schedule";
import type { Prediction } from "@/lib/bets";
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
  /** "sm" for card footer, "lg" for the detail-page section. */
  size?: "sm" | "lg";
};

/**
 * Three-state CTA for the bet flow:
 *   1. userBet present → locked-in chip (no further action this trading day)
 *   2. window open      → "Place bet" button that opens BetSheet
 *   3. window closed    → muted "Bet window opens in 4h" label
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
  size = "sm",
}: Props) {
  const [open, setOpen] = useState(false);

  // State 1: already bet today.
  if (userBet) {
    return (
      <LockedInChip
        bet={userBet}
        betWindowOpen={betWindowOpen}
        resolutionAt={resolutionAt}
        size={size}
      />
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
      />
    </>
  );
}

function LockedInChip({
  bet,
  betWindowOpen,
  resolutionAt,
  size,
}: {
  bet: Prediction;
  betWindowOpen: boolean;
  resolutionAt: Date;
  size: "sm" | "lg";
}) {
  const Icon = bet.direction === "UP" ? ArrowUp : ArrowDown;
  const tone =
    bet.direction === "UP"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
      : "border-rose-500/40 bg-rose-500/10 text-rose-600";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5",
        tone,
        size === "lg" && "px-3 py-2",
      )}
      title={`Locked in at ${new Date(bet.locked_at).toLocaleString()}`}
    >
      <CheckCircle2 className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden />
      <Icon className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden />
      <div className="flex items-baseline gap-1.5 font-mono">
        <span className={cn("font-semibold", size === "lg" ? "text-sm" : "text-xs")}>
          {bet.direction}
        </span>
        <span className={cn(size === "lg" ? "text-sm" : "text-xs")}>· {bet.credits_wagered}</span>
      </div>
      <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px] font-normal">
        <Lock className="h-3 w-3" aria-hidden />
        {betWindowOpen ? "Locked in" : `Resolves ${formatRelative(resolutionAt)}`}
      </span>
    </div>
  );
}
