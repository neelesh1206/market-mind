"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import confetti from "canvas-confetti";
import { ArrowDown, ArrowUp, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { markRevealed } from "@/app/actions/reveals";
import type { BetHistoryRow } from "@/lib/bets";

type Props = {
  bets: BetHistoryRow[];
};

/**
 * Auto-opening reveal modal — shown when the user lands on / with resolved
 * bets they haven't seen yet. Sequential card flip per bet, confetti on WIN.
 *
 * Persistence: marks the entire batch as revealed via `markRevealed` server
 * action on close, OR per-card as the user advances if they exit mid-flow.
 *
 * Accessibility: respects `prefers-reduced-motion` — disables the 3D flip
 * and the confetti shower, falls back to an instant fade-in of the back face.
 */
export function ResultRevealModal({ bets }: Props) {
  const reducedMotion = useReducedMotion();
  const [open, setOpen] = useState(bets.length > 0);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [, startTransition] = useTransition();
  const persistedIds = useRef<Set<string>>(new Set());

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const current = bets[index] ?? null;
  const isWin = current?.outcome === "WIN";

  // Fire confetti on flip-to-win — once per card, never on reduced-motion.
  useEffect(() => {
    if (!flipped || !isWin || reducedMotion) return;
    confetti({
      particleCount: 80,
      spread: 70,
      startVelocity: 35,
      ticks: 200,
      origin: { y: 0.45 },
      colors: ["#10b981", "#34d399", "#6ee7b7", "#fafafa"],
      scalar: 0.9,
    });
  }, [flipped, isWin, reducedMotion]);

  if (!open || !current) return null;

  function persistAndAdvance(nextIndex: number) {
    if (!current) return;
    if (!persistedIds.current.has(current.id)) {
      persistedIds.current.add(current.id);
      const idToPersist = current.id;
      startTransition(async () => {
        await markRevealed([idToPersist]);
      });
    }
    setFlipped(false);
    setIndex(nextIndex);
  }

  function handleNext() {
    if (!flipped) {
      setFlipped(true);
      return;
    }
    const next = index + 1;
    if (next >= bets.length) {
      handleClose();
      return;
    }
    persistAndAdvance(next);
  }

  function handleClose() {
    // Flush any unpersisted IDs (e.g. skip-all on first card).
    const unpersisted = bets
      .map((b) => b.id)
      .filter((id) => !persistedIds.current.has(id));
    if (unpersisted.length > 0) {
      startTransition(async () => {
        await markRevealed(unpersisted);
      });
    }
    setOpen(false);
  }

  return (
    <AnimatePresence>
      <motion.div
        key="overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label="Bet results"
      >
        {/* Header — close + progress */}
        <div className="absolute top-0 right-0 left-0 flex items-center justify-between p-4 sm:p-6">
          <div className="text-muted-foreground text-xs tracking-wider uppercase">
            Result {index + 1} of {bets.length}
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close reveals"
            className="text-muted-foreground hover:text-foreground rounded-md p-1.5 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Flip card */}
        <div
          style={{ perspective: 1200 }}
          className="w-[min(420px,90vw)] cursor-pointer"
          onClick={handleNext}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleNext();
            }
          }}
        >
          <motion.div
            key={current.id}
            initial={false}
            animate={{ rotateY: flipped && !reducedMotion ? 180 : 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformStyle: "preserve-3d" }}
            className="relative h-[440px] w-full"
          >
            {/* Front — masked bet */}
            <CardFace>
              <div className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                Your bet
              </div>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="font-mono text-4xl font-bold">{current.stock.ticker}</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-sm font-semibold",
                    current.direction === "UP"
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                      : "border-rose-500/40 bg-rose-500/10 text-rose-600",
                  )}
                >
                  {current.direction === "UP" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                  {current.direction}
                </span>
              </div>
              <div className="text-muted-foreground mt-1 text-sm">{current.stock.name}</div>
              <div className="mt-6 flex items-center gap-2">
                <span className="font-mono text-2xl font-semibold">
                  {current.credits_wagered}
                </span>
                <span className="text-muted-foreground text-xs">credits staked</span>
              </div>
              <div className="text-muted-foreground mt-auto text-center text-xs">
                Tap to reveal outcome
                <ChevronRight className="ml-1 inline h-3.5 w-3.5" />
              </div>
            </CardFace>

            {/* Back — outcome */}
            <CardFace
              style={{
                transform: reducedMotion ? "none" : "rotateY(180deg)",
                opacity: reducedMotion && flipped ? 1 : undefined,
                pointerEvents: reducedMotion && !flipped ? "none" : undefined,
              }}
              backFace
              outcome={current.outcome}
            >
              <OutcomeBody bet={current} />
              <div className="text-muted-foreground mt-auto text-center text-xs">
                {index + 1 < bets.length ? (
                  <>
                    Tap for next result <ChevronRight className="ml-1 inline h-3.5 w-3.5" />
                  </>
                ) : (
                  "Tap to close"
                )}
              </div>
            </CardFace>
          </motion.div>
        </div>

        {/* Footer link to history */}
        <Link
          href="/bets"
          onClick={handleClose}
          className="text-muted-foreground hover:text-foreground absolute bottom-6 text-xs underline-offset-2 hover:underline"
        >
          View full bet history →
        </Link>
      </motion.div>
    </AnimatePresence>
  );
}

