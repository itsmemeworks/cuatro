import { describe, expect, it } from "vitest";
import {
  ROTATION_RECENT_WINDOW,
  computeRotation,
  type RotationCandidate,
  type RotationPastSession,
} from "@/server/rotation";

// availabilityOrder ascending = earlier reply; helper keeps tests terse.
function cands(...ids: string[]): RotationCandidate[] {
  return ids.map((userId, i) => ({ userId, availabilityOrder: i }));
}

describe("computeRotation — fairness ordering", () => {
  it("picks the players with the fewest recent plays first", () => {
    // a played all three, b two, c one, d none. Fewest-plays-first => d,c,b,a.
    const past: RotationPastSession[] = [
      { startsAt: 3, playedUserIds: ["a", "b", "c"] },
      { startsAt: 2, playedUserIds: ["a", "b"] },
      { startsAt: 1, playedUserIds: ["a"] },
    ];
    const sel = computeRotation(cands("a", "b", "c", "d"), past, 4);
    // Only 4 available, 4 slots => everyone in, but ordered by desert.
    expect(sel.inUserIds).toEqual(["d", "c", "b", "a"]);
    expect(sel.sittingUserIds).toEqual([]);
  });

  it("sits out the player with the most recent plays when more available than slots", () => {
    const past: RotationPastSession[] = [
      { startsAt: 3, playedUserIds: ["e", "e2"] }, // most recent
      { startsAt: 2, playedUserIds: ["e"] },
    ];
    // a,b,c,d have 0 plays; e has 2, e2 has 1. 4 slots, 6 available.
    const sel = computeRotation(cands("a", "b", "c", "d", "e", "e2"), past, 4);
    expect(sel.inUserIds).toEqual(["a", "b", "c", "d"]);
    // e2 (1 play) sits ahead of e (2 plays) in auto-promote order.
    expect(sel.sittingUserIds).toEqual(["e2", "e"]);
  });
});

describe("computeRotation — tie-breaks", () => {
  it("breaks a plays tie by who sat out most recently (they're due)", () => {
    // a and b each played exactly once, but a's play was older, so a sat out
    // the MORE RECENT session => a is more due than b.
    const past: RotationPastSession[] = [
      { startsAt: 3, playedUserIds: ["b", "x"] }, // a sat out here (more recent)
      { startsAt: 2, playedUserIds: ["a", "x"] }, // b sat out here (older)
    ];
    // 1 slot among {a,b} to force the tie to decide.
    const sel = computeRotation(cands("a", "b"), past, 1);
    expect(sel.inUserIds).toEqual(["a"]);
    expect(sel.sittingUserIds).toEqual(["b"]);
    expect(sel.reasons["a"].satOutLast).toBe(true);
    expect(sel.reasons["b"].satOutLast).toBe(false);
  });

  it("breaks a full tie by availability order, then userId", () => {
    // No history => all equal on plays and sit-out recency. availabilityOrder
    // decides; c replied first (order 0) so leads.
    const candidates: RotationCandidate[] = [
      { userId: "z", availabilityOrder: 2 },
      { userId: "c", availabilityOrder: 0 },
      { userId: "m", availabilityOrder: 1 },
    ];
    const sel = computeRotation(candidates, [], 2);
    expect(sel.inUserIds).toEqual(["c", "m"]);
    expect(sel.sittingUserIds).toEqual(["z"]);
  });

  it("is deterministic when even availability order ties (final userId tie-break)", () => {
    const candidates: RotationCandidate[] = [
      { userId: "beta", availabilityOrder: 0 },
      { userId: "alpha", availabilityOrder: 0 },
    ];
    const first = computeRotation(candidates, [], 1);
    const second = computeRotation([...candidates].reverse(), [], 1);
    expect(first.inUserIds).toEqual(["alpha"]);
    expect(second.inUserIds).toEqual(["alpha"]);
  });
});

describe("computeRotation — edge cases", () => {
  it("everyone available is in when fewer than slots (Fourth Call fills the rest)", () => {
    const sel = computeRotation(cands("a", "b"), [], 4);
    expect(sel.inUserIds).toEqual(["a", "b"]);
    expect(sel.sittingUserIds).toEqual([]);
  });

  it("handles no availability at all", () => {
    const sel = computeRotation([], [{ startsAt: 1, playedUserIds: ["a"] }], 4);
    expect(sel.inUserIds).toEqual([]);
    expect(sel.sittingUserIds).toEqual([]);
    expect(sel.reasons).toEqual({});
  });

  it("only counts the recent window, not all history", () => {
    // a played 5 old sessions but none of the last ROTATION_RECENT_WINDOW.
    const past: RotationPastSession[] = [];
    for (let i = 0; i < 5; i++) past.push({ startsAt: i + 100, playedUserIds: ["a"] }); // old, but startsAt is highest? no
    // Make the window (most recent) exclude a: newest sessions have b.
    const recent: RotationPastSession[] = [
      { startsAt: 1000, playedUserIds: ["b"] },
      { startsAt: 999, playedUserIds: ["b"] },
      { startsAt: 998, playedUserIds: ["b"] },
      { startsAt: 997, playedUserIds: ["b"] },
      { startsAt: 10, playedUserIds: ["a"] }, // outside the window of 4
    ];
    const sel = computeRotation(cands("a", "b"), recent, 1);
    expect(sel.reasons["a"].plays).toBe(0); // a's play is outside the window
    expect(sel.reasons["b"].plays).toBe(ROTATION_RECENT_WINDOW);
    expect(sel.inUserIds).toEqual(["a"]);
  });

  it("produces an honest reason string", () => {
    const past: RotationPastSession[] = [
      { startsAt: 3, playedUserIds: ["a"] },
      { startsAt: 2, playedUserIds: ["a"] },
    ];
    const sel = computeRotation(cands("a", "b"), past, 2);
    expect(sel.reasons["a"].reason).toBe("played 2 of last 2");
    expect(sel.reasons["b"].reason).toBe("played 0 of last 2");
    expect(sel.coldStart).toBe(false);
  });

  it("cold start (no history) selects by arrival order and says 'first to tap in'", () => {
    const sel = computeRotation(cands("a", "b", "c"), [], 2);
    expect(sel.coldStart).toBe(true);
    // Arrival order: a, b tapped in first.
    expect(sel.inUserIds).toEqual(["a", "b"]);
    expect(sel.sittingUserIds).toEqual(["c"]);
    // Honest reason, never a fake "played 0 of last 0".
    expect(sel.reasons["a"].reason).toBe("first to tap in");
    expect(sel.reasons["c"].reason).toBe("first to tap in");
  });

  it("does not mutate the caller's pastSessions array", () => {
    const past: RotationPastSession[] = [
      { startsAt: 1, playedUserIds: ["a"] },
      { startsAt: 3, playedUserIds: ["b"] },
      { startsAt: 2, playedUserIds: ["c"] },
    ];
    const snapshot = past.map((p) => p.startsAt);
    computeRotation(cands("a"), past, 4);
    expect(past.map((p) => p.startsAt)).toEqual(snapshot);
  });
});
