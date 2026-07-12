/**
 * Fix-wave F4 — Home's rotation affordance + timezone labels
 * (rotation-affordance.ts). The QA8 finding (screenshots 43/44): a pre-lock
 * rotation game tile said "You're in ✓" while showing four dashed slots and
 * "4 spots open", and rendered "TUE 19:00" for a Tue 20:00 BST game. These
 * tests pin the pure decisions so that self-contradiction is impossible and
 * the time labels are timezone-explicit.
 */
import { describe, expect, it } from "vitest";
import {
  gameRowStatus,
  gameRowTimeLabels,
  needsAnswer,
  needsAnswerMode,
} from "@/app/(app)/home/rotation-affordance";

describe("gameRowStatus — rotation games never show bare RSVP chrome pre-lock", () => {
  it("QA8 43/44 exact case: viewer holds a legacy 'in' on a gathering rotation game with an empty provisional lineup", () => {
    const status = gameRowStatus({
      slots: 4,
      confirmedCount: 0, // rotation lineup empty pre-lock (lineup derives from 'available' rows only)
      reserveCount: 0,
      viewerStatus: "in",
      rotation: { locked: false, viewerAvailable: false, availableCount: 0 },
    });
    // Never "4 spots open" next to "You're in ✓" — the tile must not contradict itself.
    expect(status.line).not.toMatch(/spots? open/);
    expect(status.chip).toEqual({ label: "You're available ✓", kind: "available" });
  });

  it("gathering rotation game shows the availability count, not spots", () => {
    const status = gameRowStatus({
      slots: 4,
      confirmedCount: 2,
      reserveCount: 1,
      viewerStatus: null,
      rotation: { locked: false, viewerAvailable: true, availableCount: 3 },
    });
    expect(status.line).toBe("3 available · rotation picks the four");
    expect(status.line).not.toMatch(/spots? open|waiting/);
    expect(status.chip).toEqual({ label: "You're available ✓", kind: "available" });
  });

  it("gathering rotation game with nobody available yet", () => {
    const status = gameRowStatus({
      slots: 4,
      confirmedCount: 0,
      reserveCount: 0,
      viewerStatus: null,
      rotation: { locked: false, viewerAvailable: false, availableCount: 0 },
    });
    expect(status.line).toBe("rotation on · no one in the mix yet");
    expect(status.chip).toBeNull();
  });

  it("LOCKED rotation game: slots are literal again (SessionCard precedent)", () => {
    const full = gameRowStatus({
      slots: 4,
      confirmedCount: 4,
      reserveCount: 2,
      viewerStatus: "in",
      rotation: { locked: true, viewerAvailable: true, availableCount: 6 },
    });
    expect(full.line).toBe("court booked · 2 waiting");
    expect(full.chip).toEqual({ label: "You're in ✓", kind: "in" });

    const short = gameRowStatus({
      slots: 4,
      confirmedCount: 3,
      reserveCount: 0,
      viewerStatus: null,
      rotation: { locked: true, viewerAvailable: false, availableCount: 3 },
    });
    expect(short.line).toBe("1 spot open");
    expect(short.chip).toBeNull();
  });

  it("plain first-come game is unchanged", () => {
    const open = gameRowStatus({ slots: 4, confirmedCount: 2, reserveCount: 1, viewerStatus: null, rotation: null });
    expect(open.line).toBe("2 spots open · 1 waiting");
    expect(open.chip).toBeNull();

    const booked = gameRowStatus({ slots: 4, confirmedCount: 4, reserveCount: 0, viewerStatus: "in" });
    expect(booked.line).toBe("court booked");
    expect(booked.chip).toEqual({ label: "You're in ✓", kind: "in" });
  });
});

describe("gameRowTimeLabels — timezone-explicit, never the runtime's clock", () => {
  it("QA8's hour-off case: Tue 20:00 BST game renders 20:00 whatever TZ the process runs in", () => {
    // 2026-07-14T19:00:00Z is Tue 20:00 in Europe/London (BST, +1)
    expect(gameRowTimeLabels(new Date("2026-07-14T19:00:00Z"), "Europe/London")).toEqual({ day: "TUE", time: "20:00" });
  });

  it("winter (GMT) and a non-UK venue timezone both follow the session's own zone", () => {
    expect(gameRowTimeLabels(new Date("2026-01-13T19:00:00Z"), "Europe/London")).toEqual({ day: "TUE", time: "19:00" });
    expect(gameRowTimeLabels(new Date("2026-07-14T19:00:00Z"), "Europe/Madrid")).toEqual({ day: "TUE", time: "21:00" });
  });
});

describe("needsAnswer — the featured card predicate", () => {
  const base = {
    rsvpWindowOpensAt: new Date(1_000),
    startsAtMs: 100_000,
  };
  const now = 50_000;

  it("an available rotation player has ALREADY answered — never re-ask (their viewerStatus is null server-side)", () => {
    expect(
      needsAnswer({ ...base, viewerStatus: null, rotation: { lockedAt: null, viewerAvailable: true } }, now),
    ).toBe(false);
  });

  it("an unanswered gathering rotation game still asks", () => {
    expect(
      needsAnswer({ ...base, viewerStatus: null, rotation: { lockedAt: null, viewerAvailable: false } }, now),
    ).toBe(true);
  });

  it("committed statuses and closed windows never ask", () => {
    expect(needsAnswer({ ...base, viewerStatus: "in", rotation: null }, now)).toBe(false);
    expect(needsAnswer({ ...base, viewerStatus: "out", rotation: null }, now)).toBe(false);
    expect(needsAnswer({ ...base, viewerStatus: null, rotation: null }, 500)).toBe(false); // window not open
    expect(needsAnswer({ ...base, viewerStatus: null, rotation: null }, 100_000)).toBe(false); // started
    expect(needsAnswer({ ...base, viewerStatus: null, rotation: null }, now)).toBe(true);
  });

  it("post-lock rotation with no answer behaves like a plain RSVP ask", () => {
    expect(
      needsAnswer({ ...base, viewerStatus: null, rotation: { lockedAt: new Date(2_000), viewerAvailable: false } }, now),
    ).toBe(true);
  });
});

describe("needsAnswerMode — what the NeedsAnswerCard collects", () => {
  it("rotation games collect availability, never a slot grab", () => {
    const mode = needsAnswerMode({ availableCount: 2 });
    expect(mode.yesAction).toBe("available");
    expect(mode.noAction).toBe("unavailable");
    expect(mode.yesLabel).toBe("I'm available");
    expect(mode.confirmedLabel).toContain("available");
    expect(mode.verb).toBe("available");
  });

  it("plain games keep the slot RSVP", () => {
    const mode = needsAnswerMode(null);
    expect(mode.yesAction).toBe("in");
    expect(mode.noAction).toBe("out");
    expect(mode.yesLabel).toBe("I'm in");
    expect(mode.confirmedLabel).toBe("You're in ✓ · game on");
  });

  it("copy obeys the house style: no em dashes, no exclamation marks", () => {
    for (const rotation of [{ availableCount: 1 }, null]) {
      const mode = needsAnswerMode(rotation);
      for (const s of [mode.yesLabel, mode.confirmedLabel]) {
        expect(s).not.toMatch(/—|!/);
      }
    }
  });
});
