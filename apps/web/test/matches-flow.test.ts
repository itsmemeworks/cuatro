import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { circleMembers, circles, matches, notifications, ratingEvents, rsvps, sessions, users, type CuatroDb } from "@cuatro/db";
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
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";
import { circleChannel, sessionChannel, userChannel } from "@/lib/realtime/channels";

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

function insertCircleWithSession(db: CuatroDb, createdBy: string, startsAt: Date) {
  const circle = db
    .insert(circles)
    .values({ name: "Test Circle", inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy })
    .returning()
    .get();
  const session = db.insert(sessions).values({ circleId: circle.id, startsAt, status: "played" }).returning().get();
  return { circleId: circle.id, sessionId: session.id };
}

function addMember(db: CuatroDb, circleId: string, userId: string, role: "organiser" | "member" = "member") {
  db.insert(circleMembers).values({ circleId, userId, role }).run();
}

function rsvpIn(
  db: CuatroDb,
  sessionId: string,
  userId: string,
  respondedAt: Date,
  source: "rsvp" | "fourth_call" = "rsvp",
) {
  db.insert(rsvps).values({ sessionId, userId, status: "in", respondedAt, source }).run();
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

  it("defaults a match's outcome to 'completed'", async () => {
    const a = insertUser(db, "a4@example.com", "A4");
    const b = insertUser(db, "b4@example.com", "B4");
    const c = insertUser(db, "c4@example.com", "C4");
    const d = insertUser(db, "d4@example.com", "D4");
    const sessionId = insertCircleAndSession(db, a.id, new Date(Date.now() - DAY_MS));

    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: a.id,
      teamA: [a.id, b.id],
      teamB: [c.id, d.id],
      sets: [{ a: 6, b: 2 }],
    });

    const [row] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(row!.outcome).toBe("completed");
  });

  it("records a retired match with zero games, and verifying it moves no one's Glass", async () => {
    const a = insertUser(db, "a5@example.com", "A5");
    const b = insertUser(db, "b5@example.com", "B5");
    const c = insertUser(db, "c5@example.com", "C5");
    const d = insertUser(db, "d5@example.com", "D5");
    const sessionId = insertCircleAndSession(db, a.id, new Date(Date.now() - DAY_MS));

    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: a.id,
      teamA: [a.id, b.id],
      teamB: [c.id, d.id],
      sets: [],
      outcome: "retired",
    });

    const [row] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(row!.outcome).toBe("retired");

    const outcome = await store.confirmMatch(matchId, c.id);
    expect(outcome.status).toBe("verified");

    const [verifiedRow] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(verifiedRow!.status).toBe("verified");

    const events = await db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId));
    expect(events).toHaveLength(0);

    for (const u of [a, b, c, d]) {
      const [row2] = await db.select().from(users).where(eq(users.id, u.id));
      expect(row2!.verifiedMatchCount).toBe(0);
    }
  });

  it("rejects a completed match recorded with no sets", async () => {
    const a = insertUser(db, "a6@example.com", "A6");
    const b = insertUser(db, "b6@example.com", "B6");
    const c = insertUser(db, "c6@example.com", "C6");
    const d = insertUser(db, "d6@example.com", "D6");
    const sessionId = insertCircleAndSession(db, a.id, new Date(Date.now() - DAY_MS));

    await expect(
      store.recordMatch({
        sessionId,
        reporterId: a.id,
        teamA: [a.id, b.id],
        teamB: [c.id, d.id],
        sets: [],
      }),
    ).rejects.toThrow();
  });

  it("getMatchForSession finds the most recently recorded match, or null before one exists", async () => {
    const a = insertUser(db, "a7@example.com", "A7");
    const b = insertUser(db, "b7@example.com", "B7");
    const c = insertUser(db, "c7@example.com", "C7");
    const d = insertUser(db, "d7@example.com", "D7");
    const sessionId = insertCircleAndSession(db, a.id, new Date(Date.now() - DAY_MS));

    expect(await store.getMatchForSession(sessionId)).toBeNull();

    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: a.id,
      teamA: [a.id, b.id],
      teamB: [c.id, d.id],
      sets: [{ a: 6, b: 2 }],
    });

    const found = await store.getMatchForSession(sessionId);
    expect(found?.id).toBe(matchId);
    expect(found?.status).toBe("pending_confirmation");
  });

  it("getPendingConfirmationsForUser lists matches awaiting the viewer's own team, and drops off once that team has confirmed", async () => {
    const a = insertUser(db, "a8@example.com", "A8");
    const b = insertUser(db, "b8@example.com", "B8");
    const c = insertUser(db, "c8@example.com", "C8");
    const d = insertUser(db, "d8@example.com", "D8");
    const sessionId = insertCircleAndSession(db, a.id, new Date(Date.now() - DAY_MS));

    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: a.id,
      teamA: [a.id, b.id],
      teamB: [c.id, d.id],
      sets: [{ a: 6, b: 2 }],
    });

    // Reporter's team (A) already auto-confirmed at record time — no action item for them.
    expect(await store.getPendingConfirmationsForUser(a.id)).toEqual([]);

    // Team B hasn't confirmed yet — it's an action item for both of them.
    const pendingForC = await store.getPendingConfirmationsForUser(c.id);
    expect(pendingForC).toHaveLength(1);
    expect(pendingForC[0]!.matchId).toBe(matchId);
    expect(pendingForC[0]!.opponentNames.split(" & ").sort()).toEqual(["A8", "B8"]);

    await store.confirmMatch(matchId, c.id);

    // Now verified — no longer a pending action for either team.
    expect(await store.getPendingConfirmationsForUser(c.id)).toEqual([]);
    expect(await store.getPendingConfirmationsForUser(d.id)).toEqual([]);
  });
});

