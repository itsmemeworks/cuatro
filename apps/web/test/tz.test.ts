import { describe, expect, it } from "vitest";
import { computeNextOccurrence, zonedWallTimeToUtc, zonedWeekday } from "@/server/tz";

describe("zonedWallTimeToUtc", () => {
  it("converts a GMT (winter) London wall-clock time to UTC with zero offset", () => {
    const utc = zonedWallTimeToUtc(2026, 0, 6, 20, 0, "Europe/London"); // 6 Jan 2026, 20:00 local
    expect(utc.toISOString()).toBe("2026-01-06T20:00:00.000Z");
  });

  it("converts a BST (summer) London wall-clock time to UTC with a 1h offset", () => {
    const utc = zonedWallTimeToUtc(2026, 6, 7, 20, 0, "Europe/London"); // 7 Jul 2026, 20:00 BST
    expect(utc.toISOString()).toBe("2026-07-07T19:00:00.000Z");
  });

  it("handles negative-offset timezones", () => {
    const utc = zonedWallTimeToUtc(2026, 5, 10, 9, 0, "America/New_York"); // 10 Jun 2026, 09:00 EDT (UTC-4)
    expect(utc.toISOString()).toBe("2026-06-10T13:00:00.000Z");
  });

  it("does not throw for a wall-clock time inside the UK's spring-forward gap", () => {
    // Verified: UK clocks jump from 01:00 to 02:00 local on 2026-03-29, so
    // "01:30 local" that day doesn't exist. Should resolve to *some* well
    // defined instant rather than throwing or returning NaN.
    const utc = zonedWallTimeToUtc(2026, 2, 29, 1, 30, "Europe/London");
    expect(utc instanceof Date).toBe(true);
    expect(Number.isNaN(utc.getTime())).toBe(false);
  });
});

describe("zonedWeekday", () => {
  it("reports the weekday as observed in the given timezone", () => {
    // 2026-01-06T00:00:00Z is a Tuesday in UTC and still Monday night gone /
    // Tuesday morning in London (GMT, no offset) — same calendar day here.
    expect(zonedWeekday(new Date("2026-01-06T00:00:00.000Z"), "Europe/London")).toBe(2);
  });
});

describe("computeNextOccurrence", () => {
  it("finds the next matching weekday strictly after now, same week", () => {
    const now = new Date("2026-01-04T00:00:00.000Z"); // Sunday
    const next = computeNextOccurrence(2, "20:00", "Europe/London", now); // next Tuesday
    expect(next.toISOString()).toBe("2026-01-06T20:00:00.000Z");
  });

  it("rolls over to the following week when today is the target weekday but past the time", () => {
    const now = new Date("2026-01-06T21:00:00.000Z"); // Tuesday, after 20:00 GMT
    const next = computeNextOccurrence(2, "20:00", "Europe/London", now);
    expect(next.toISOString()).toBe("2026-01-13T20:00:00.000Z");
  });

  it("never returns an instant at or before now, even when now is exactly the session start", () => {
    const now = new Date("2026-01-06T20:00:00.000Z"); // exactly session time
    const next = computeNextOccurrence(2, "20:00", "Europe/London", now);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(next.toISOString()).toBe("2026-01-13T20:00:00.000Z");
  });

  it("crosses the spring DST boundary correctly (UTC offset shifts by 1h)", () => {
    // Verified via Intl offset checks: UK is GMT (+0) through 2026-03-28,
    // BST (+1) from 2026-03-29.
    const beforeDst = new Date("2026-03-01T00:00:00.000Z"); // Sunday
    const beforeOccurrence = computeNextOccurrence(2, "20:00", "Europe/London", beforeDst); // Tue 3 Mar, still GMT
    expect(beforeOccurrence.toISOString()).toBe("2026-03-03T20:00:00.000Z");
    expect(beforeOccurrence.getUTCHours()).toBe(20);

    const afterDst = new Date("2026-04-01T00:00:00.000Z"); // Wednesday
    const afterOccurrence = computeNextOccurrence(2, "20:00", "Europe/London", afterDst); // Tue 7 Apr, now BST
    expect(afterOccurrence.toISOString()).toBe("2026-04-07T19:00:00.000Z");
    expect(afterOccurrence.getUTCHours()).toBe(19);
  });

  it("computes correctly for a non-UK, negative-offset timezone", () => {
    const now = new Date("2026-06-01T00:00:00.000Z"); // Monday
    const next = computeNextOccurrence(6, "10:00", "America/New_York", now); // next Saturday 10:00 EDT
    expect(next.toISOString()).toBe("2026-06-06T14:00:00.000Z"); // EDT = UTC-4
  });

  it("rejects a malformed startTime", () => {
    expect(() => computeNextOccurrence(2, "8pm", "Europe/London", new Date())).toThrow();
  });
});
