import { describe, expect, it } from "vitest";
import { createPlayer, playerStatus, processMatch } from "../src/engine.js";
import { PLACEMENT_K, STABLE_K, SCALE_MAX, SCALE_MIN, DEFAULT_STARTING_RATING } from "../src/constants.js";
import type { MatchInput, PlayerState } from "../src/types.js";

const DAY = 24 * 60 * 60 * 1000;

function makePlayer(id: string, overrides: Partial<PlayerState> = {}): PlayerState {
  return { ...createPlayer(id), ...overrides };
}

function makeMatch(overrides: Partial<MatchInput> = {}): MatchInput {
  return {
    matchId: "m1",
    playedAt: 1000 * DAY,
    teamA: ["a1", "a2"],
    teamB: ["b1", "b2"],
    winner: "A",
    gamesWonA: 12,
    gamesWonB: 7,
    verified: true,
    ...overrides,
  };
}

describe("createPlayer", () => {
  it("starts Unrated at the default rating with zero confidence and history", () => {
    const p = createPlayer("p1");
    expect(p.rating).toBe(DEFAULT_STARTING_RATING);
    expect(p.confidence).toBe(0);
    expect(p.matchesPlayed).toBe(0);
    expect(p.opponentsFaced).toEqual([]);
    expect(playerStatus(p)).toBe("unrated");
  });

  it("seeds the hidden rating from a placement prior, rounded to 2dp", () => {
    const p = createPlayer("p1", { placementPrior: 3.456 });
    expect(p.rating).toBe(3.46);
  });

  it("clamps an out-of-range placement prior into the valid scale", () => {
    expect(createPlayer("p1", { placementPrior: 9 }).rating).toBe(SCALE_MAX);
    expect(createPlayer("p1", { placementPrior: 0 }).rating).toBe(SCALE_MIN);
  });
});

describe("processMatch — the DESIGN.md worked example", () => {
  it("produces +0.02 / -0.02 deltas matching the spec's numbers", () => {
    const players = {
      a1: makePlayer("a1", { rating: 4.1, confidence: 95, matchesPlayed: 10 }),
      a2: makePlayer("a2", { rating: 3.7, confidence: 95, matchesPlayed: 10 }),
      b1: makePlayer("b1", { rating: 3.95, confidence: 95, matchesPlayed: 10 }),
      b2: makePlayer("b2", { rating: 3.65, confidence: 95, matchesPlayed: 10 }),
    };
    const match = makeMatch();
    const result = processMatch({ match, players });

    expect(result.status).toBe("applied");
    const events = result.ledgerEvents!;
    const a1Event = events.find((e) => e.playerId === "a1")!;
    const b1Event = events.find((e) => e.playerId === "b1")!;

    expect(a1Event.factors.expectancy).toBeCloseTo(0.613, 3);
    expect(a1Event.factors.margin).toBeCloseTo(1.1316, 3);
    expect(a1Event.factors.kUsed).toBe(STABLE_K);
    expect(a1Event.factors.echoDamping).toBe(1);
    expect(a1Event.delta).toBe(0.02);
    expect(a1Event.ratingAfter).toBe(4.12);

    expect(b1Event.delta).toBe(-0.02);
    expect(b1Event.ratingAfter).toBe(3.93);
  });

  it("keeps every ledger event's ratingAfter exactly consistent with ratingBefore + delta", () => {
    const players = {
      a1: makePlayer("a1", { rating: 4.1, confidence: 95, matchesPlayed: 10 }),
      a2: makePlayer("a2", { rating: 3.7, confidence: 95, matchesPlayed: 10 }),
      b1: makePlayer("b1", { rating: 3.95, confidence: 95, matchesPlayed: 10 }),
      b2: makePlayer("b2", { rating: 3.65, confidence: 95, matchesPlayed: 10 }),
    };
    const result = processMatch({ match: makeMatch(), players });
    for (const event of result.ledgerEvents!) {
      expect(event.ratingAfter).toBe(Math.round((event.ratingBefore + event.delta) * 100) / 100);
    }
  });
});