function CardFace({
  children,
  style,
  backFace,
  outcome,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  backFace?: boolean;
  outcome?: BetHistoryRow["outcome"];
}) {
  const tone =
    outcome === "WIN"
      ? "border-emerald-500/50 from-emerald-500/15 to-card"
      : outcome === "LOSS"
        ? "border-rose-500/50 from-rose-500/15 to-card"
        : outcome === "VOID"
          ? "border-border from-card to-card"
          : "border-border/60 from-card to-card";

  return (
    <div
      style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", ...style }}
      className={cn(
        "absolute inset-0 flex flex-col rounded-2xl border bg-gradient-to-br p-6 shadow-2xl backdrop-blur",
        backFace ? "bg-card" : "bg-card",
        tone,
      )}
    >
      {children}
    </div>
  );
}

function OutcomeBody({ bet }: { bet: BetHistoryRow }) {
  const outcome = bet.outcome;
  const net = bet.payout !== null ? bet.payout - bet.credits_wagered : 0;

  if (outcome === "WIN") {
    return (
      <>
        <div className="text-xs font-medium tracking-wider text-emerald-500 uppercase">
          Win
        </div>
        <div className="mt-2 font-mono text-5xl font-bold text-emerald-500">
          +{net}
        </div>
        <div className="text-muted-foreground mt-1 text-sm">
          Payout: {bet.payout} credits (1.8× stake)
        </div>
        <div className="mt-6 space-y-1 text-sm">
          <Row label={`${bet.stock.ticker} open`} value={`$${bet.open_price?.toFixed(2) ?? "—"}`} />
          <Row label={`${bet.stock.ticker} close`} value={`$${bet.close_price?.toFixed(2) ?? "—"}`} />
          <Row
            label="Your call"
            value={`${bet.direction} · correct`}
            tone="up"
          />
        </div>
      </>
    );
  }
  if (outcome === "LOSS") {
    return (
      <>
        <div className="text-xs font-medium tracking-wider text-rose-500 uppercase">Loss</div>
        <div className="mt-2 font-mono text-5xl font-bold text-rose-500">
          −{bet.credits_wagered}
        </div>
        <div className="text-muted-foreground mt-1 text-sm">Stake forfeited</div>
        <div className="mt-6 space-y-1 text-sm">
          <Row label={`${bet.stock.ticker} open`} value={`$${bet.open_price?.toFixed(2) ?? "—"}`} />
          <Row label={`${bet.stock.ticker} close`} value={`$${bet.close_price?.toFixed(2) ?? "—"}`} />
          <Row
            label="Your call"
            value={`${bet.direction} · wrong direction`}
            tone="down"
          />
        </div>
      </>
    );
  }
  // VOID
  return (
    <>
      <div className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
        Void · flat tape
      </div>
      <div className="text-muted-foreground mt-2 font-mono text-5xl font-bold">±0</div>
      <div className="text-muted-foreground mt-1 text-sm">
        {bet.credits_wagered} credits refunded — open price matched close.
      </div>
    </>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span
        className={cn(
          "font-mono text-sm font-medium tabular-nums",
          tone === "up" && "text-emerald-500",
          tone === "down" && "text-rose-500",
        )}
      >
        {value}
      </span>
    </div>
  );
}
