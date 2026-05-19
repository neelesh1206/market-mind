"use client";

import { useEffect, useState } from "react";
import { Clock, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatET,
  formatRelative,
  getMarketSchedule,
  type MarketSchedule,
} from "@/lib/market-schedule";

/**
 * Live market-schedule bar shown at the top of the home feed.
 *
 * Answers the four questions every user has:
 *   - Which trading day do the insights apply to?
 *   - Is the market open right now?
 *   - Can I place bets right now? When does the window close?
 *   - When will fresh insights drop?
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
    return <div className="border-border/60 bg-card/30 h-[78px] rounded-xl border" />;
  }

  return (
    <div className="border-border/60 bg-card/30 grid grid-cols-1 gap-3 rounded-xl border p-4 sm:grid-cols-3">
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
        <p className="text-sm font-semibold">{formatRelative(schedule.nextPipelineRun)}</p>
        <p className="text-muted-foreground text-[11px]">{formatET(schedule.nextPipelineRun)}</p>
      </div>
    </div>
  );
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