describe("processMatch — Placement vs Stable K", () => {
  it("uses PLACEMENT_K for a player's 1st, 2nd and 3rd verified matches, then STABLE_K", () => {
    let players: Record<string, PlayerState> = {
      p1: createPlayer("p1"),
      p2: createPlayer("p2"),
      opp1: createPlayer("opp1"),
      opp2: createPlayer("opp2"),
      opp3: createPlayer("opp3"),
      opp4: createPlayer("opp4"),
      opp5: createPlayer("opp5"),
      opp6: createPlayer("opp6"),
      opp7: createPlayer("opp7"),
      opp8: createPlayer("opp8"),
    };

    const opponentPairs = [
      ["opp1", "opp2"],
      ["opp3", "opp4"],
      ["opp5", "opp6"],
      ["opp7", "opp8"],
    ] as const;

    const kUsedByMatch: number[] = [];
    const statusByMatch: Array<"unrated" | "rated"> = [];

    for (let i = 0; i < 4; i++) {
      const match = makeMatch({
        matchId: `m${i}`,
        playedAt: (1000 + i) * DAY,
        teamA: ["p1", "p2"],
        teamB: opponentPairs[i]!,
      });
      const result = processMatch({ match, players });
      expect(result.status).toBe("applied");
      players = { ...players, ...result.updatedPlayers };
      kUsedByMatch.push(result.ledgerEvents!.find((e) => e.playerId === "p1")!.factors.kUsed);
      statusByMatch.push(playerStatus(players.p1!));
    }

    expect(kUsedByMatch).toEqual([PLACEMENT_K, PLACEMENT_K, PLACEMENT_K, STABLE_K]);
    expect(statusByMatch).toEqual(["unrated", "unrated", "rated", "rated"]);
    expect(players.p1!.matchesPlayed).toBe(4);
  });
});

describe("processMatch — Confidence growth and cap", () => {
  it("grows +8% per brand-new unique opponent and stops growing on repeats", () => {
    let players: Record<string, PlayerState> = {
      p1: createPlayer("p1"),
      p2: createPlayer("p2"),
      opp1: createPlayer("opp1"),
      opp2: createPlayer("opp2"),
    };

    const match1 = makeMatch({ matchId: "m1", playedAt: 1000 * DAY, teamA: ["p1", "p2"], teamB: ["opp1", "opp2"] });
    let result = processMatch({ match: match1, players });
    players = { ...players, ...result.updatedPlayers };
    expect(players.p1!.confidence).toBe(16); // 2 brand-new opponents

    // Same opponents again -> no new confidence.
    const match2 = makeMatch({ matchId: "m2", playedAt: 2000 * DAY, teamA: ["p1", "p2"], teamB: ["opp1", "opp2"] });
    result = processMatch({ match: match2, players });
    players = { ...players, ...result.updatedPlayers };
    expect(players.p1!.confidence).toBe(16);
  });

  it("caps confidence at 95 even when more new opponents would push it over", () => {
    let players: Record<string, PlayerState> = { p1: makePlayer("p1", { confidence: 92 }), p2: createPlayer("p2") };
    const opp1 = createPlayer("newOpp1");
    const opp2 = createPlayer("newOpp2");
    players = { ...players, newOpp1: opp1, newOpp2: opp2 };

    const match = makeMatch({ teamA: ["p1", "p2"], teamB: ["newOpp1", "newOpp2"] });
    const result = processMatch({ match, players });
    const p1After = result.updatedPlayers!.p1!;
    expect(p1After.confidence).toBe(95); // 92 + 16 would be 108, clamped to 95
  });
});

