/**
 * Fix-wave F4 — record overlay step 1 (QA5 finding 3): the seat defaults must
 * derive from the PICKED session's roster. The overlay's state used to
 * initialise before any game was picked (mounted with roster=null on
 * /matches/new, then step 1's router.push only changed props), stranding the
 * user on step 1 with four empty seats. defaultSeats is the pure derivation
 * the reset-on-pick now re-runs; these tests pin its behaviour for the exact
 * inputs the bug lost.
 */
import { describe, expect, it } from "vitest";
import { defaultSeats, type WideRosterContext } from "@/components/matches/wide/record-result-overlay";

function player(id: string, courtSide: "right" | "left" | "both" | null): WideRosterContext["confirmed"][number] {
  return { id, displayName: id, rating: null, avatarUrl: null, isGuest: false, courtSide };
}

function roster(confirmed: WideRosterContext["confirmed"]): WideRosterContext {
  return {
    sessionId: "s1",
    startsAtMs: Date.now(),
    gameType: "competitive",
    circleName: "The Four",
    venueName: null,
    confirmed,
    candidates: [],
    viewerGlass: null,
  };
}

describe("defaultSeats — the RSVP'd four are seated the moment a game is picked", () => {
  it("no roster picked yet: all seats empty (step 1 state)", () => {
    expect(defaultSeats(null, "A")).toEqual([null, null]);
    expect(defaultSeats(null, "B")).toEqual([null, null]);
  });

  it("four confirmed: first two vs next two, each pair on preferred sides", () => {
    const r = roster([player("p1", "left"), player("p2", "right"), player("p3", "right"), player("p4", "left")]);
    const a = defaultSeats(r, "A");
    const b = defaultSeats(r, "B");
    // Team A seat 0 is the right/drive side, seat 1 the left/backhand side
    // (seating.ts's seatSide contract) — p2 prefers right, p1 prefers left.
    expect(a.map((s) => s?.id)).toEqual(["p2", "p1"]);
    expect(b.filter(Boolean).map((s) => s!.id).sort()).toEqual(["p3", "p4"]);
    // Everyone confirmed is seated — nobody relegated to the swap-in chips (the QA5 symptom).
    expect([...a, ...b].filter(Boolean)).toHaveLength(4);
  });

  it("a confirmed pair (the QA5 repro had two RSVPs): both seated on team A, team B open", () => {
    const r = roster([player("p1", "both"), player("p2", null)]);
    const a = defaultSeats(r, "A");
    const b = defaultSeats(r, "B");
    expect(a.filter(Boolean).map((s) => s!.id).sort()).toEqual(["p1", "p2"]);
    expect(b).toEqual([null, null]);
  });
});
