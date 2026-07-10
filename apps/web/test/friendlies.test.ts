import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  circleMembers,
  circles,
  createTestClient,
  matches,
  ratingEvents,
  rsvps,
  sessions,
  standingGames,
  users,
  type CuatroDb,
  type GameType,
} from "@cuatro/db";
import { PLACEMENT_TRIO_SIZE } from "@cuatro/glass";
import { createMatchesStoreFromClient, type MatchesStore } from "@/server/matches-db";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";

const DAY_MS = 24 * 60 * 60 * 1000;

async function insertUser(db: CuatroDb, email: string, displayName: string) {
  const [row] = await db.insert(users).values({ email, displayName }).returning();
  return row;
}

/** A circle + a played session, with the session's classification set explicitly. */
async function insertCircleAndSession(db: CuatroDb, createdBy: string, startsAt: Date, gameType: GameType) {
  const [circle] = await db
    .insert(circles)
    .values({ name: "Test Circle", inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy })
    .returning();
  const [session] = await db
    .insert(sessions)
    .values({ circleId: circle.id, startsAt: startsAt.getTime(), status: "played", gameType })
    .returning();
  return { circleId: circle.id, sessionId: session.id };
}

async function addMember(db: CuatroDb, circleId: string, userId: string) {
  await db.insert(circleMembers).values({ circleId, userId, role: "member" });
}

async function rsvpIn(db: CuatroDb, sessionId: string, userId: string, respondedAt: Date) {
  await db.insert(rsvps).values({ sessionId, userId, status: "in", respondedAt: respondedAt.getTime(), source: "rsvp" });
  await db.update(users).set({ rsvpInCount: 1 }).where(eq(users.id, userId));
}

/** Record a four-player match on a session and seal it (both teams confirm). */
async function recordAndSeal(store: MatchesStore, sessionId: string, four: { id: string }[]) {
  const [a, b, c, d] = four;
  const { matchId } = await store.recordMatch({
    sessionId,
    reporterId: a.id,
    teamA: [a.id, b.id],
    teamB: [c.id, d.id],
    sets: [
      { a: 6, b: 3 },
      { a: 6, b: 4 },
    ],
  });
  // The reporter's team auto-confirms at record time; the opposing team's
  // confirmation seals it.
  const outcome = await store.confirmMatch(matchId, c.id);
  return { matchId, outcome };
}

