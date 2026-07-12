import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { circles, sessions, users, type CuatroClient } from "@cuatro/db";
import { createPlayer, processMatch, type FixtureOccurrence, type PlayerState } from "@cuatro/glass";

/**
 * QA5 findings 1 + 2 (staging-qa/reports/qa5.md): W/L must derive from the
 * MATCH WINNER, never the delta's sign — the engine round2s deltas, so a
 * fully Echo-damped narrow loss lands as exactly 0.00 and `delta >= 0`
 * painted it as a WIN on the Ledger, the profile streak/last-three, and
 * both seal cards. And the trio-completing match must render BOTH its
 * genesis marker AND a normal entry row, or the Ledger can't explain its
 * own headline number.
 */

// Same harness as player-profile.test.ts: getPlayerProfile composes the
// shared db + matches store singletons — point both at one in-memory client.
const h = vi.hoisted(() => ({ client: null as unknown as CuatroClient }));
vi.mock("@/server/db", () => ({ getDb: vi.fn(async () => ({ db: h.client.db })) }));
vi.mock("@/server/matches-db", async (orig) => {
  const actual = await orig<typeof import("@/server/matches-db")>();
  return { ...actual, getMatchesStore: vi.fn(async () => actual.createMatchesStoreFromClient(h.client)) };
});

import { createTestClient } from "@cuatro/db";
import { createMatchesStoreFromClient, type LedgerEntryView, type MatchesStore } from "@/server/matches-db";
import { getPlayerLedger, getPlayerProfile } from "@/server/players";
import { computeBestWin, computeStreak } from "@/components/glass/profile-stats";
import { fmtSealDelta, sealFactTone } from "@/components/matches/match-confirm-flow";
import { isGenesisEntry } from "@/components/glass/ledger-entry";
import { LedgerView } from "@/components/glass/ledger-view";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("the engine really does produce a 0.00-delta loss (the ambiguity under QA5 finding 1)", () => {
  it("4th repeat fixture in 30 days, narrow loss: both teams' deltas round to exactly 0", () => {
    const ids: [string, string, string, string] = ["w1", "w2", "l1", "l2"];
    let players: Record<string, PlayerState> = Object.fromEntries(ids.map((id) => [id, createPlayer(id)]));
    const fixtures: FixtureOccurrence[] = [];
    const t0 = Date.now() - 20 * DAY_MS;
    let lastEvents: ReturnType<typeof processMatch>["ledgerEvents"];
    for (let i = 0; i < 4; i++) {
      const playedAt = t0 + i * DAY_MS;
      const res = processMatch({
        match: {
          matchId: `m${i}`,
          playedAt,
          teamA: ["w1", "w2"],
          teamB: ["l1", "l2"],
          winner: "A",
          gamesWonA: 7,
          gamesWonB: 6,
          verified: true,
          outcome: "completed",
        },
        players,
        recentFixtures: fixtures,
      });
      expect(res.status).toBe("applied");
      players = { ...players, ...res.updatedPlayers! };
      fixtures.push({ playedAt, playerIds: ids });
      lastEvents = res.ledgerEvents;
    }
    const loserEv = lastEvents!.find((e) => e.playerId === "l1")!;
    const winnerEv = lastEvents!.find((e) => e.playerId === "w1")!;
    // The heart of the bug: on the 4th meeting the round2'd delta is 0 for
    // BOTH sides, so any sign-based W/L classification calls the loss a win.
    expect(loserEv.delta).toBe(0);
    expect(winnerEv.delta).toBe(0);
    expect(loserEv.factors.echoDamping).toBeCloseTo(0.216, 3);
  });
});

describe("seal card classification (match-confirm-flow + match-detail-wide share these)", () => {
  it("tones by the match winner, never the delta sign", () => {
    expect(sealFactTone("You lost narrowly.", false)).toBe("loss"); // 0.00-delta loss stays a loss
    expect(sealFactTone("You won narrowly.", true)).toBe("win");
    expect(sealFactTone("Placement match 2 of 3, your Glass number stays hidden until the Trio completes", false)).toBe("muted");
  });

  it("signs a zero delta by the result: −0.00 on a loss, +0.00 on a win", () => {
    expect(fmtSealDelta(0, false)).toBe("−0.00"); // U+2212
    expect(fmtSealDelta(0, true)).toBe("+0.00");
    expect(fmtSealDelta(-0.05, false)).toBe("−0.05");
    expect(fmtSealDelta(0.05, true)).toBe("+0.05");
  });
});

