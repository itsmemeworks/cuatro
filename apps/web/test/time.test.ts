import { describe, expect, it } from "vitest";
import {
  DEFAULT_TZ,
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatDayTime,
  formatDayTimeCompact,
  formatDayTimeLong,
  formatMonthYear,
  formatTime,
  formatWeekday,
  formatWeekdayDay,
  formatWeekdayLong,
  localDateKey,
} from "@/lib/time";

/**
 * lib/time.ts is THE shared date/time formatter surface (fix-wave F2). Every
 * expectation below must hold regardless of the process timezone — the Fly
 * runtime is TZ=UTC, dev machines are Europe/London — because every function
 * takes an explicit IANA timezone. CI/local runs under any TZ must pass;
 * `TZ=UTC npx vitest run test/time.test.ts` simulates production exactly.
 */

// Thu 16 Jul 2026 19:30 Europe/London (BST, UTC+1) = 18:30 UTC.
// A bare (runtime-tz) render of this instant under TZ=UTC says 18:30 —
// the exact hour-early bug QA4/QA7/QA8 caught. These tests pin the fix.
const THU_1930_LONDON = Date.UTC(2026, 6, 16, 18, 30);
// Sun 20 Dec 2026 09:00 Europe/London (GMT, UTC+0) = 09:00 UTC — the winter
// (non-DST) leg, so both offsets of the same zone are covered.
const SUN_9AM_GMT = Date.UTC(2026, 11, 20, 9, 0);
// Fri 00:15 local in London (23:15 UTC the previous day) — the
// midnight-crossing case where a date-only render in UTC names the WRONG day.
const FRI_0015_LONDON = Date.UTC(2026, 6, 16, 23, 15);

describe("DEFAULT_TZ", () => {
  it("is the documented UK-launch fallback", () => {
    expect(DEFAULT_TZ).toBe("Europe/London");
  });
});

describe("clock renders in the given timezone, not the runtime's", () => {
  it("formats BST instants one hour ahead of UTC", () => {
    expect(formatTime(THU_1930_LONDON, "Europe/London")).toBe("19:30");
  });

  it("formats the SAME instant differently per timezone (the whole point)", () => {
    expect(formatTime(THU_1930_LONDON, "UTC")).toBe("18:30");
    expect(formatTime(THU_1930_LONDON, "Europe/Madrid")).toBe("20:30");
  });

  it("handles the winter (GMT) leg of the same zone", () => {
    expect(formatTime(SUN_9AM_GMT, "Europe/London")).toBe("09:00");
    expect(formatTime(SUN_9AM_GMT, "UTC")).toBe("09:00");
  });

  it("accepts Date and epoch-ms interchangeably", () => {
    expect(formatTime(new Date(THU_1930_LONDON), "Europe/London")).toBe(formatTime(THU_1930_LONDON, "Europe/London"));
  });
});

describe("the label shapes match the design language", () => {
  it("formatWeekday / formatWeekdayLong", () => {
    expect(formatWeekday(THU_1930_LONDON, "Europe/London")).toBe("Thu");
    expect(formatWeekdayLong(THU_1930_LONDON, "Europe/London")).toBe("Thursday");
  });

  it("formatDayTime — the standard game-card shape", () => {
    expect(formatDayTime(THU_1930_LONDON, "Europe/London")).toBe("Thu 19:30");
  });

  it("formatDayTimeLong — the game-hero shape", () => {
    expect(formatDayTimeLong(THU_1930_LONDON, "Europe/London")).toBe("Thursday 19:30");
  });

  it("formatDate / formatWeekdayDay / formatDayMonth", () => {
    expect(formatDate(THU_1930_LONDON, "Europe/London")).toBe("Thu 16 Jul");
    expect(formatWeekdayDay(THU_1930_LONDON, "Europe/London")).toBe("Thu 16");
    expect(formatDayMonth(THU_1930_LONDON, "Europe/London")).toBe("16 Jul");
  });

  it("formatDateTime — notification bodies and page titles", () => {
    expect(formatDateTime(THU_1930_LONDON, "Europe/London")).toBe("Thu 16 Jul, 19:30");
  });

  it("formatDayTimeCompact — minutes only when they matter", () => {
    expect(formatDayTimeCompact(SUN_9AM_GMT, "Europe/London")).toBe("Sun 9am");
    expect(formatDayTimeCompact(THU_1930_LONDON, "Europe/London")).toBe("Thu 7:30pm");
  });

  it("formatMonthYear — ledger month headers (caller upcases)", () => {
    expect(formatMonthYear(THU_1930_LONDON, "Europe/London")).toBe("July 2026");
  });
});

describe("midnight crossing — the day itself depends on the timezone", () => {
  it("a 00:15 BST game is Friday in London but still Thursday in UTC", () => {
    expect(formatWeekday(FRI_0015_LONDON, "Europe/London")).toBe("Fri");
    expect(formatWeekday(FRI_0015_LONDON, "UTC")).toBe("Thu");
    expect(formatDate(FRI_0015_LONDON, "Europe/London")).toBe("Fri 17 Jul");
  });

  it("localDateKey buckets the instant into the LOCAL calendar day", () => {
    expect(localDateKey(FRI_0015_LONDON, "Europe/London")).toBe("2026-07-17");
    expect(localDateKey(FRI_0015_LONDON, "UTC")).toBe("2026-07-16");
  });
});