describe("one match per session (v1 audit blocker B1)", () => {
  let store: MatchesStore;
  let db: CuatroDb;

  beforeEach(() => {
    store = createMatchesStore(":memory:");
    db = store.db;
  });

  afterEach(() => {
    store.close();
  });

  it("a second record for the same session throws MatchAlreadyRecordedError pointing at the first match", async () => {
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
      sets: [{ a: 6, b: 3 }],
    });

    // A different reporter recording the SAME game must not mint a duplicate
    // (both sealing would double-run Glass and push Reliability past 100%).
    await expect(
      store.recordMatch({
        sessionId,
        reporterId: jordan.id,
        teamA: [jordan.id, kwame.id],
        teamB: [alex.id, priya.id],
        sets: [{ a: 6, b: 3 }],
      }),
    ).rejects.toMatchObject({ name: "MatchAlreadyRecordedError", existingMatchId: matchId });

    // Exactly one match exists, and no second team-A auto-confirmation or
    // guest/user rows leaked from the rejected attempt.
    const all = await db.select().from(matches);
    expect(all).toHaveLength(1);
  });
});

describe("substitutes at result entry — record who PLAYED, not who RSVP'd", () => {
  let store: MatchesStore;
  let db: CuatroDb;

  beforeEach(() => {
    store = createMatchesStore(":memory:");
    db = store.db;
  });

  afterEach(() => {
    store.close();
  });

  it("getRosterContext returns the confirmed four in RSVP order, plus subbable Circle members", async () => {
    const alex = insertUser(db, "ra1@example.com", "Alex");
    const priya = insertUser(db, "rp1@example.com", "Priya");
    const jordan = insertUser(db, "rj1@example.com", "Jordan"); // a member who didn't RSVP
    const now = Date.now();
    const { circleId, sessionId } = insertCircleWithSession(db, alex.id, new Date(now - DAY_MS));
    addMember(db, circleId, alex.id, "organiser");
    addMember(db, circleId, priya.id);
    addMember(db, circleId, jordan.id);
    // Priya RSVP'd first, Alex second — confirmed order must follow respondedAt.
    rsvpIn(db, sessionId, priya.id, new Date(now - 3 * DAY_MS));
    rsvpIn(db, sessionId, alex.id, new Date(now - 2 * DAY_MS));

    const roster = (await store.getRosterContext(sessionId, alex.id))!;
    expect(roster.confirmed.map((p) => p.displayName)).toEqual(["Priya", "Alex"]);
    // Jordan didn't RSVP but is a member — a candidate to sub in; the two
    // confirmed players are not repeated in the candidate pool.
    expect(roster.candidates.map((p) => p.id)).toContain(jordan.id);
    expect(roster.candidates.map((p) => p.id)).not.toContain(alex.id);
    expect(roster.candidates.map((p) => p.id)).not.toContain(priya.id);
  });

  it("surfaces the viewer as a candidate even when they aren't a Circle member, so they can add themselves", async () => {
    const organiser = insertUser(db, "ro2@example.com", "Org");
    const viewer = insertUser(db, "rv2@example.com", "Viewer");
    const { circleId, sessionId } = insertCircleWithSession(db, organiser.id, new Date(Date.now() - DAY_MS));
    addMember(db, circleId, organiser.id, "organiser");

    const roster = (await store.getRosterContext(sessionId, viewer.id))!;
    expect(roster.candidates.map((p) => p.id)).toContain(viewer.id);
  });

  it("subs in a Circle member who never RSVP'd, and Glass moves for all four who played", async () => {
    const alex = insertUser(db, "sa@example.com", "Alex");
    const priya = insertUser(db, "sp@example.com", "Priya");
    const jordan = insertUser(db, "sj@example.com", "Jordan");
    const sub = insertUser(db, "ss@example.com", "Sub"); // never tapped "I'm in"
    const sessionId = insertCircleAndSession(db, alex.id, new Date(Date.now() - DAY_MS));

    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: alex.id,
      teamA: [alex.id, priya.id],
      teamB: [jordan.id, sub.id],
      sets: [{ a: 6, b: 3 }],
    });
    const outcome = await store.confirmMatch(matchId, jordan.id);
    expect(outcome.status).toBe("verified");

    const events = await db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId));
    expect(events.map((e) => e.userId).sort()).toEqual([alex.id, priya.id, jordan.id, sub.id].sort());
  });

  it("subs in a brand-new named guest: mints a guest users row, seals via the guest's real teammate, and moves Glass for all four", async () => {
    const alex = insertUser(db, "ga@example.com", "Alex");
    const priya = insertUser(db, "gp@example.com", "Priya");
    const jordan = insertUser(db, "gj@example.com", "Jordan");
    const sessionId = insertCircleAndSession(db, alex.id, new Date(Date.now() - DAY_MS));

    // The fourth was a mate off the street who never had an account — the
    // reporter names them at entry time as a `guest:` token.
    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: alex.id,
      teamA: [alex.id, priya.id],
      teamB: [jordan.id, "g0"],
      sets: [
        { a: 6, b: 4 },
        { a: 6, b: 3 },
      ],
      newGuests: [{ token: "g0", name: "Mo" }],
    });

    // A real guest users row exists, first-class (is_guest=1, no email).
    const guest = (await db.select().from(users).where(eq(users.displayName, "Mo")))[0]!;
    expect(guest.isGuest).toBe(true);
    expect(guest.email).toBeNull();

    // The match carries the guest's real id — the token never reaches the DB.
    const [matchRow] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(matchRow!.teamBPlayer2Id).toBe(guest.id);

    // Jordan (the guest's real teammate) can seal team B — the device-less
    // guest can't confirm, but any real member of a team confirms for it.
    const outcome = await store.confirmMatch(matchId, jordan.id);
    expect(outcome.status).toBe("verified");

    const events = await db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId));
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.userId).sort()).toEqual([alex.id, priya.id, jordan.id, guest.id].sort());

    // The guest accrues a Placement match like anyone: hidden rating (null)
    // until the Trio, but the verified-match counter moves.
    const [guestAfter] = await db.select().from(users).where(eq(users.id, guest.id));
    expect(guestAfter!.rating).toBeNull();
    expect(guestAfter!.verifiedMatchCount).toBe(1);
  });

  it("rejects a substitute with a blank name, and a guest token that isn't one of the four slots", async () => {
    const alex = insertUser(db, "ba@example.com", "Alex");
    const priya = insertUser(db, "bp@example.com", "Priya");
    const jordan = insertUser(db, "bj@example.com", "Jordan");
    const sessionId = insertCircleAndSession(db, alex.id, new Date(Date.now() - DAY_MS));

    await expect(
      store.recordMatch({
        sessionId,
        reporterId: alex.id,
        teamA: [alex.id, priya.id],
        teamB: [jordan.id, "g0"],
        sets: [{ a: 6, b: 3 }],
        newGuests: [{ token: "g0", name: "   " }],
      }),
    ).rejects.toThrow();

    await expect(
      store.recordMatch({
        sessionId,
        reporterId: alex.id,
        teamA: [alex.id, priya.id],
        teamB: [jordan.id, "g0"],
        sets: [{ a: 6, b: 3 }],
        newGuests: [{ token: "gX", name: "Mo" }], // token nobody plays
      }),
    ).rejects.toThrow();

    // No orphan guest row survives a rejected record.
    expect(await db.select().from(users).where(eq(users.isGuest, true))).toHaveLength(0);
  });
});

