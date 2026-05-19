/**
 * Eastern-Time-aware market schedule helpers.
 *
 * Everything keyed off `America/New_York`. We avoid heavy date libs by using
 * `Intl.DateTimeFormat` with `formatToParts` to read individual fields in ET.
 *
 * Schedule constants (all ET):
 *   - 8:00 PM   pipeline runs (computes next trading day's insights)
 *   - 9:30 AM   market opens (bet window closes 15 min earlier)
 *   - 4:00 PM   market closes
 *   - 4:15 PM   resolution job runs
 *
 * Bet window: 8:00 PM (after pipeline) → 9:15 AM next trading day.
 * Holidays not handled — pipeline cron itself uses pandas-market-calendars,
 * UI just shows "no trading today" on weekends. Good enough for MVP.
 */

const ET = "America/New_York";

type ETParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=Sunday, 6=Saturday
};

/** Read the parts of `date` as seen in ET. */
function inET(date: Date): ETParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(date);

  const lookup: Record<string, string> = {};
  for (const p of parts) lookup[p.type] = p.value;

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  // hour=24 happens when ET clock reads "24:00:00" instead of "00:00:00" on rollover.
  const rawHour = parseInt(lookup.hour ?? "0", 10);
  const hour = rawHour === 24 ? 0 : rawHour;

  return {
    year: parseInt(lookup.year ?? "0", 10),
    month: parseInt(lookup.month ?? "0", 10),
    day: parseInt(lookup.day ?? "0", 10),
    hour,
    minute: parseInt(lookup.minute ?? "0", 10),
    weekday: weekdayMap[lookup.weekday ?? ""] ?? 0,
  };
}

/** Build a Date that, when read in ET, will have the given (y,m,d,h,m). */
function fromET(year: number, month: number, day: number, hour: number, minute: number): Date {
  // Best-effort: construct as UTC, then adjust by ET offset. ET offset varies
  // by DST so we iteratively converge — at most 2 iterations needed in practice.
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  for (let i = 0; i < 3; i++) {
    const parts = inET(guess);
    const deltaMin =
      (parts.year - year) * 365 * 24 * 60 +
      (parts.month - month) * 30 * 24 * 60 +
      (parts.day - day) * 24 * 60 +
      (parts.hour - hour) * 60 +
      (parts.minute - minute);
    if (deltaMin === 0) break;
    guess = new Date(guess.getTime() - deltaMin * 60_000);
  }
  return guess;
}

const PIPELINE_HOUR_ET = 20; // 8 PM ET — pipeline START
// Pipeline typically completes within this many minutes after start. Used to
// communicate a *window* ("by ~8:25 PM ET") instead of pretending the drop is
// instant at 8:00. Recent end-to-end runs cluster around 18 min; 25 gives
// headroom for HF retries / slow article fetches without crying wolf.
const PIPELINE_TYPICAL_DURATION_MIN = 25;
const MARKET_OPEN_HOUR_ET = 9;
const MARKET_OPEN_MIN_ET = 30;
const MARKET_CLOSE_HOUR_ET = 16; // 4 PM
const RESOLUTION_HOUR_ET = 16;
const RESOLUTION_MIN_ET = 15;
// Bet window now locks at 1 PM ET (= 10 AM PT). See ADR 0008.
// Lets users bet through morning + early-afternoon trading on the day,
// not just the 8 PM → 9:15 AM dead-of-night window. Late bettors trade
// prediction time for confirmation (live price action).
const BET_LOCK_HOUR_ET = 13;
const BET_LOCK_MIN_ET = 0;

function isWeekend(weekday: number): boolean {
  return weekday === 0 || weekday === 6;
}

/** Add N days to an ET date, returning a Date pointing at midnight ET. */
function addDays(base: { year: number; month: number; day: number }, n: number): Date {
  return fromET(base.year, base.month, base.day + n, 0, 0);
}

/** Next ET weekday at midnight (returns same date if already a weekday). */
function nextWeekdayStart(from: Date): Date {
  let cursor = from;
  for (let i = 0; i < 7; i++) {
    const parts = inET(cursor);
    if (!isWeekend(parts.weekday)) {
      return fromET(parts.year, parts.month, parts.day, 0, 0);
    }
    cursor = new Date(cursor.getTime() + 86400_000);
  }
  return cursor;
}

export type MarketState =
  | "pre-market" // weekday before 9:30 AM ET
  | "open" // weekday 9:30 AM – 4:00 PM ET
  | "post-close" // weekday 4:00 PM – next-day pipeline
  | "weekend"; // Saturday / Sunday

/**
 * Granular phase of the daily cycle — used to drive headline copy.
 * Distinguishes "bet open during market" from "bet locked but market open"
 * etc, which the coarser `MarketState` doesn't.
 */
