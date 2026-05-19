"use client";

import { useEffect, useState } from "react";
import {
  Clock,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatET,
  formatRelative,
  getMarketSchedule,
  type CyclePhase,
  type MarketSchedule,
} from "@/lib/market-schedule";

/**
 * Live market-schedule bar shown at the top of the home feed.
 *
 * Top panel is a state-aware headline answering "what should I care about
 * right now?" — varies by cycle phase (predictions just dropped, market
 * open with bets still open, bets locked watching live, etc.).
 *
 * Three-column footer reinforces with: which trading day, bet window
 * state, next pipeline refresh.
 *
 * Ticks every 30s on the client so countdowns stay accurate.
 */
export function MarketScheduleBar() {
  const [schedule, setSchedule] = useState<MarketSchedule | null>(null);

  useEffect(() => {
    // First call on mount (server skipped this — Date is local-tz on server,
    // we only trust client time). Then a 30s tick keeps countdowns fresh.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSchedule(getMarketSchedule());
    const id = setInterval(() => setSchedule(getMarketSchedule()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Server render: reserve space; client will hydrate with live data.
  if (!schedule) {
    return <div className="border-border/60 bg-card/30 h-[160px] rounded-xl border" />;
  }

  const headline = headlineForPhase(schedule);

  return (
    <div className="border-border/60 bg-card/30 space-y-4 rounded-xl border p-4">
      {/* State-aware headline — the most important thing for THIS moment */}
      <div
        className={cn(
          "flex items-start gap-3 rounded-lg border p-3",
          headline.tone === "live"
            ? "border-emerald-500/30 bg-emerald-500/5"
            : headline.tone === "locked"
              ? "border-amber-500/30 bg-amber-500/5"
              : "border-border/40 bg-card/30",
        )}
      >
        <headline.Icon
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            headline.tone === "live"
              ? "text-emerald-500"
              : headline.tone === "locked"
                ? "text-amber-500"
                : "text-muted-foreground",
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug font-semibold">{headline.title}</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-snug">{headline.sub}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Trading day */}
        <div className="space-y-0.5">
          <div className="text-muted-foreground flex items-center gap-1.5 text-[10px] tracking-wider uppercase">
            <Clock className="h-3 w-3" aria-hidden />
            <span>Showing insights for</span>
          </div>
          <p className="text-sm font-semibold">{schedule.tradingDayHuman}</p>
          <p className="text-muted-foreground text-[11px]">
            <MarketStateLabel state={schedule.state} schedule={schedule} />
          </p>
        </div>

        {/* Bet window */}
        <div className="space-y-0.5">
          <div className="text-muted-foreground flex items-center gap-1.5 text-[10px] tracking-wider uppercase">
            {schedule.betWindowOpen ? (
              <TrendingUp className="h-3 w-3 text-emerald-500" aria-hidden />
            ) : (
              <TrendingDown className="text-muted-foreground h-3 w-3" aria-hidden />
            )}
            <span>Bet window</span>
          </div>
          <p
            className={cn(
              "text-sm font-semibold",
              schedule.betWindowOpen ? "text-emerald-500" : "text-muted-foreground",
            )}
          >
            {schedule.betWindowOpen ? "Open" : "Closed"}
          </p>
          <p className="text-muted-foreground text-[11px]">
            {schedule.betWindowOpen && schedule.betWindowClosesAt
              ? `Locks ${formatRelative(schedule.betWindowClosesAt)} · ${formatET(schedule.betWindowClosesAt)}`
              : `Opens ${formatRelative(schedule.betWindowOpensAt)} · ${formatET(schedule.betWindowOpensAt)}`}
          </p>
        </div>

        {/* Next refresh */}
        <div className="space-y-0.5">
          <div className="text-muted-foreground flex items-center gap-1.5 text-[10px] tracking-wider uppercase">
            <RefreshCw className="h-3 w-3" aria-hidden />
            <span>Next insights refresh</span>
          </div>
          <p className="text-sm font-semibold">{formatRelative(schedule.nextPipelineCompletion)}</p>
          <p className="text-muted-foreground text-[11px]">
            Starts {formatET(schedule.nextPipelineRun)}, live by{" "}
            {formatET(schedule.nextPipelineCompletion)}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Build the prominent state-aware headline shown at the top of the bar. */
function headlineForPhase(s: MarketSchedule): {
  Icon: LucideIcon;
  title: string;
  sub: string;
  tone: "live" | "locked" | "neutral";
} {
  const phase: CyclePhase = s.phase;
  const lockTime = s.betWindowClosesAt ?? s.resolutionAt;

  switch (phase) {
    case "after-pipeline":
      return {
        Icon: Sparkles,
        tone: "live",
        title: `Fresh predictions for ${s.tradingDayHuman} are live`,
        sub: `Bet window open — locks ${formatRelative(lockTime)} (${formatET(lockTime)})`,
      };

    case "pre-market-bet-open":
      return {
        Icon: TrendingUp,
        tone: "live",
        title: `Today's predictions are live · Bet window open`,
        sub: `Market opens 9:30 AM ET. Bet window locks at 1:00 PM ET (${formatRelative(lockTime)}).`,
      };

    case "market-open-bet-open":
      return {
        Icon: TrendingUp,
        tone: "live",
        title: `Market open · Bet window closes ${formatRelative(lockTime)}`,
        sub: `Last chance to place bets — locks ${formatET(lockTime)}. Watch live prices to confirm or fade the call.`,
      };

    case "market-open-bet-locked":
      return {
        Icon: Clock,
        tone: "locked",
        title: `Bets locked · Resolution ${formatRelative(s.resolutionAt)}`,
        sub: `Watching live until market close. Outcomes settle ${formatET(s.resolutionAt)}.`,
      };

    case "post-resolution":
      return {
        Icon: Zap,
        tone: "neutral",
        title: `Today's results in. Tomorrow's predictions land ${formatRelative(s.nextPipelineCompletion)}.`,
        sub: `Pipeline kicks off ${formatET(s.nextPipelineRun)} and is usually live by ${formatET(s.nextPipelineCompletion)}. Bet window opens once it lands.`,
      };

    case "pipeline-running":
      return {
        Icon: RefreshCw,
        tone: "neutral",
        title: `Pipeline running · Fresh predictions land ${formatRelative(s.nextPipelineCompletion)}`,
        sub: `Started ${formatET(s.nextPipelineRun)}, usually done by ${formatET(s.nextPipelineCompletion)}. You're seeing today's resolved data until it finishes.`,
      };

    case "weekend":
      return {
        Icon: Zap,
        tone: "neutral",
        title: `Markets closed · Next predictions land ${formatRelative(s.nextPipelineCompletion)}`,
        sub: `Pipeline runs ${formatET(s.nextPipelineRun)} and is typically live by ${formatET(s.nextPipelineCompletion)}. Bet window opens then.`,
      };
  }
}

function MarketStateLabel({
  state,
  schedule,
}: {
  state: MarketSchedule["state"];
  schedule: MarketSchedule;
}) {
  if (state === "open") {
    return <>Market is open · resolution at 4:15 PM ET</>;
  }
  if (state === "pre-market") {
    return <>Pre-market · opens 9:30 AM ET</>;
  }
  if (state === "post-close") {
    return <>Market closed · resolution ran at 4:15 PM</>;
  }
  // weekend
  return <>Markets closed · {formatRelative(schedule.nextPipelineRun)} until next pipeline run</>;
}