describe("processMatch — Echo Damping integration", () => {
  it("applies full weight on a first meeting and decays on repeats within 30 days", () => {
    const basePlayers: Record<string, PlayerState> = {
      a1: makePlayer("a1", { matchesPlayed: 10, confidence: 95 }),
      a2: makePlayer("a2", { matchesPlayed: 10, confidence: 95 }),
      b1: makePlayer("b1", { matchesPlayed: 10, confidence: 95 }),
      b2: makePlayer("b2", { matchesPlayed: 10, confidence: 95 }),
    };

    const match1 = makeMatch({ matchId: "m1", playedAt: 1000 * DAY });
    const first = processMatch({ match: match1, players: basePlayers });
    const firstDelta = first.ledgerEvents!.find((e) => e.playerId === "a1")!.delta;
    expect(first.ledgerEvents!.find((e) => e.playerId === "a1")!.factors.echoDamping).toBe(1);

    const match2 = makeMatch({ matchId: "m2", playedAt: 1005 * DAY });
    const second = processMatch({
      match: match2,
      players: basePlayers,
      recentFixtures: [{ playedAt: match1.playedAt, playerIds: ["a1", "a2", "b1", "b2"] }],
    });
    const secondEvent = second.ledgerEvents!.find((e) => e.playerId === "a1")!;
    expect(secondEvent.factors.echoDamping).toBeCloseTo(0.6, 10);
    expect(Math.abs(secondEvent.delta)).toBeLessThan(Math.abs(firstDelta));

    const match3 = makeMatch({ matchId: "m3", playedAt: 1010 * DAY });
    const third = processMatch({
      match: match3,
      players: basePlayers,
      recentFixtures: [
        { playedAt: match1.playedAt, playerIds: ["a1", "a2", "b1", "b2"] },
        { playedAt: match2.playedAt, playerIds: ["a1", "a2", "b1", "b2"] },
      ],
    });
    const thirdEvent = third.ledgerEvents!.find((e) => e.playerId === "a1")!;
    expect(thirdEvent.factors.echoDamping).toBeCloseTo(0.36, 10);
  });

  it("does not damp a repeat fixture once more than 30 days have passed", () => {
    const players: Record<string, PlayerState> = {
      a1: makePlayer("a1", { matchesPlayed: 10, confidence: 95 }),
      a2: makePlayer("a2", { matchesPlayed: 10, confidence: 95 }),
      b1: makePlayer("b1", { matchesPlayed: 10, confidence: 95 }),
      b2: makePlayer("b2", { matchesPlayed: 10, confidence: 95 }),
    };
    const match = makeMatch({ matchId: "m2", playedAt: 1040 * DAY });
    const result = processMatch({
      match,
      players,
      recentFixtures: [{ playedAt: 1000 * DAY, playerIds: ["a1", "a2", "b1", "b2"] }],
    });
    expect(result.ledgerEvents!.find((e) => e.playerId === "a1")!.factors.echoDamping).toBe(1);
  });
});

describe("processMatch — Walkover and retired policy", () => {
  const players: Record<string, PlayerState> = {
    a1: createPlayer("a1"),
    a2: createPlayer("a2"),
    b1: createPlayer("b1"),
    b2: createPlayer("b2"),
  };

  it("skips unverified matches and leaves state untouched", () => {
    const result = processMatch({ match: makeMatch({ verified: false }), players });
    expect(result).toEqual({ status: "skipped", reason: "unverified" });
  });

  it("skips walkovers entirely, regardless of any games attached", () => {
    const result = processMatch({ match: makeMatch({ outcome: "walkover", gamesWonA: 6, gamesWonB: 0 }), players });
    expect(result).toEqual({ status: "skipped", reason: "walkover" });
  });

  it("skips a 'completed' match with zero games played", () => {
    const result = processMatch({ match: makeMatch({ gamesWonA: 0, gamesWonB: 0 }), players });
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("no-games-played");
  });

  it("skips a retired match where no games were actually played", () => {
    const result = processMatch({ match: makeMatch({ outcome: "retired", gamesWonA: 0, gamesWonB: 0 }), players });
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("retired-no-games");
  });

  it("applies a retired match that has partial, real games on the board", () => {
    const result = processMatch({ match: makeMatch({ outcome: "retired", gamesWonA: 6, gamesWonB: 2 }), players });
    expect(result.status).toBe("applied");
    expect(result.ledgerEvents).toHaveLength(4);
  });

  it("throws on negative games", () => {
    expect(() => processMatch({ match: makeMatch({ gamesWonA: -1 }), players })).toThrow(RangeError);
  });

  it("throws if a player appears on both teams", () => {
    expect(() =>
      processMatch({ match: makeMatch({ teamA: ["a1", "a2"], teamB: ["a1", "b2"] }), players }),
    ).toThrow(/four distinct players/);
  });

  it("throws if a player's state is missing", () => {
    expect(() =>
      processMatch({ match: makeMatch({ teamB: ["ghost", "b2"] }), players }),
    ).toThrow(/Missing player state/);
  });
});

