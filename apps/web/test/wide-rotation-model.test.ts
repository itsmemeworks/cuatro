import { describe, expect, it } from "vitest";
import {
  benchStatus,
  cascadeStatus,
  lockedHeaderLabel,
  rotationListStatus,
  rotationModePill,
  sessionStamp,
  shortDayTime,
  thisWeekHeading,
} from "@/components/circle-screens/wide/wide-rotation-model";

/**
 * The wide ROTATION panels' copy (design/CUATRO-Web-LATEST.dc.html "Circle ·
 * Rotation game") comes from these pure helpers so the labels — lock instants,
 * bench standings, the consent-offer cascade — are testable without rendering.
 * Fixed instants below are UTC; expectations are Europe/London (BST in July,
 * so 09:00Z reads as 10am — that skew is exactly what these tests pin down).
 */

// Sun 12 Jul 2026 10:00 Europe/London (BST) = 09:00 UTC.
const SUN_10AM = Date.UTC(2026, 6, 12, 9, 0);
// Sat 11 Jul 2026 10:00 London — the design's "locks Sat 10am".
const SAT_10AM = Date.UTC(2026, 6, 11, 9, 0);
// Sat 11 Jul 2026 19:30 London — a half-hour time keeps its minutes.
const SAT_730PM = Date.UTC(2026, 6, 11, 18, 30);

describe("shortDayTime", () => {
  it("renders the design's lock shorthand, minutes dropped on the hour", () => {
    expect(shortDayTime(SAT_10AM)).toBe("Sat 10am");
    expect(shortDayTime(SUN_10AM)).toBe("Sun 10am");
  });

  it("keeps minutes when they matter", () => {
    expect(shortDayTime(SAT_730PM)).toBe("Sat 7:30pm");
  });
});

describe("thisWeekHeading", () => {
  it("names the day the way the availability card does", () => {
    expect(thisWeekHeading(SUN_10AM)).toBe("This Sunday · 12 Jul");
  });
});

describe("sessionStamp", () => {
  it("stamps THE FOUR header with day + 24h time", () => {
    expect(sessionStamp(SUN_10AM)).toBe("Sun 12 · 10:00");
  });
});

describe("lockedHeaderLabel", () => {
  it("carries the lock instant, uppercased", () => {
    expect(lockedHeaderLabel(SAT_10AM)).toBe("THE FOUR · LOCKED SAT 10AM");
  });

  it("stays honest when no lock instant exists", () => {
    expect(lockedHeaderLabel(null)).toBe("THE FOUR · LOCKED");
  });
});

describe("benchStatus", () => {
  it("banks priority for the first sit-out", () => {
    expect(benchStatus(0)).toEqual({ label: "first in next week", tone: "win" });
  });

  it("queues the rest in plain words", () => {
    expect(benchStatus(1)).toEqual({ label: "second in line", tone: "muted" });
    expect(benchStatus(2)).toEqual({ label: "third in line", tone: "muted" });
  });

  it("never runs out of labels for a big bench", () => {
    expect(benchStatus(11).label).toBe("number 12 in line");
  });
});

describe("cascadeStatus", () => {
  it("marks the live offer holder as waiting", () => {
    expect(cascadeStatus(0, 0, "Kav")).toEqual({ label: "offered · waiting", tone: "action" });
  });

  it("names who is next if the holder passes", () => {
    expect(cascadeStatus(1, 0, "Kav")).toEqual({ label: "next if Kav passes", tone: "muted" });
  });

  it("shows spent offers as passed, later rows as in line", () => {
    expect(cascadeStatus(0, 1, "Tom")).toEqual({ label: "passed", tone: "muted" });
    expect(cascadeStatus(3, 1, "Tom")).toEqual({ label: "in line", tone: "muted" });
  });

  it("copes with no live offer yet — first in line is simply next up", () => {
    expect(cascadeStatus(0, -1, null)).toEqual({ label: "next up for the offer", tone: "muted" });
    expect(cascadeStatus(2, -1, null)).toEqual({ label: "in line", tone: "muted" });
  });
});

describe("rotationModePill", () => {
  it("describes the limited contract with its cutoff", () => {
    expect(rotationModePill("limited", 24)).toBe("limited · locks 24h before kickoff");
    expect(rotationModePill("limited", 12)).toBe("limited · locks 12h before kickoff");
    expect(rotationModePill("limited", 48)).toBe("limited · locks 2 days before kickoff");
  });

  it("describes unlimited as never locking", () => {
    expect(rotationModePill("unlimited", 24)).toBe("unlimited · re-picks to kickoff");
  });
});

describe("rotationListStatus", () => {
  it("says the four is set once locked", () => {
    expect(rotationListStatus({ locked: true, mode: "limited", locksAtMs: SAT_10AM })).toBe("the four is set");
  });

  it("gives the lock instant pre-lock (the games-list subline)", () => {
    expect(rotationListStatus({ locked: false, mode: "limited", locksAtMs: SAT_10AM })).toBe("lineup locks Sat 10am");
  });

  it("never invents a lock for unlimited games", () => {
    expect(rotationListStatus({ locked: false, mode: "unlimited", locksAtMs: SAT_10AM })).toBe("re-picks to kickoff");
  });
});
