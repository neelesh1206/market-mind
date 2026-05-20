import { describe, expect, it } from "vitest";
import {
  etCalendarDate,
  formatRelative,
  formatResolutionCopy,
  getMarketSchedule,
} from "../market-schedule";

/**
 * Helper: a Date instance that, when interpreted in ET, lands on the given
 * wall-clock time. We construct via UTC + offset so the test isn't sensitive
 * to the machine running it (CI is UTC, dev might be PT). The offset switches
 * with DST: -5 in winter (EST), -4 in summer (EDT). The dates below are picked
 * to avoid DST-transition weeks so the offset is stable across the test.
 */
function etDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  isDST = false,
): Date {
  const offsetH = isDST ? 4 : 5;
  return new Date(Date.UTC(year, month - 1, day, hour + offsetH, minute));
}

describe("etCalendarDate", () => {
  it("returns YYYY-MM-DD for the ET calendar day", () => {
    // 9 PM ET on Tuesday May 19 (EDT, offset -4) — clearly May 19 in ET.
    const d = etDate(2026, 5, 19, 21, 0, true);
    expect(etCalendarDate(d)).toBe("2026-05-19");
  });

  it("returns the ET date even when the local clock has flipped", () => {
    // 11:30 PM ET on May 19 (EDT) → 03:30 UTC on May 20.
    // A naive `toISOString().slice(0,10)` would return 2026-05-20; the
    // helper must return 2026-05-19 (ET calendar).
    const d = etDate(2026, 5, 19, 23, 30, true);
    expect(etCalendarDate(d)).toBe("2026-05-19");
  });

  it("zero-pads single-digit months and days", () => {
    const d = etDate(2026, 1, 5, 12, 0, false);
    expect(etCalendarDate(d)).toBe("2026-01-05");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-05-19T12:00:00Z");

  it("formats future seconds-to-minutes as 'in 5m'", () => {
    const target = new Date(now.getTime() + 5 * 60_000);
    expect(formatRelative(target, now)).toBe("in 5m");
  });

  it("formats hours + remainder minutes as 'in 2h 14m'", () => {
    const target = new Date(now.getTime() + (2 * 60 + 14) * 60_000);
    expect(formatRelative(target, now)).toBe("in 2h 14m");
  });

  it("formats multi-day intervals as 'in 3d 4h'", () => {
    const target = new Date(now.getTime() + (3 * 24 + 4) * 3_600_000);
    expect(formatRelative(target, now)).toBe("in 3d 4h");
  });

  it("formats past intervals with 'ago' suffix", () => {
    const target = new Date(now.getTime() - 30 * 60_000);
    expect(formatRelative(target, now)).toBe("in 30m ago".replace("in ", ""));
    // The string is "30m ago" not "in 30m ago"; explicit assertion below is
    // clearer:
    expect(formatRelative(target, now)).toBe("30m ago");
  });

  it("uses 'moments' for sub-minute intervals", () => {
    const target = new Date(now.getTime() + 30_000);
    expect(formatRelative(target, now)).toBe("in moments");
  });
});

describe("formatResolutionCopy", () => {
  it("returns 'Resolves today at ...' when same ET day", () => {
    // 11 AM ET Tue, resolution at 4:15 PM ET Tue (same day).
    const now = etDate(2026, 5, 19, 11, 0, true);
    const resolution = etDate(2026, 5, 19, 16, 15, true);
    const result = formatResolutionCopy(resolution, now);
    expect(result).toMatch(/^Resolves today at 4:15 PM ET$/);
  });

  it("returns 'Resolves tomorrow at ...' when next ET day", () => {
    // 9 PM ET Mon (after pipeline) — bet is for Tue, resolves Tue 4:15 PM.
    const now = etDate(2026, 5, 18, 21, 0, true);
    const resolution = etDate(2026, 5, 19, 16, 15, true);
    const result = formatResolutionCopy(resolution, now);
    expect(result).toMatch(/^Resolves tomorrow at 4:15 PM ET$/);
  });

  it("returns 'Resolves Mon at ...' when further out (Fri night → next Mon)", () => {
    // 9 PM ET Fri May 15 — bet is for Mon May 18.
    const now = etDate(2026, 5, 15, 21, 0, true);
    const resolution = etDate(2026, 5, 18, 16, 15, true);
    const result = formatResolutionCopy(resolution, now);
    // Just check it contains the weekday abbrev + the time — locale variants
    // sometimes swap "at" placement.
    expect(result).toContain("Mon");
    expect(result).toContain("4:15 PM ET");
    expect(result).not.toContain("today");
    expect(result).not.toContain("tomorrow");
  });
});

describe("getMarketSchedule — phase transitions", () => {
  it("pre-market-bet-open during weekday pre-market hours", () => {
    // 8:00 AM ET on Tue — bet window still open from last 8 PM, market opens 9:30.
    const now = etDate(2026, 5, 19, 8, 0, true);
    const s = getMarketSchedule(now);
    expect(s.state).toBe("pre-market");
    expect(s.phase).toBe("pre-market-bet-open");
    expect(s.betWindowOpen).toBe(true);
  });

  it("market-open-bet-open from 9:30 AM to 1:00 PM ET", () => {
    const now = etDate(2026, 5, 19, 10, 0, true); // 10 AM ET, mid-morning
    const s = getMarketSchedule(now);
    expect(s.state).toBe("open");
    expect(s.phase).toBe("market-open-bet-open");
    expect(s.betWindowOpen).toBe(true);
  });

  it("market-open-bet-locked from 1:00 PM to 4:00 PM ET", () => {
    const now = etDate(2026, 5, 19, 14, 0, true); // 2 PM ET
    const s = getMarketSchedule(now);
    expect(s.state).toBe("open");
    expect(s.phase).toBe("market-open-bet-locked");
    expect(s.betWindowOpen).toBe(false);
  });

  it("post-resolution between 4:15 PM and 8:00 PM ET", () => {
    const now = etDate(2026, 5, 19, 17, 0, true); // 5 PM ET
    const s = getMarketSchedule(now);
    expect(s.state).toBe("post-close");
    expect(s.phase).toBe("post-resolution");
    expect(s.betWindowOpen).toBe(false);
  });

  it("pipeline-running from 8:00 PM to 8:25 PM ET (typical 25min window)", () => {
    const now = etDate(2026, 5, 19, 20, 10, true); // 8:10 PM ET
    const s = getMarketSchedule(now);
    expect(s.phase).toBe("pipeline-running");
    expect(s.betWindowOpen).toBe(false); // tomorrow's window not yet open
  });

  it("after-pipeline once the typical duration has passed", () => {
    const now = etDate(2026, 5, 19, 21, 0, true); // 9 PM ET — pipeline done
    const s = getMarketSchedule(now);
    expect(s.phase).toBe("after-pipeline");
    expect(s.betWindowOpen).toBe(true); // tomorrow's window is open
  });

  it("Saturday is 'weekend' phase with bet window still open for Monday", () => {
    // Bet window opens Friday 8 PM ET → still open all Saturday for Monday's
    // market. State stays "weekend" (no trading), phase stays generic.
    const sat = etDate(2026, 5, 16, 12, 0, true); // Saturday noon ET
    const schedule = getMarketSchedule(sat);
    expect(schedule.phase).toBe("weekend");
    expect(schedule.state).toBe("weekend");
    expect(schedule.betWindowOpen).toBe(true);
  });

  it("Sunday is 'sunday-rotation' phase with bet window CLOSED (ADR 0018 Phase 2)", () => {
    // Sunday is universe-rotation day — bet window forced closed all day ET
    // even though Friday's pipeline already produced Monday's insights.
    // Users can't bet on a stock that's about to be demoted, and the
    // rotation pipeline operates on a quiet table.
    const sun = etDate(2026, 5, 17, 12, 0, true); // Sunday noon ET
    const schedule = getMarketSchedule(sun);
    expect(schedule.phase).toBe("sunday-rotation");
    expect(schedule.state).toBe("weekend");
    expect(schedule.betWindowOpen).toBe(false);
  });

  it("Bet window forced closed all Sunday ET (not just midday)", () => {
    // Boundary check — early morning, noon, evening Sunday all return closed.
    const morning = etDate(2026, 5, 17, 6, 0, true);
    const noon = etDate(2026, 5, 17, 12, 0, true);
    const evening = etDate(2026, 5, 17, 22, 0, true);
    expect(getMarketSchedule(morning).betWindowOpen).toBe(false);
    expect(getMarketSchedule(noon).betWindowOpen).toBe(false);
    expect(getMarketSchedule(evening).betWindowOpen).toBe(false);
  });

  it("trading day flips to tomorrow only AFTER pipeline completion", () => {
    // 8:10 PM Tue (pipeline running) — should still show TODAY's date in
    // tradingDayLabel, not tomorrow's. Otherwise UI would claim
    // "tomorrow's predictions are live" while the cron is still crunching.
    const running = etDate(2026, 5, 19, 20, 10, true);
    expect(getMarketSchedule(running).tradingDayLabel).toBe("2026-05-19");

    // 9:00 PM Tue (after pipeline completion) — trading day flips to Wed.
    const after = etDate(2026, 5, 19, 21, 0, true);
    expect(getMarketSchedule(after).tradingDayLabel).toBe("2026-05-20");
  });

  it("nextPipelineCompletion is 25 minutes after nextPipelineRun", () => {
    const now = etDate(2026, 5, 19, 14, 0, true);
    const s = getMarketSchedule(now);
    const deltaMs = s.nextPipelineCompletion.getTime() - s.nextPipelineRun.getTime();
    expect(deltaMs).toBe(25 * 60_000);
  });
});