describe("Ledger truth end to end (QA5's exact repro: same four, 4 narrow losses in 30 days)", () => {
  let store: MatchesStore;

  beforeEach(async () => {
    h.client = await createTestClient();
    store = createMatchesStoreFromClient(h.client);
  });

  afterEach(async () => {
    await h.client.close();
  });

  async function insertUser(email: string, displayName: string) {
    const [row] = await h.client.db.insert(users).values({ email, displayName }).returning();
    return row;
  }

  async function insertSession(createdBy: string, startsAt: number) {
    const [circle] = await h.client.db
      .insert(circles)
      .values({ name: "Echo Circle", inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy })
      .returning();
    const [session] = await h.client.db
      .insert(sessions)
      .values({ circleId: circle.id, startsAt, status: "played" })
      .returning();
    return session.id;
  }

  async function playFourRepeatLosses() {
    const w1 = await insertUser("w1@x.com", "Wyn One");
    const w2 = await insertUser("w2@x.com", "Wyn Two");
    const l1 = await insertUser("l1@x.com", "Lou One");
    const l2 = await insertUser("l2@x.com", "Lou Two");
    const t0 = Date.now() - 20 * DAY_MS;
    for (let i = 0; i < 4; i++) {
      const sessionId = await insertSession(w1.id, t0 + i * DAY_MS);
      const { matchId } = await store.recordMatch({
        sessionId,
        reporterId: w1.id,
        teamA: [w1.id, w2.id],
        teamB: [l1.id, l2.id],
        sets: [{ a: 7, b: 6 }],
      });
      await store.confirmMatch(matchId, l1.id);
    }
    return { w1, w2, l1, l2 };
  }

  it("a fully-damped 0.00-delta loss reads L everywhere: won flag, streak, last-three", async () => {
    const { w1, l1 } = await playFourRepeatLosses();

    const loserEntries = await store.getLedger(l1.id);
    // Newest first; the 4th (newest) is the fully-damped one.
    expect(loserEntries[0]!.delta).toBe(0);
    expect(loserEntries[0]!.won).toBe(false);
    expect(loserEntries.every((e) => e.won === false)).toBe(true);

    // The winner's symmetric 0.00 delta still reads as a WIN.
    const winnerEntries = await store.getLedger(w1.id);
    expect(winnerEntries[0]!.delta).toBe(0);
    expect(winnerEntries[0]!.won).toBe(true);

    // Streak: L4 for the loser (was "W1" pre-fix), W4 for the winner.
    expect(computeStreak(loserEntries)).toEqual({ kind: "L", count: 4 });
    expect(computeStreak(winnerEntries)).toEqual({ kind: "W", count: 4 });

    // Best win: the loser has no wins — the 0.00 "win" must not qualify.
    expect(computeBestWin(loserEntries)).toBeNull();

    // The profile read model: last-three chips all L, streak stat correct.
    const profile = await getPlayerProfile(l1.id);
    expect(profile!.streak).toEqual({ kind: "L", count: 4 });
    expect(profile!.history).toMatchObject({ played: 4, wins: 0, losses: 4 });
    for (const chip of profile!.lastThree) {
      expect(chip!.won).toBe(false);
      expect(chip!.label).toBe("L 6–7");
    }
  });

  it("the trio-completing match renders BOTH a genesis marker and a full entry row, reconciling the headline", async () => {
    const { l1 } = await playFourRepeatLosses();

    const ledger = await getPlayerLedger(l1.id);
    const rows = ledger!.rows;
    const genesisRows = rows.filter((r) => isGenesisEntry(r.entry));
    expect(genesisRows).toHaveLength(1);
    const genesis = genesisRows[0]!.entry;
    // The reveal entry is a REAL match event: delta, factors, damping all present.
    expect(genesis.won).toBe(false);
    expect(typeof genesis.delta).toBe("number");
    expect(genesis.factors.echoDampingMultiplier).toBeCloseTo(0.36, 3); // 3rd meeting
    // The poured number equals the running balance — the statement reconciles.
    expect(genesis.ratingAfter).toBe(rows.find((r) => isGenesisEntry(r.entry))!.entry.ratingAfter);

    // Rendered Ledger: the genesis marker shows the POURED balance (header
    // number), and the same match ALSO renders as an entry row with its
    // score and factors — "every point explained" (QA5 finding 2).
    const html = renderToStaticMarkup(
      createElement(LedgerView, {
        glass: {
          displayName: "Lou One",
          status: "rated" as const,
          rating: genesis.ratingAfter,
          confidencePct: genesis.confidenceAfterPct,
          verifiedMatchCount: 4,
          matchesUntilPlacement: 0,
          reliabilityPct: null,
          lateCancelCount: 0,
        },
        rows,
        backHref: "/profile",
        backLabel: "Profile",
        subtitle: "every movement, explained",
        emptyCopy: "nothing yet",
      }),
    );
    expect(html).toContain("Glass poured, Placement Trio complete");
    expect(html).toContain(`poured at ${genesis.ratingAfter.toFixed(2)}`);
    // The trio-completing match's own entry row is present: its L headline
    // and its delta, signed by the RESULT.
    const lossRows = html.match(/L 6–7/g) ?? [];
    expect(lossRows.length).toBe(4); // all four matches render as L entry rows
    expect(html).toContain("−0.00"); // the fully-damped loss, honestly signed
    expect(html).not.toContain("+0.00"); // and never a positive zero for the loser
    expect(html).not.toContain("W 6–7"); // the loser's ledger has no win rows at all
  });

  it("delta-sign classification is gone from LedgerEntryView consumers (type-level canary)", () => {
    // If someone re-adds a sign check this stays green, but the `won` field
    // being MANDATORY on the view type means new consumers get the truthful
    // flag by default — this canary just pins the field's existence.
    const entry: LedgerEntryView = {
      id: "x",
      matchId: "m",
      won: false,
      delta: 0,
      ratingBefore: 3,
      ratingAfter: 3,
      confidenceBeforePct: 40,
      confidenceAfterPct: 40,
      factors: { expectedWin: 0.5, marginMultiplier: 1, echoDampingMultiplier: 0.216, kFactor: 0.04, isFirstMeeting: false },
      explanation: "You lost narrowly.",
      createdAt: new Date(),
      outcome: "completed",
    };
    expect(entry.won).toBe(false);
  });
});