describe("Reliability — show-up crediting on verification (the who-PLAYED loop)", () => {
  let store: MatchesStore;
  let db: CuatroDb;

  beforeEach(() => {
    store = createMatchesStore(":memory:");
    db = store.db;
  });

  afterEach(() => {
    store.close();
  });

  const showUpOf = async (userId: string) =>
    (await db.select().from(users).where(eq(users.id, userId)))[0]!.showUpCount;

  it("credits showUp exactly once to each RSVP'd-in player who played the verified match", async () => {
    const alex = insertUser(db, "su-a@example.com", "Alex");
    const priya = insertUser(db, "su-p@example.com", "Priya");
    const jordan = insertUser(db, "su-j@example.com", "Jordan");
    const kwame = insertUser(db, "su-k@example.com", "Kwame");
    const now = Date.now();
    const sessionId = insertCircleAndSession(db, alex.id, new Date(now - DAY_MS));
    for (const u of [alex, priya, jordan, kwame]) rsvpIn(db, sessionId, u.id, new Date(now - 2 * DAY_MS));

    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: alex.id,
      teamA: [alex.id, priya.id],
      teamB: [jordan.id, kwame.id],
      sets: [{ a: 6, b: 3 }],
    });

    // Pending, not yet verified — no show-up credited until the seal.
    expect(await showUpOf(alex.id)).toBe(0);

    const outcome = await store.confirmMatch(matchId, jordan.id);
    expect(outcome.status).toBe("verified");

    for (const u of [alex, priya, jordan, kwame]) {
      expect(await showUpOf(u.id)).toBe(1);
    }
  });

  it("credits a ring-3 claimant (rsvp status=in, source=fourth_call) who turned up", async () => {
    const alex = insertUser(db, "su-fa@example.com", "Alex");
    const priya = insertUser(db, "su-fp@example.com", "Priya");
    const jordan = insertUser(db, "su-fj@example.com", "Jordan");
    const claimant = insertUser(db, "su-fc@example.com", "Claimant");
    const now = Date.now();
    const sessionId = insertCircleAndSession(db, alex.id, new Date(now - DAY_MS));
    for (const u of [alex, priya, jordan]) rsvpIn(db, sessionId, u.id, new Date(now - 2 * DAY_MS));
    // The fourth was filled through the Fourth Call — a real "in" commitment.
    rsvpIn(db, sessionId, claimant.id, new Date(now - DAY_MS), "fourth_call");

    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: alex.id,
      teamA: [alex.id, priya.id],
      teamB: [jordan.id, claimant.id],
      sets: [{ a: 6, b: 4 }],
    });
    await store.confirmMatch(matchId, jordan.id);

    expect(await showUpOf(claimant.id)).toBe(1);
  });

  it("a no-show (rsvp'd in but absent from the played roster) gets no show-up", async () => {
    const alex = insertUser(db, "ns-a@example.com", "Alex");
    const priya = insertUser(db, "ns-p@example.com", "Priya");
    const jordan = insertUser(db, "ns-j@example.com", "Jordan");
    const noShow = insertUser(db, "ns-x@example.com", "NoShow"); // said "in", never turned up
    const sub = insertUser(db, "ns-s@example.com", "Sub"); // turned up in their place, never RSVP'd
    const now = Date.now();
    const sessionId = insertCircleAndSession(db, alex.id, new Date(now - DAY_MS));
    for (const u of [alex, priya, jordan, noShow]) rsvpIn(db, sessionId, u.id, new Date(now - 2 * DAY_MS));

    // The roster records who PLAYED: the no-show is replaced by the sub.
    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: alex.id,
      teamA: [alex.id, priya.id],
      teamB: [jordan.id, sub.id],
      sets: [{ a: 6, b: 2 }],
    });
    await store.confirmMatch(matchId, jordan.id);

    // The three who both RSVP'd-in and played are credited.
    for (const u of [alex, priya, jordan]) expect(await showUpOf(u.id)).toBe(1);
    // The no-show RSVP'd in but isn't on the roster — no credit, so their ratio drops.
    expect(await showUpOf(noShow.id)).toBe(0);
    // The sub played but never RSVP'd in — no credit, and their rsvpInCount was never moved either.
    expect(await showUpOf(sub.id)).toBe(0);
  });

  it("a sub who played without any rsvp row gets nothing", async () => {
    const alex = insertUser(db, "sub-a@example.com", "Alex");
    const priya = insertUser(db, "sub-p@example.com", "Priya");
    const jordan = insertUser(db, "sub-j@example.com", "Jordan");
    const sub = insertUser(db, "sub-s@example.com", "Sub"); // no rsvp row at all
    const now = Date.now();
    const sessionId = insertCircleAndSession(db, alex.id, new Date(now - DAY_MS));
    for (const u of [alex, priya, jordan]) rsvpIn(db, sessionId, u.id, new Date(now - 2 * DAY_MS));

    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: alex.id,
      teamA: [alex.id, priya.id],
      teamB: [jordan.id, sub.id],
      sets: [{ a: 6, b: 3 }],
    });
    await store.confirmMatch(matchId, jordan.id);

    expect(await showUpOf(sub.id)).toBe(0);
  });

  it("does not credit a show-up for a match that never reaches verified (still pending, or disputed)", async () => {
    const alex = insertUser(db, "pv-a@example.com", "Alex");
    const priya = insertUser(db, "pv-p@example.com", "Priya");
    const jordan = insertUser(db, "pv-j@example.com", "Jordan");
    const kwame = insertUser(db, "pv-k@example.com", "Kwame");
    const now = Date.now();
    const sessionId = insertCircleAndSession(db, alex.id, new Date(now - DAY_MS));
    for (const u of [alex, priya, jordan, kwame]) rsvpIn(db, sessionId, u.id, new Date(now - 2 * DAY_MS));

    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: alex.id,
      teamA: [alex.id, priya.id],
      teamB: [jordan.id, kwame.id],
      sets: [{ a: 6, b: 3 }],
    });
    // Disputed before both teams confirmed — no seal, so no show-up moves.
    await store.disputeMatch(matchId, jordan.id);

    for (const u of [alex, priya, jordan, kwame]) expect(await showUpOf(u.id)).toBe(0);
  });

  it("re-verification (double / teammate re-confirm) never double-credits a show-up", async () => {
    const alex = insertUser(db, "dc-a@example.com", "Alex");
    const priya = insertUser(db, "dc-p@example.com", "Priya");
    const jordan = insertUser(db, "dc-j@example.com", "Jordan");
    const kwame = insertUser(db, "dc-k@example.com", "Kwame");
    const now = Date.now();
    const sessionId = insertCircleAndSession(db, alex.id, new Date(now - DAY_MS));
    for (const u of [alex, priya, jordan, kwame]) rsvpIn(db, sessionId, u.id, new Date(now - 2 * DAY_MS));

    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: alex.id,
      teamA: [alex.id, priya.id],
      teamB: [jordan.id, kwame.id],
      sets: [{ a: 6, b: 3 }],
    });
    expect((await store.confirmMatch(matchId, jordan.id)).status).toBe("verified");

    // The other member of the already-confirmed team, then a repeat by the
    // same user — both must be no-ops that leave showUp untouched.
    await store.confirmMatch(matchId, kwame.id);
    await store.confirmMatch(matchId, jordan.id);

    for (const u of [alex, priya, jordan, kwame]) expect(await showUpOf(u.id)).toBe(1);
  });

  it("credits show-ups even for a skipped (retired, zero-games) verified match — the players still turned up", async () => {
    const alex = insertUser(db, "rt-a@example.com", "Alex");
    const priya = insertUser(db, "rt-p@example.com", "Priya");
    const jordan = insertUser(db, "rt-j@example.com", "Jordan");
    const kwame = insertUser(db, "rt-k@example.com", "Kwame");
    const now = Date.now();
    const sessionId = insertCircleAndSession(db, alex.id, new Date(now - DAY_MS));
    for (const u of [alex, priya, jordan, kwame]) rsvpIn(db, sessionId, u.id, new Date(now - 2 * DAY_MS));

    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: alex.id,
      teamA: [alex.id, priya.id],
      teamB: [jordan.id, kwame.id],
      sets: [],
      outcome: "retired",
    });
    const outcome = await store.confirmMatch(matchId, jordan.id);
    expect(outcome.status).toBe("verified");

    // Glass moved no one (see the retired-zero-games test above), but everyone
    // who RSVP'd in and showed up is still credited a show-up.
    const events = await db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId));
    expect(events).toHaveLength(0);
    for (const u of [alex, priya, jordan, kwame]) expect(await showUpOf(u.id)).toBe(1);
  });
});