export type CyclePhase =
  | "pre-market-bet-open" // before 9:30 AM weekday, bet window already open from prior 8 PM
  | "market-open-bet-open" // 9:30 AM – 1 PM ET, both bet + market open
  | "market-open-bet-locked" // 1 PM – 4 PM ET, market still open but bets locked
  | "post-resolution" // 4:15 PM – 8 PM ET, today done, tomorrow not yet computed
  | "pipeline-running" // 8:00 PM – ~8:25 PM ET, pipeline crunching tomorrow's data
  | "after-pipeline" // ~8:25 PM – next-day 9:30 AM, fresh predictions, bet window open
  | "weekend"; // Saturday / Sunday

export type MarketSchedule = {
  /** Coarse market state (preserved for backwards-compatible UI logic). */
  state: MarketState;
  /** Granular cycle phase, used for state-aware headline copy. */
  phase: CyclePhase;
  /** Trading day that currently-visible insights apply to (ISO yyyy-mm-dd). */
  tradingDayLabel: string;
  /** Human-readable trading day, e.g. "Monday, Oct 21". */
  tradingDayHuman: string;
  /** When the next pipeline run STARTS (cron trigger). */
  nextPipelineRun: Date;
  /**
   * When fresh insights are expected to be queryable — i.e. pipeline start +
   * typical duration. Use this in UX copy ("predictions live by ~8:25 PM ET")
   * so users aren't told 8:00 and then wait staring at stale data.
   */
  nextPipelineCompletion: Date;
  /** When the bet window closes for the current trading day (null if already closed). */
  betWindowClosesAt: Date | null;
  /** When the bet window opens for the next trading day. */
  betWindowOpensAt: Date;
  /** Is the bet window currently open? */
  betWindowOpen: boolean;
  /** When resolution will run (or did run) for the active trading day. */
  resolutionAt: Date;
  /** Current ET-local clock as parts, for display. */
  nowET: ETParts;
};

/**
 * Compute the schedule snapshot for `now`.
 *
 * The "trading day" we're showing depends on time of day:
 *  - During pre-market or market hours: today
 *  - After 4 PM ET on a weekday: today (showing the resolution outcome)
 *  - After 8 PM ET: tomorrow (pipeline ran, new prediction for tomorrow)
 *  - Weekend: next Monday
 */
