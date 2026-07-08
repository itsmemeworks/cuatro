import { describe, expect, it } from "vitest";
import {
  clampConfidence,
  clampRating,
  confidenceMultiplier,
  echoDamping,
  fixtureKey,
  kFor,
  marginMultiplier,
  round2,
  winExpectancy,
} from "../src/rating-math.js";
import { PLACEMENT_K, STABLE_K } from "../src/constants.js";
import type { FixtureOccurrence } from "../src/types.js";

describe("round2", () => {
  it("rounds to 2 decimal places", () => {
    expect(round2(3.14159)).toBe(3.14);
    expect(round2(3.005)).toBeCloseTo(3.01, 5); // guards against 3.005 -> 3.00 float drift
    expect(round2(3)).toBe(3);
  });
});

describe("clampRating / clampConfidence", () => {
  it("clamps ratings to [1.00, 7.00]", () => {
    expect(clampRating(0.5)).toBe(1.0);
    expect(clampRating(7.5)).toBe(7.0);
    expect(clampRating(4.2)).toBe(4.2);
  });

  it("clamps confidence to [0, 95]", () => {
    expect(clampConfidence(-5)).toBe(0);
    expect(clampConfidence(200)).toBe(95);
    expect(clampConfidence(40)).toBe(40);
  });
});

describe("winExpectancy", () => {
  it("returns 0.5 for identical ratings", () => {
    expect(winExpectancy(4.0, 4.0)).toBeCloseTo(0.5, 10);
  });

  it("matches the DESIGN.md worked example: 3.90 vs 3.80 -> 0.613", () => {
    expect(winExpectancy(3.9, 3.8)).toBeCloseTo(0.613, 3);
  });

  it("is symmetric: P(A beats B) + P(B beats A) = 1", () => {
    const pA = winExpectancy(4.5, 3.2);
    const pB = winExpectancy(3.2, 4.5);
    expect(pA + pB).toBeCloseTo(1, 10);
  });

  it("favors the higher-rated side monotonically", () => {
    const small = winExpectancy(4.1, 4.0);
    const large = winExpectancy(5.0, 4.0);
    expect(large).toBeGreaterThan(small);
    expect(small).toBeGreaterThan(0.5);
  });
});

describe("marginMultiplier", () => {
  it("matches the DESIGN.md worked example: 12/19 games -> 1.13", () => {
    expect(marginMultiplier(12, 19)).toBeCloseTo(1.1316, 3);
  });

  it("is 1.0 for an exact half-and-half share", () => {
    expect(marginMultiplier(10, 20)).toBe(1);
  });

  it("is 1.5 for a whitewash (100% of games)", () => {
    expect(marginMultiplier(18, 18)).toBe(1.5);
  });

  it("falls back to 1 for zero total games (defensive; callers should skip first)", () => {
    expect(marginMultiplier(0, 0)).toBe(1);
  });
});

describe("kFor", () => {
  it("uses the Placement K for a player's first, second and third matches", () => {
    expect(kFor(0)).toBe(PLACEMENT_K);
    expect(kFor(1)).toBe(PLACEMENT_K);
    expect(kFor(2)).toBe(PLACEMENT_K);
  });

  it("switches to the Stable K from a player's fourth match onward", () => {
    expect(kFor(3)).toBe(STABLE_K);
    expect(kFor(4)).toBe(STABLE_K);
    expect(kFor(1000)).toBe(STABLE_K);
  });
});

describe("confidenceMultiplier", () => {
  it("is highest at 0% confidence", () => {
    expect(confidenceMultiplier(0)).toBeCloseTo(1.25, 5);
  });

  it("tapers toward 1.0 as confidence approaches the 95% cap", () => {
    expect(confidenceMultiplier(95)).toBeCloseTo(1.0125, 5);
  });

  it("is exactly 1.0 at the theoretical maximum of 100", () => {
    expect(confidenceMultiplier(100)).toBeCloseTo(1.0, 10);
  });

  it("decreases monotonically as confidence rises", () => {
    const values = [0, 20, 40, 60, 80, 95].map(confidenceMultiplier);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThan(values[i - 1]!);
    }
  });
});

describe("fixtureKey", () => {
  it("is order-independent", () => {
    expect(fixtureKey(["a", "b", "c", "d"])).toBe(fixtureKey(["d", "c", "b", "a"]));
  });

  it("differs for a different set of players", () => {
    expect(fixtureKey(["a", "b", "c", "d"])).not.toBe(fixtureKey(["a", "b", "c", "e"]));
  });
});

describe("echoDamping", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const players = ["p1", "p2", "p3", "p4"] as const;

  it("applies no damping on a first meeting with empty history", () => {
    const result = echoDamping(1_000_000, players, []);
    expect(result.occurrence).toBe(1);
    expect(result.multiplier).toBe(1);
  });

  it("applies x0.6 on the 2nd meeting and x0.36 on the 3rd, within 30 days", () => {
    const t0 = 100 * DAY;
    const history: FixtureOccurrence[] = [{ playedAt: t0, playerIds: players }];
    const second = echoDamping(t0 + 5 * DAY, players, history);
    expect(second.occurrence).toBe(2);
    expect(second.multiplier).toBeCloseTo(0.6, 10);

    history.push({ playedAt: t0 + 5 * DAY, playerIds: players });
    const third = echoDamping(t0 + 10 * DAY, players, history);
    expect(third.occurrence).toBe(3);
    expect(third.multiplier).toBeCloseTo(0.36, 10);
  });

  it("ignores repeats older than the 30-day window", () => {
    const t0 = 100 * DAY;
    const history: FixtureOccurrence[] = [{ playedAt: t0, playerIds: players }];
    const result = echoDamping(t0 + 31 * DAY, players, history);
    expect(result.occurrence).toBe(1);
    expect(result.multiplier).toBe(1);
  });

  it("ignores fixtures with a different set of four players", () => {
    const t0 = 100 * DAY;
    const history: FixtureOccurrence[] = [{ playedAt: t0, playerIds: ["a", "b", "c", "d"] }];
    const result = echoDamping(t0 + DAY, ["a", "b", "c", "e"], history);
    expect(result.occurrence).toBe(1);
  });

  it("is unaffected by which two players were on which team", () => {
    const t0 = 100 * DAY;
    // Same four people, teams shuffled between meetings.
    const history: FixtureOccurrence[] = [{ playedAt: t0, playerIds: ["p1", "p3", "p2", "p4"] }];
    const result = echoDamping(t0 + DAY, ["p1", "p2", "p3", "p4"], history);
    expect(result.occurrence).toBe(2);
  });
});