describe("realtime — match events", () => {
  let store: MatchesStore;
  let db: CuatroDb;

  beforeEach(() => {
    store = createMatchesStore(":memory:");
    db = store.db;
  });

  afterEach(() => {
    store.close();
    __setRealtimeSenderForTests(null);
  });

  function capture() {
    const calls: { topic: string; type: string; fields: Record<string, unknown> }[] = [];
    __setRealtimeSenderForTests(async (topic, type, fields) => {
      calls.push({ topic, type, fields });
    });
    return calls;
  }

  function insertCircleAndSessionWithId(startsAt: Date, createdBy: { id: string }) {
    const circle = db
      .insert(circles)
      .values({ name: "Test Circle", inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy: createdBy.id })
      .returning()
      .get();
    const session = db.insert(sessions).values({ circleId: circle.id, startsAt, status: "played" }).returning().get();
    return { circleId: circle.id, sessionId: session.id };
  }

  it("recordMatch broadcasts 'match' (recorded) to the session, its circle, and all four players", async () => {
    const a = insertUser(db, "ra@example.com", "RA");
    const b = insertUser(db, "rb@example.com", "RB");
    const c = insertUser(db, "rc@example.com", "RC");
    const d = insertUser(db, "rd@example.com", "RD");
    const { circleId, sessionId } = insertCircleAndSessionWithId(new Date(Date.now() - DAY_MS), a);

    const calls = capture();
    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: a.id,
      teamA: [a.id, b.id],
      teamB: [c.id, d.id],
      sets: [{ a: 6, b: 2 }],
    });

    const matchCalls = calls.filter((call) => call.type === "match");
    expect(matchCalls.every((call) => call.fields.matchId === matchId && call.fields.status === "recorded")).toBe(true);
    const topics = matchCalls.map((call) => call.topic).sort();
    expect(topics).toEqual(
      [sessionChannel(sessionId), circleChannel(circleId), userChannel(a.id), userChannel(b.id), userChannel(c.id), userChannel(d.id)].sort(),
    );
  });

  it("confirmMatch broadcasts 'match' with the resulting status, only on an actual state change", async () => {
    const a = insertUser(db, "ca@example.com", "CA");
    const b = insertUser(db, "cb@example.com", "CB");
    const c = insertUser(db, "cc@example.com", "CC");
    const d = insertUser(db, "cd@example.com", "CD");
    const { sessionId } = insertCircleAndSessionWithId(new Date(Date.now() - DAY_MS), a);
    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: a.id,
      teamA: [a.id, b.id],
      teamB: [c.id, d.id],
      sets: [{ a: 6, b: 2 }],
    });

    // The reporter's own teammate re-confirming (team A already auto-confirmed
    // at record time) stays pending_confirmation — only one team has confirmed.
    const firstCalls = capture();
    await store.confirmMatch(matchId, b.id);
    expect(firstCalls.filter((call) => call.type === "match" && call.fields.status === "pending_confirmation")).not.toHaveLength(0);

    // Second confirm (the other player on that same team, still same team) finalises it.
    const secondCalls = capture();
    const outcome = await store.confirmMatch(matchId, d.id);
    expect(outcome.status).toBe("verified");
    expect(secondCalls.filter((call) => call.type === "match" && call.fields.status === "verified")).not.toHaveLength(0);

    // A third, now-redundant confirm from an already-confirmed team is a no-op — nothing to broadcast.
    const thirdCalls = capture();
    await store.confirmMatch(matchId, c.id);
    expect(thirdCalls).toHaveLength(0);
  });

  it("disputeMatch broadcasts 'match' (disputed) once, not on a repeat dispute call", async () => {
    const a = insertUser(db, "da@example.com", "DA");
    const b = insertUser(db, "db@example.com", "DB");
    const c = insertUser(db, "dc@example.com", "DC");
    const d = insertUser(db, "dd@example.com", "DD");
    const { sessionId } = insertCircleAndSessionWithId(new Date(Date.now() - DAY_MS), a);
    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: a.id,
      teamA: [a.id, b.id],
      teamB: [c.id, d.id],
      sets: [{ a: 6, b: 2 }],
    });

    const calls = capture();
    await store.disputeMatch(matchId, c.id);
    expect(calls.filter((call) => call.type === "match" && call.fields.status === "disputed")).not.toHaveLength(0);

    const repeatCalls = capture();
    await store.disputeMatch(matchId, c.id);
    expect(repeatCalls).toHaveLength(0);
  });
});