export function getMarketSchedule(now: Date = new Date()): MarketSchedule {
  const nowET = inET(now);

  // Helpers
  const todayDate = { year: nowET.year, month: nowET.month, day: nowET.day };
  const pipelineToday = fromET(todayDate.year, todayDate.month, todayDate.day, PIPELINE_HOUR_ET, 0);
  const pipelineCompleteToday = new Date(
    pipelineToday.getTime() + PIPELINE_TYPICAL_DURATION_MIN * 60_000,
  );
  const marketOpenToday = fromET(
    todayDate.year,
    todayDate.month,
    todayDate.day,
    MARKET_OPEN_HOUR_ET,
    MARKET_OPEN_MIN_ET,
  );
  const marketCloseToday = fromET(
    todayDate.year,
    todayDate.month,
    todayDate.day,
    MARKET_CLOSE_HOUR_ET,
    0,
  );
  const resolutionToday = fromET(
    todayDate.year,
    todayDate.month,
    todayDate.day,
    RESOLUTION_HOUR_ET,
    RESOLUTION_MIN_ET,
  );
  // Determine which trading day current insights apply to.
  let tradingDate: Date;
  if (isWeekend(nowET.weekday)) {
    // Weekend: insights apply to next Monday (pipeline ran Friday 8 PM)
    tradingDate = nextWeekdayStart(now);
  } else if (now.getTime() >= pipelineCompleteToday.getTime()) {
    // After tonight's pipeline has completed: insights are for tomorrow's
    // trading day (or Monday if today is Friday). We deliberately wait for
    // *completion*, not the 8 PM start — during the run the DB still holds
    // yesterday's verdict and we shouldn't claim tomorrow's is "live".
    tradingDate = nextWeekdayStart(new Date(now.getTime() + 86400_000));
  } else {
    // Pre-pipeline today: insights are for TODAY's trading day
    tradingDate = fromET(todayDate.year, todayDate.month, todayDate.day, 0, 0);
  }

  const tradingParts = inET(tradingDate);
  const tradingDayLabel = `${tradingParts.year}-${pad(tradingParts.month)}-${pad(tradingParts.day)}`;
  const tradingDayHuman = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(tradingDate);

  // Next pipeline run: today's 8 PM if not yet passed (and weekday), else next weekday 8 PM
  let nextPipelineRun: Date;
  if (!isWeekend(nowET.weekday) && now.getTime() < pipelineToday.getTime()) {
    nextPipelineRun = pipelineToday;
  } else {
    // Find next weekday's 8 PM
    const nextWeekday = nextWeekdayStart(new Date(now.getTime() + 86400_000));
    const wp = inET(nextWeekday);
    nextPipelineRun = fromET(wp.year, wp.month, wp.day, PIPELINE_HOUR_ET, 0);
  }

  // Bet window: open from 8 PM the trading-day-before, closes at 9:15 AM trading day
  // For today's trading: bet window opened last 8 PM (or earlier on weekends)
  const tradingDayBetLock = fromET(
    tradingParts.year,
    tradingParts.month,
    tradingParts.day,
    BET_LOCK_HOUR_ET,
    BET_LOCK_MIN_ET,
  );
  const tradingDayBetOpen = (() => {
    // Go to the prior weekday's 8 PM
    let cursor = addDays(tradingParts, -1);
    while (isWeekend(inET(cursor).weekday)) {
      cursor = new Date(cursor.getTime() - 86400_000);
    }
    const p = inET(cursor);
    return fromET(p.year, p.month, p.day, PIPELINE_HOUR_ET, 0);
  })();

  const betWindowOpen =
    now.getTime() >= tradingDayBetOpen.getTime() && now.getTime() < tradingDayBetLock.getTime();
  const betWindowClosesAt = betWindowOpen ? tradingDayBetLock : null;
  // Next opens: if window still open, it's already open. If closed, it'll re-open
  // at tonight's 8 PM pipeline (or next weekday).
  const betWindowOpensAt = betWindowOpen ? tradingDayBetOpen : nextPipelineRun;

  // Determine state
  let state: MarketState;
  if (isWeekend(nowET.weekday)) {
    state = "weekend";
  } else if (now.getTime() < marketOpenToday.getTime()) {
    state = "pre-market";
  } else if (now.getTime() < marketCloseToday.getTime()) {
    state = "open";
  } else {
    state = "post-close";
  }

  // Granular phase — drives the state-aware headline copy.
  let phase: CyclePhase;
  if (state === "weekend") {
    phase = "weekend";
  } else if (state === "pre-market") {
    phase = "pre-market-bet-open"; // bet window opened last 8 PM, still open
  } else if (state === "open") {
    phase = betWindowOpen ? "market-open-bet-open" : "market-open-bet-locked";
  } else {
    // post-close: bet window already closed; tomorrow's predictions come at 8 PM.
    // Three sub-phases: waiting → running → done.
    if (now.getTime() < pipelineToday.getTime()) {
      phase = "post-resolution";
    } else if (now.getTime() < pipelineCompleteToday.getTime()) {
      phase = "pipeline-running";
    } else {
      phase = "after-pipeline";
    }
  }

  const nextPipelineCompletion = new Date(
    nextPipelineRun.getTime() + PIPELINE_TYPICAL_DURATION_MIN * 60_000,
  );

  return {
    state,
    phase,
    tradingDayLabel,
    tradingDayHuman,
    nextPipelineRun,
    nextPipelineCompletion,
    betWindowClosesAt,
    betWindowOpensAt,
    betWindowOpen,
    resolutionAt: resolutionToday,
    nowET,
  };
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Format a Date relative to now in human terms ("in 2h 14m", "in 4d"). */
export function formatRelative(target: Date, now: Date = new Date()): string {
  const diff = target.getTime() - now.getTime();
  const past = diff < 0;
  const absMs = Math.abs(diff);
  const min = Math.floor(absMs / 60_000);
  const h = Math.floor(min / 60);
  const d = Math.floor(h / 24);

  let label: string;
  if (d > 0) label = `${d}d ${h % 24}h`;
  else if (h > 0) label = `${h}h ${min % 60}m`;
  else if (min > 0) label = `${min}m`;
  else label = "moments";

  return past ? `${label} ago` : `in ${label}`;
}

/**
 * Smart resolution copy for bet-placement toasts / chips.
 *
 *   - Same ET day as now → "Resolves today at 4:15 PM ET"
 *   - Next ET day        → "Resolves tomorrow at 4:15 PM ET"
 *   - Further out (Fri bet for Mon) → "Resolves Mon at 4:15 PM ET"
 *
 * Date comparison is done in ET, not local — a 9 PM PT bet (= 12 AM ET next
 * day) is for *tomorrow's* trading day even though the user's wall clock
 * still says today.
 */
export function formatResolutionCopy(resolutionAt: Date, now: Date = new Date()): string {
  const nowParts = inET(now);
  const resParts = inET(resolutionAt);
  const sameDay =
    nowParts.year === resParts.year &&
    nowParts.month === resParts.month &&
    nowParts.day === resParts.day;

  // Tomorrow check: add 1 day to now in ET and compare.
  const tomorrow = fromET(nowParts.year, nowParts.month, nowParts.day + 1, 0, 0);
  const tomorrowParts = inET(tomorrow);
  const isTomorrow =
    !sameDay &&
    tomorrowParts.year === resParts.year &&
    tomorrowParts.month === resParts.month &&
    tomorrowParts.day === resParts.day;

  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(resolutionAt);

  if (sameDay) return `Resolves today at ${time} ET`;
  if (isTomorrow) return `Resolves tomorrow at ${time} ET`;

  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
  }).format(resolutionAt);
  return `Resolves ${day} at ${time} ET`;
}

/** Format a Date as a short ET wall-clock label ("Mon 8:00 PM ET"). */
export function formatET(date: Date): string {
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: ET,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date) + " ET"
  );
}