describe("processMatch — Edge cases", () => {
  it("gives equal and opposite deltas when both teams are identical in rating, confidence and history", () => {
    const players: Record<string, PlayerState> = {
      a1: makePlayer("a1", { rating: 4.0, confidence: 50, matchesPlayed: 20 }),
      a2: makePlayer("a2", { rating: 4.0, confidence: 50, matchesPlayed: 20 }),
      b1: makePlayer("b1", { rating: 4.0, confidence: 50, matchesPlayed: 20 }),
      b2: makePlayer("b2", { rating: 4.0, confidence: 50, matchesPlayed: 20 }),
    };
    const result = processMatch({ match: makeMatch({ gamesWonA: 13, gamesWonB: 6 }), players });
    const a1 = result.ledgerEvents!.find((e) => e.playerId === "a1")!;
    const b1 = result.ledgerEvents!.find((e) => e.playerId === "b1")!;
    expect(a1.factors.expectancy).toBeCloseTo(0.5, 10);
    expect(a1.delta).toBeCloseTo(-b1.delta, 10);
  });

  it("never pushes a rating above the 7.00 ceiling", () => {
    // Evenly matched (same rating both sides) so expectancy sits at 0.5 and
    // the win delta is near its per-match maximum, not shrunk by beating a
    // much weaker opponent — the scenario that actually exercises the clamp.
    const players: Record<string, PlayerState> = {
      a1: makePlayer("a1", { rating: 6.99, confidence: 0, matchesPlayed: 0 }),
      a2: makePlayer("a2", { rating: 6.99, confidence: 0, matchesPlayed: 0 }),
      b1: makePlayer("b1", { rating: 6.99, confidence: 0, matchesPlayed: 0 }),
      b2: makePlayer("b2", { rating: 6.99, confidence: 0, matchesPlayed: 0 }),
    };
    const result = processMatch({ match: makeMatch({ gamesWonA: 18, gamesWonB: 0 }), players });
    expect(result.updatedPlayers!.a1!.rating).toBeLessThanOrEqual(SCALE_MAX);
    expect(result.updatedPlayers!.a1!.rating).toBe(SCALE_MAX);
  });

  it("never pushes a rating below the 1.00 floor", () => {
    const players: Record<string, PlayerState> = {
      a1: makePlayer("a1", { rating: 1.01, confidence: 0, matchesPlayed: 0 }),
      a2: makePlayer("a2", { rating: 1.01, confidence: 0, matchesPlayed: 0 }),
      b1: makePlayer("b1", { rating: 1.01, confidence: 0, matchesPlayed: 0 }),
      b2: makePlayer("b2", { rating: 1.01, confidence: 0, matchesPlayed: 0 }),
    };
    const result = processMatch({ match: makeMatch({ winner: "B", gamesWonA: 0, gamesWonB: 18 }), players });
    expect(result.updatedPlayers!.a1!.rating).toBeGreaterThanOrEqual(SCALE_MIN);
    expect(result.updatedPlayers!.a1!.rating).toBe(SCALE_MIN);
  });

  it("increments matchesPlayed by exactly 1 for all four players on an applied match", () => {
    const players: Record<string, PlayerState> = {
      a1: makePlayer("a1", { matchesPlayed: 5 }),
      a2: makePlayer("a2", { matchesPlayed: 5 }),
      b1: makePlayer("b1", { matchesPlayed: 5 }),
      b2: makePlayer("b2", { matchesPlayed: 5 }),
    };
    const result = processMatch({ match: makeMatch(), players });
    for (const id of ["a1", "a2", "b1", "b2"]) {
      expect(result.updatedPlayers![id]!.matchesPlayed).toBe(6);
    }
  });

  it("does not mutate the input players object", () => {
    const players: Record<string, PlayerState> = {
      a1: createPlayer("a1"),
      a2: createPlayer("a2"),
      b1: createPlayer("b1"),
      b2: createPlayer("b2"),
    };
    const snapshot = JSON.parse(JSON.stringify(players));
    processMatch({ match: makeMatch(), players });
    expect(players).toEqual(snapshot);
  });
});
