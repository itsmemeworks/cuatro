import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { circles, matches, notifications, ratingEvents, sessions, users, type CuatroDb } from "@cuatro/db";
import {
  clampRating,
  confidenceMultiplier,
  kFor,
  marginMultiplier,
  round2,
  winExpectancy,
  CONFIDENCE_STEP,
  DEFAULT_STARTING_RATING,
  PLACEMENT_TRIO_SIZE,
} from "@cuatro/glass";
import { createMatchesStore, type MatchesStore } from "@/server/matches-db";

const DAY_MS = 24 * 60 * 60 * 1000;

function insertUser(db: CuatroDb, email: string, displayName: string) {
  return db.insert(users).values({ email, displayName }).returning().get();
}

function insertCircleAndSession(db: CuatroDb, createdBy: string, startsAt: Date) {
  const circle = db
    .insert(circles)
    .values({ name: "Test Circle", inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy })
    .returning()
    .get();
  const session = db
    .insert(sessions)
    .values({ circleId: circle.id, startsAt, status: "played" })
    .returning()
    .get();
  return session.id;
}

describe("result entry + Glass verification flow", () => {
  let store: MatchesStore;
  let db: CuatroDb;

  beforeEach(() => {
    store = createMatchesStore(":memory:");
    db = store.db;
  });

  afterEach(() => {
    store.close();
  });

  it("record -> opposing confirm moves ratings by an independently-computed delta", async () => {
    const alex = insertUser(db, "alex@example.com", "Alex");
    const priya = insertUser(db, "priya@example.com", "Priya");
    const jordan = insertUser(db, "jordan@example.com", "Jordan");
    const kwame = insertUser(db, "kwame@example.com", "Kwame");
    const sessionId = insertCircleAndSession(db, alex.id, new Date(Date.now() - DAY_MS));

    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: alex.id,
      teamA: [alex.id, priya.id],
      teamB: [jordan.id, kwame.id],
      sets: [
        { a: 6, b: 3 },
        { a: 6, b: 4 },
      ],
    });

    // Auto-confirmation for the reporter's team happens at record time.
    const afterRecord = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(afterRecord[0]!.status).toBe("pending_confirmation");

    // "confirm your result" notifications went to the OTHER team only.
    const notifsAfterRecord = await db.select().from(notifications);
    expect(notifsAfterRecord.filter((n) => n.type === "confirm_result").map((n) => n.userId).sort()).toEqual(
      [jordan.id, kwame.id].sort(),
    );

    const outcome = await store.confirmMatch(matchId, jordan.id);
    expect(outcome.status).toBe("verified");

    // Independently compute the expected delta from the raw math building
    // blocks (not by calling processMatch/matches-db) — both teams start at
    // the default 3.00 rating with zero verified matches, so K is the
    // Placement K and confidence multiplier is at its 0%-confidence maximum.
    const expectancyA = winExpectancy(DEFAULT_STARTING_RATING, DEFAULT_STARTING_RATING);
    const margin = marginMultiplier(12, 19); // 6-3 6-4 = 12 games to 7 of 19
    const k = kFor(0);
    const confMult = confidenceMultiplier(0);
    const winnerDelta = round2(
      clampRating(DEFAULT_STARTING_RATING + k * (1 - expectancyA) * margin * confMult) - DEFAULT_STARTING_RATING,
    );
    const loserDelta = round2(
      clampRating(DEFAULT_STARTING_RATING + k * (0 - (1 - expectancyA)) * margin * confMult) - DEFAULT_STARTING_RATING,
    );

    const events = await db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId));
    expect(events).toHaveLength(4);

    const alexEvent = events.find((e) => e.userId === alex.id)!;
    const jordanEvent = events.find((e) => e.userId === jordan.id)!;
    expect(alexEvent.delta).toBeCloseTo(winnerDelta, 10);
    expect(jordanEvent.delta).toBeCloseTo(loserDelta, 10);
    expect(alexEvent.ratingAfter).toBeCloseTo(round2(DEFAULT_STARTING_RATING + winnerDelta), 10);
    expect(alexEvent.ratingBefore).toBeNull(); // this user's very first rating_event

    // Still inside the Placement Trio (1 of 3) -> users.rating stays hidden,
    // but confidence/verifiedMatchCount still move.
    const [alexRow] = await db.select().from(users).where(eq(users.id, alex.id));
    expect(alexRow!.rating).toBeNull();
    expect(alexRow!.verifiedMatchCount).toBe(1);
    expect(alexRow!.confidence).toBeCloseTo((2 * CONFIDENCE_STEP) / 100, 10); // 2 brand-new opponents

    const notifsAfterVerify = await db.select().from(notifications).where(eq(notifications.type, "result_verified"));
    expect(notifsAfterVerify.map((n) => n.userId).sort()).toEqual([alex.id, jordan.id, kwame.id, priya.id].sort());
  });

  it("transitions Unrated -> Rated exactly at the 3rd verified match", async () => {
    const player = insertUser(db, "player@example.com", "Player");
    const partner = insertUser(db, "partner@example.com", "Partner");
    const start = Date.now() - 10 * DAY_MS;

    let lastMatchId = "";
    for (let i = 0; i < 3; i++) {
      const opp1 = insertUser(db, `opp1-${i}@example.com`, `Opp1-${i}`);
      const opp2 = insertUser(db, `opp2-${i}@example.com`, `Opp2-${i}`);
      const sessionId = insertCircleAndSession(db, player.id, new Date(start + i * DAY_MS));
      const { matchId } = await store.recordMatch({
        sessionId,
        reporterId: player.id,
        teamA: [player.id, partner.id],
        teamB: [opp1.id, opp2.id],
        sets: [{ a: 6, b: 2 }],
      });
      lastMatchId = matchId;
      await store.confirmMatch(matchId, opp1.id);

      const [row] = await db.select().from(users).where(eq(users.id, player.id));
      if (i < 2) {
        expect(row!.rating).toBeNull();
      } else {
        expect(row!.rating).not.toBeNull();
      }
    }

    const [finalRow] = await db.select().from(users).where(eq(users.id, player.id));
    expect(finalRow!.verifiedMatchCount).toBe(PLACEMENT_TRIO_SIZE);

    const finalEvent = (await db.select().from(ratingEvents).where(eq(ratingEvents.matchId, lastMatchId))).find(
      (e) => e.userId === player.id,
    )!;
    expect(finalRow!.rating).toBeCloseTo(finalEvent.ratingAfter, 10);

    const placementNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "placement_complete"));
    expect(placementNotifs.map((n) => n.userId)).toContain(player.id);
  });

  it("damps a repeat fixture within 30 days (Echo Damping)", async () => {
    const a = insertUser(db, "a@example.com", "A");
    const b = insertUser(db, "b@example.com", "B");
    const c = insertUser(db, "c@example.com", "C");
    const d = insertUser(db, "d@example.com", "D");
    const now = Date.now();

    const session1 = insertCircleAndSession(db, a.id, new Date(now - 5 * DAY_MS));
    const { matchId: match1Id } = await store.recordMatch({
      sessionId: session1,
      reporterId: a.id,
      teamA: [a.id, b.id],
      teamB: [c.id, d.id],
      sets: [{ a: 6, b: 4 }],
    });
    await store.confirmMatch(match1Id, c.id);

    const session2 = insertCircleAndSession(db, a.id, new Date(now - 1 * DAY_MS));
    const { matchId: match2Id } = await store.recordMatch({
      sessionId: session2,
      reporterId: a.id,
      teamA: [a.id, b.id],
      teamB: [c.id, d.id],
      sets: [{ a: 6, b: 4 }],
    });
    await store.confirmMatch(match2Id, c.id);

    const events1 = await db.select().from(ratingEvents).where(eq(ratingEvents.matchId, match1Id));
    const events2 = await db.select().from(ratingEvents).where(eq(ratingEvents.matchId, match2Id));

    for (const ev of events1) {
      expect(ev.factors.echoDampingMultiplier).toBe(1);
      expect(ev.factors.isFirstMeeting).toBe(true);
    }
    for (const ev of events2) {
      expect(ev.factors.echoDampingMultiplier).toBeCloseTo(0.6, 10);
      expect(ev.factors.isFirstMeeting).toBe(false);
    }

    const aEvent1 = events1.find((e) => e.userId === a.id)!;
    const aEvent2 = events2.find((e) => e.userId === a.id)!;
    expect(Math.abs(aEvent2.delta)).toBeLessThan(Math.abs(aEvent1.delta));
  });

  it("a dispute blocks all rating movement", async () => {
    const a = insertUser(db, "a2@example.com", "A2");
    const b = insertUser(db, "b2@example.com", "B2");
    const c = insertUser(db, "c2@example.com", "C2");
    const d = insertUser(db, "d2@example.com", "D2");
    const sessionId = insertCircleAndSession(db, a.id, new Date(Date.now() - DAY_MS));

    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: a.id,
      teamA: [a.id, b.id],
      teamB: [c.id, d.id],
      sets: [{ a: 6, b: 1 }],
    });

    const outcome = await store.disputeMatch(matchId, c.id);
    expect(outcome.status).toBe("disputed");

    const [matchRow] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(matchRow!.status).toBe("disputed");

    const events = await db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId));
    expect(events).toHaveLength(0);

    for (const u of [a, b, c, d]) {
      const [row] = await db.select().from(users).where(eq(users.id, u.id));
      expect(row!.rating).toBeNull();
      expect(row!.verifiedMatchCount).toBe(0);
    }
  });

  it("double-confirming (or a teammate re-confirming) does not double-apply Glass", async () => {
    const a = insertUser(db, "a3@example.com", "A3");
    const b = insertUser(db, "b3@example.com", "B3");
    const c = insertUser(db, "c3@example.com", "C3");
    const d = insertUser(db, "d3@example.com", "D3");
    const sessionId = insertCircleAndSession(db, a.id, new Date(Date.now() - DAY_MS));

    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: a.id,
      teamA: [a.id, b.id],
      teamB: [c.id, d.id],
      sets: [{ a: 6, b: 2 }],
    });

    // Reporter's own teammate re-confirming before the other team acts is a no-op.
    const stillPending = await store.confirmMatch(matchId, b.id);
    expect(stillPending.status).toBe("pending_confirmation");

    const first = await store.confirmMatch(matchId, c.id);
    expect(first.status).toBe("verified");

    const ratingAfterFirst = await db.select().from(users).where(eq(users.id, a.id));

    // The other member of the already-confirmed team confirms again, and the
    // same user confirms a second time — both must be no-ops.
    const second = await store.confirmMatch(matchId, d.id);
    const third = await store.confirmMatch(matchId, c.id);
    expect(second.status).toBe("verified");
    expect(second.alreadyFinal).toBe(true);
    expect(third.alreadyFinal).toBe(true);

    const events = await db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId));
    expect(events).toHaveLength(4);

    const ratingAfterRepeat = await db.select().from(users).where(eq(users.id, a.id));
    expect(ratingAfterRepeat[0]!.confidence).toBeCloseTo(ratingAfterFirst[0]!.confidence, 10);
    expect(ratingAfterRepeat[0]!.verifiedMatchCount).toBe(1);
  });
});