describe("FRIENDLIES classification (V1-READINESS #10)", () => {
  let store: MatchesStore;
  let db: CuatroDb;

  beforeEach(async () => {
    __setRealtimeSenderForTests(async () => {}); // swallow broadcasts in-test
    store = createMatchesStoreFromClient(await createTestClient());
    db = store.db;
  });

  afterEach(async () => {
    await store.close();
    __setRealtimeSenderForTests(null);
  });

  describe("inheritance chain defaults to competitive", () => {
    it("circles / standing_games / sessions / matches default to 'competitive' when omitted", async () => {
      const alex = await insertUser(db, "alex@example.com", "Alex");
      const [circle] = await db
        .insert(circles)
        .values({ name: "Defaults", inviteCode: "INV-DEF", createdBy: alex.id })
        .returning();
      expect(circle.defaultGameType).toBe("competitive");

      const [sg] = await db
        .insert(standingGames)
        .values({ circleId: circle.id, weekday: 2, startTime: "20:00" })
        .returning();
      expect(sg.gameType).toBe("competitive");

      const [session] = await db
        .insert(sessions)
        .values({ circleId: circle.id, standingGameId: sg.id, startsAt: Date.now(), status: "played" })
        .returning();
      expect(session.gameType).toBe("competitive");
    });
  });

  describe("the rating gate", () => {
    it("a friendly seal writes NO rating events and never moves Glass, confidence or verifiedMatchCount", async () => {
      const four = await Promise.all(
        ["a", "b", "c", "d"].map((n) => insertUser(db, `${n}@f.com`, n.toUpperCase())),
      );
      const { sessionId } = await insertCircleAndSession(db, four[0].id, new Date(Date.now() - DAY_MS), "friendly");

      const { matchId, outcome } = await recordAndSeal(store, sessionId, four);

      // The match IS a real, sealed result.
      expect(outcome.status).toBe("verified");
      const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
      expect(match.gameType).toBe("friendly");
      expect(match.status).toBe("verified");

      // But the Ledger is untouched: zero rating_events for this match.
      const events = await db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId));
      expect(events).toHaveLength(0);

      // And every player's Glass state is exactly as it started: rating null,
      // confidence 0, verifiedMatchCount 0 (no Placement progress from a friendly).
      for (const p of four) {
        const [u] = await db.select().from(users).where(eq(users.id, p.id));
        expect(u.rating).toBeNull();
        expect(u.confidence).toBe(0);
        expect(u.verifiedMatchCount).toBe(0);
      }
    });

    it("a competitive seal DOES write rating events and moves the Glass state", async () => {
      const four = await Promise.all(
        ["a", "b", "c", "d"].map((n) => insertUser(db, `${n}@c.com`, n.toUpperCase())),
      );
      const { sessionId } = await insertCircleAndSession(db, four[0].id, new Date(Date.now() - DAY_MS), "competitive");

      const { matchId, outcome } = await recordAndSeal(store, sessionId, four);

      expect(outcome.status).toBe("verified");
      const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
      expect(match.gameType).toBe("competitive");

      const events = await db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId));
      expect(events).toHaveLength(4);

      // The Glass state advanced: one verified match logged for each player.
      for (const p of four) {
        const [u] = await db.select().from(users).where(eq(users.id, p.id));
        expect(u.verifiedMatchCount).toBe(1);
        expect(u.verifiedMatchCount).toBeLessThan(PLACEMENT_TRIO_SIZE); // still mid-Placement, rating stays null
        expect(u.rating).toBeNull();
      }
    });
  });

  describe("Reliability is still credited on a friendly seal", () => {
    it("a player who RSVP'd in and played a friendly gets a show-up credited", async () => {
      const four = await Promise.all(
        ["a", "b", "c", "d"].map((n) => insertUser(db, `${n}@r.com`, n.toUpperCase())),
      );
      const { circleId, sessionId } = await insertCircleAndSession(db, four[0].id, new Date(Date.now() - DAY_MS), "friendly");
      for (const p of four) {
        await addMember(db, circleId, p.id);
        await rsvpIn(db, sessionId, p.id, new Date(Date.now() - 2 * DAY_MS));
      }

      const { outcome } = await recordAndSeal(store, sessionId, four);
      expect(outcome.status).toBe("verified");

      // showUpCount moved for everyone who said they were in and turned up —
      // the friendly seal runs creditShowUps exactly like a competitive one.
      for (const p of four) {
        const [u] = await db.select().from(users).where(eq(users.id, p.id));
        expect(u.showUpCount).toBe(1);
        expect(u.rsvpInCount).toBe(1);
      }

      // And no rating movement snuck in alongside the Reliability credit.
      const events = await db.select().from(ratingEvents);
      expect(events).toHaveLength(0);
    });
  });

  describe("classification precedence: the match snapshots the SESSION type", () => {
    it("a friendly session on a circle produces a friendly match; a competitive session a competitive match", async () => {
      const four = await Promise.all(
        ["a", "b", "c", "d"].map((n) => insertUser(db, `${n}@p.com`, n.toUpperCase())),
      );

      // Circle default is friendly, but this session is explicitly competitive:
      // the match must read the session's snapshot, not the circle's default.
      const [circle] = await db
        .insert(circles)
        .values({ name: "Mixed", inviteCode: "INV-MIX", createdBy: four[0].id, defaultGameType: "friendly" })
        .returning();
      const [session] = await db
        .insert(sessions)
        .values({ circleId: circle.id, startsAt: Date.now() - DAY_MS, status: "played", gameType: "competitive" })
        .returning();

      const { matchId } = await recordAndSeal(store, session.id, four);
      const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
      expect(match.gameType).toBe("competitive");

      // And a friendly session yields a friendly match.
      const [friendlySession] = await db
        .insert(sessions)
        .values({ circleId: circle.id, startsAt: Date.now() - DAY_MS, status: "played", gameType: "friendly" })
        .returning();
      const four2 = await Promise.all(
        ["e", "f", "g", "h"].map((n) => insertUser(db, `${n}@p.com`, n.toUpperCase())),
      );
      const { matchId: friendlyMatchId } = await recordAndSeal(store, friendlySession.id, four2);
      const [friendlyMatch] = await db.select().from(matches).where(eq(matches.id, friendlyMatchId));
      expect(friendlyMatch.gameType).toBe("friendly");
    });
  });

  describe("a sealed friendly still counts for match history", () => {
    it("getMatchHistorySummary counts a friendly result like any verified match", async () => {
      const four = await Promise.all(
        ["a", "b", "c", "d"].map((n) => insertUser(db, `${n}@h.com`, n.toUpperCase())),
      );
      const { sessionId } = await insertCircleAndSession(db, four[0].id, new Date(Date.now() - DAY_MS), "friendly");
      await recordAndSeal(store, sessionId, four);

      // four[0] was on team A of a 6-3 6-4 win.
      const summary = await store.getMatchHistorySummary(four[0].id);
      expect(summary.played).toBe(1);
      expect(summary.wins).toBe(1);
      expect(summary.losses).toBe(0);
    });
  });
});
