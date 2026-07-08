import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createClient,
  circleMembers,
  circles,
  matches,
  notifications,
  ratingEvents,
  rsvps,
  sessions,
  standingGames,
  users,
  type CuatroClient,
  type CuatroDb,
  type RatingEventFactors,
} from "@cuatro/db";
import {
  checkFourthCallLevel2,
  claimFourthCallSlot,
  hasFourthCallInvite,
  FOURTH_CALL_LEVEL2_CAP,
  FOURTH_CALL_LEVEL2_DELAY_MS,
} from "@/server/fourth-call";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";
import { circleChannel, sessionChannel } from "@/lib/realtime/channels";

let client: CuatroClient;
let db: CuatroDb;
let n = 0;

beforeEach(() => {
  client = createClient(":memory:");
  db = client.db;
  n = 0;
});

afterEach(() => {
  client.close();
  __setRealtimeSenderForTests(null);
});

function seedUser(opts: { rating?: number | null; countryCode?: string } = {}) {
  n += 1;
  return db
    .insert(users)
    .values({
      email: `u${n}@example.com`,
      displayName: `User ${n}`,
      rating: opts.rating ?? null,
      confidence: opts.rating != null ? 0.5 : 0,
      verifiedMatchCount: opts.rating != null ? 5 : 0,
      countryCode: opts.countryCode ?? "GB",
    })
    .returning()
    .get();
}

function seedCircle(createdBy: string, countryCode = "GB") {
  return db
    .insert(circles)
    .values({ name: `Circle ${++n}`, inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy, countryCode })
    .returning()
    .get();
}

function addMember(circleId: string, userId: string, role: "organiser" | "member" = "member") {
  db.insert(circleMembers).values({ circleId, userId, role }).run();
}

function seedSession(circleId: string, opts: { slots?: number; startsAt?: Date; status?: "upcoming" | "played" } = {}) {
  let standingGameId: string | undefined;
  if (opts.slots) {
    const sg = db.insert(standingGames).values({ circleId, weekday: 2, startTime: "20:00", slots: opts.slots }).returning().get();
    standingGameId = sg.id;
  }
  return db
    .insert(sessions)
    .values({
      circleId,
      standingGameId,
      startsAt: opts.startsAt ?? new Date("2026-08-04T20:00:00.000Z"),
      status: opts.status ?? "upcoming",
    })
    .returning()
    .get();
}

function rsvpConfirmed(sessionId: string, userId: string) {
  db.insert(rsvps).values({ sessionId, userId, status: "in" }).run();
}

const factors: RatingEventFactors = {
  expectedWin: 0.5,
  marginMultiplier: 1,
  echoDampingMultiplier: 1,
  kFactor: 0.04,
  opponentUserIds: [],
  isFirstMeeting: true,
};

/** A verified match linking teamA's two ids as opponents of teamB's two ids (and vice versa), for opponent-history candidates. */
function seedOpponentHistory(historySessionId: string, teamA: [string, string], teamB: [string, string]) {
  const match = db
    .insert(matches)
    .values({
      sessionId: historySessionId,
      teamAPlayer1Id: teamA[0],
      teamAPlayer2Id: teamA[1],
      teamBPlayer1Id: teamB[0],
      teamBPlayer2Id: teamB[1],
      score: [{ a: 6, b: 3 }],
      status: "verified",
      playedAt: new Date("2026-07-01T18:00:00.000Z"),
    })
    .returning()
    .get();

  for (const id of teamA) {
    db.insert(ratingEvents)
      .values({ userId: id, matchId: match.id, delta: 0.02, ratingAfter: 4, confidenceBefore: 0.4, confidenceAfter: 0.48, factors: { ...factors, opponentUserIds: [...teamB] }, explanation: "x" })
      .run();
  }
  for (const id of teamB) {
    db.insert(ratingEvents)
      .values({ userId: id, matchId: match.id, delta: -0.02, ratingAfter: 4, confidenceBefore: 0.4, confidenceAfter: 0.48, factors: { ...factors, opponentUserIds: [...teamA] }, explanation: "x" })
      .run();
  }
}

function seedFourthCallNotification(userId: string, sessionId: string, level: 1 | 2, createdAt?: Date) {
  const row = db.insert(notifications).values({ userId, type: "fourth_call", payload: { sessionId, level } }).returning().get();
  if (createdAt) db.update(notifications).set({ createdAt }).where(eq(notifications.id, row.id)).run();
  return row;
}

describe("checkFourthCallLevel2 — candidate selection", () => {
  it("applies every rule together: shared-circle, opponent-history, rating band, unrated exception, own-circle exclusion, country", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id); // the session's own circle
    addMember(circleA.id, organiser.id, "organiser");

    const p1 = seedUser({ rating: 4.0 });
    const p2 = seedUser({ rating: 4.2 }); // slot-holder average = 4.1
    addMember(circleA.id, p1.id);
    addMember(circleA.id, p2.id);

    const session = seedSession(circleA.id, { slots: 4 });
    rsvpConfirmed(session.id, p1.id);
    rsvpConfirmed(session.id, p2.id);
    // Realistic level-1 baseline: every circle-A member who hasn't responded
    // already got a level-1 fourth_call — the organiser included. c7 below
    // is the deliberate exception (someone who slipped through it).
    seedFourthCallNotification(organiser.id, session.id, 1);

    const circleB = seedCircle(organiser.id);
    addMember(circleB.id, p1.id); // p1's OTHER circle — the "extended network"

    const c1InBand = seedUser({ rating: 4.3 }); // distance 0.2 — via shared circle B
    addMember(circleB.id, c1InBand.id);

    const c2OutOfBand = seedUser({ rating: 5.0 }); // distance 0.9 — via shared circle B, but too far
    addMember(circleB.id, c2OutOfBand.id);

    const c3Unrated = seedUser({ rating: null }); // shares circle B — the unrated exception applies
    addMember(circleB.id, c3Unrated.id);

    const historySession = seedSession(circleB.id, { status: "played" });
    const filler1 = seedUser({ rating: 3.9 });
    const c4UnratedNoCircle = seedUser({ rating: null }); // opponent-history only, unrated — excluded
    const extraOpp1 = seedUser({ rating: 20 }); // teammate of c4 in the match — out of band, must be excluded
    seedOpponentHistory(historySession.id, [p1.id, filler1.id], [c4UnratedNoCircle.id, extraOpp1.id]);

    const filler2 = seedUser({ rating: 4.1 });
    const c5ViaHistory = seedUser({ rating: 4.4 }); // distance 0.3 — opponent-history only, no shared circle
    const extraOpp2 = seedUser({ rating: 20 }); // teammate of c5 in the match — out of band, must be excluded
    seedOpponentHistory(historySession.id, [p2.id, filler2.id], [c5ViaHistory.id, extraOpp2.id]);

    const c6AlreadyNotified = seedUser({ rating: 4.05 }); // circle-A member, already sent a level-1 fourth_call — excluded
    addMember(circleA.id, c6AlreadyNotified.id);
    seedFourthCallNotification(c6AlreadyNotified.id, session.id, 1);

    const c7NotYetNotified = seedUser({ rating: 4.0 }); // circle-A member, but slipped through level 1 — still eligible
    addMember(circleA.id, c7NotYetNotified.id);

    const c8WrongCountry = seedUser({ rating: 4.3, countryCode: "ES" }); // otherwise identical to c1
    addMember(circleB.id, c8WrongCountry.id);

    const result = checkFourthCallLevel2(db, session.id, new Date("2026-08-04T18:00:00.000Z"), { forceEscalate: true });

    expect(result.fired).toBe(true);
    if (!result.fired) throw new Error("unreachable");
    // Closest rating first: c7 (0.10), c1 (0.20), c5 (0.30), then the unrated c3 last.
    expect(result.notifiedUserIds).toEqual([c7NotYetNotified.id, c1InBand.id, c5ViaHistory.id, c3Unrated.id]);
    expect(result.notifiedUserIds).not.toContain(c2OutOfBand.id);
    expect(result.notifiedUserIds).not.toContain(c4UnratedNoCircle.id);
    expect(result.notifiedUserIds).not.toContain(c6AlreadyNotified.id);
    expect(result.notifiedUserIds).not.toContain(c8WrongCountry.id);

    const written = db.select().from(notifications).where(eq(notifications.type, "fourth_call")).all();
    const level2Written = written.filter((r) => (r.payload as { level: number }).level === 2);
    expect(level2Written.map((r) => r.userId).sort()).toEqual([...result.notifiedUserIds].sort());
  });

  it("caps at 12 candidates even when more qualify", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const p1 = seedUser({ rating: 4.0 });
    const p2 = seedUser({ rating: 4.0 });
    addMember(circleA.id, p1.id);
    addMember(circleA.id, p2.id);
    const session = seedSession(circleA.id, { slots: 4 });
    rsvpConfirmed(session.id, p1.id);
    rsvpConfirmed(session.id, p2.id);

    const circleB = seedCircle(organiser.id);
    addMember(circleB.id, p1.id);
    const candidates = Array.from({ length: 15 }, (_, i) => {
      const u = seedUser({ rating: 4.0 + (i + 1) * 0.01 }); // distances 0.01, 0.02, ... 0.15 — all within ±0.5
      addMember(circleB.id, u.id);
      return u;
    });

    const result = checkFourthCallLevel2(db, session.id, new Date("2026-08-04T18:00:00.000Z"), { forceEscalate: true });

    expect(result.fired).toBe(true);
    if (!result.fired) throw new Error("unreachable");
    expect(result.notifiedUserIds).toHaveLength(FOURTH_CALL_LEVEL2_CAP);
    // Closest 12 of the 15 (the last 3, furthest away, are dropped).
    expect(result.notifiedUserIds).toEqual(candidates.slice(0, 12).map((c) => c.id));
  });

  it("won't fire before the 20-minute delay unless the organiser escalates", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const p1 = seedUser({ rating: 4 });
    addMember(circleA.id, p1.id);
    const session = seedSession(circleA.id, { slots: 4 });
    rsvpConfirmed(session.id, p1.id);

    const level1FiredAt = new Date("2026-08-04T18:00:00.000Z");
    seedFourthCallNotification(p1.id, session.id, 1, level1FiredAt); // stand-in "level 1 has fired" marker

    const tooSoon = checkFourthCallLevel2(db, session.id, new Date(level1FiredAt.getTime() + FOURTH_CALL_LEVEL2_DELAY_MS - 1000));
    expect(tooSoon).toEqual({ fired: false, reason: "not_yet" });

    const halfway = checkFourthCallLevel2(db, session.id, new Date(level1FiredAt.getTime() + 10 * 60 * 1000));
    // still "not_yet" since only 10 of the 20 minutes have passed
    expect(halfway.fired).toBe(false);
  });

  it("never nags twice: a second check after firing is a no-op, even across repeat views", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const p1 = seedUser({ rating: 4 });
    addMember(circleA.id, p1.id);
    const session = seedSession(circleA.id, { slots: 4 });
    rsvpConfirmed(session.id, p1.id);

    const circleB = seedCircle(organiser.id);
    addMember(circleB.id, p1.id);
    const candidate = seedUser({ rating: 4.1 });
    addMember(circleB.id, candidate.id);

    const first = checkFourthCallLevel2(db, session.id, new Date("2026-08-04T18:00:00.000Z"), { forceEscalate: true });
    expect(first.fired).toBe(true);

    const second = checkFourthCallLevel2(db, session.id, new Date("2026-08-04T18:05:00.000Z"), { forceEscalate: true });
    expect(second).toEqual({ fired: false, reason: "already_notified" });

    const allFourthCalls = db.select().from(notifications).where(eq(notifications.type, "fourth_call")).all();
    expect(allFourthCalls.filter((r) => r.userId === candidate.id)).toHaveLength(1);
  });

  it("declines to fire once the session is already full", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const p1 = seedUser({ rating: 4 });
    const p2 = seedUser({ rating: 4 });
    addMember(circleA.id, p1.id);
    addMember(circleA.id, p2.id);
    const session = seedSession(circleA.id, { slots: 2 });
    rsvpConfirmed(session.id, p1.id);
    rsvpConfirmed(session.id, p2.id);

    const result = checkFourthCallLevel2(db, session.id, new Date(), { forceEscalate: true });
    expect(result).toEqual({ fired: false, reason: "already_full" });
  });
});

describe("claimFourthCallSlot", () => {
  it("lets an invited non-member fill an open slot without joining the circle", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const p1 = seedUser({ rating: 4 });
    addMember(circleA.id, p1.id);
    const session = seedSession(circleA.id, { slots: 4 });
    rsvpConfirmed(session.id, p1.id);

    const invitee = seedUser({ rating: 4.1 });
    seedFourthCallNotification(invitee.id, session.id, 2);

    const outcome = claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));

    expect(outcome).toEqual({ ok: true, status: "in", alreadyIn: false });
    const [rsvp] = db.select().from(rsvps).where(eq(rsvps.userId, invitee.id)).all();
    expect(rsvp?.status).toBe("in");
    const membership = db
      .select()
      .from(circleMembers)
      .where(eq(circleMembers.userId, invitee.id))
      .all();
    expect(membership).toHaveLength(0); // claiming does NOT enrol them in the circle
  });

  it("rejects a claim with no matching fourth_call invite", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const session = seedSession(circleA.id, { slots: 4 });
    const stranger = seedUser();

    const outcome = claimFourthCallSlot(db, session.id, stranger.id);
    expect(outcome).toEqual({ ok: false, error: "no_fourth_call_invite" });
  });

  it("is idempotent — claiming twice returns alreadyIn on the second call", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const session = seedSession(circleA.id, { slots: 4 });
    const invitee = seedUser();
    seedFourthCallNotification(invitee.id, session.id, 2);

    claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));
    const second = claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));

    expect(second).toEqual({ ok: true, status: "in", alreadyIn: true });
  });

  it("rejects a claim once the session is already full", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const p1 = seedUser();
    const p2 = seedUser();
    addMember(circleA.id, p1.id);
    addMember(circleA.id, p2.id);
    const session = seedSession(circleA.id, { slots: 2 });
    rsvpConfirmed(session.id, p1.id);
    rsvpConfirmed(session.id, p2.id);

    const invitee = seedUser();
    seedFourthCallNotification(invitee.id, session.id, 2);

    const outcome = claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));
    expect(outcome).toEqual({ ok: false, error: "already_full" });
  });

  it("fires game_filled notifications for the whole four once a claim completes the last slot", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const p1 = seedUser();
    addMember(circleA.id, p1.id);
    const session = seedSession(circleA.id, { slots: 2 });
    rsvpConfirmed(session.id, p1.id);

    const invitee = seedUser();
    seedFourthCallNotification(invitee.id, session.id, 2);

    claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));

    const filledNotifs = db.select().from(notifications).where(eq(notifications.type, "game_filled")).all();
    expect(filledNotifs.map((n) => n.userId).sort()).toEqual([p1.id, invitee.id].sort());
  });
});

describe("hasFourthCallInvite", () => {
  it("is true once a fourth_call notification (any level) exists for that user/session", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const session = seedSession(circleA.id, { slots: 4 });
    const invitee = seedUser();

    expect(hasFourthCallInvite(db, session.id, invitee.id)).toBe(false);
    seedFourthCallNotification(invitee.id, session.id, 2);
    expect(hasFourthCallInvite(db, session.id, invitee.id)).toBe(true);
  });

  it("is scoped per session — an invite for a different session doesn't count", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const sessionA = seedSession(circleA.id, { slots: 4 });
    const sessionB = seedSession(circleA.id, { slots: 4, startsAt: new Date("2026-09-01T18:00:00.000Z") });
    const invitee = seedUser();
    seedFourthCallNotification(invitee.id, sessionA.id, 1);

    expect(hasFourthCallInvite(db, sessionB.id, invitee.id)).toBe(false);
  });
});

describe("realtime — fourth_call and rsvp events", () => {
  function capture() {
    const calls: { topic: string; type: string; fields: Record<string, unknown> }[] = [];
    __setRealtimeSenderForTests(async (topic, type, fields) => {
      calls.push({ topic, type, fields });
    });
    return calls;
  }

  it("checkFourthCallLevel2 broadcasts 'fourth_call' (level 2) to session and circle only when it fires", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const p1 = seedUser({ rating: 4 });
    addMember(circleA.id, p1.id);
    const session = seedSession(circleA.id, { slots: 4 });
    rsvpConfirmed(session.id, p1.id);

    const circleB = seedCircle(organiser.id);
    addMember(circleB.id, p1.id);
    const candidate = seedUser({ rating: 4.1 });
    addMember(circleB.id, candidate.id);

    const calls = capture();
    const result = checkFourthCallLevel2(db, session.id, new Date("2026-08-04T18:00:00.000Z"), { forceEscalate: true });
    expect(result.fired).toBe(true);

    const fourthCallCalls = calls.filter((c) => c.type === "fourth_call");
    expect(fourthCallCalls).toHaveLength(2);
    expect(fourthCallCalls.map((c) => c.topic).sort()).toEqual(
      [sessionChannel(session.id), circleChannel(circleA.id)].sort(),
    );
    expect(fourthCallCalls.every((c) => c.fields.level === 2)).toBe(true);
  });

  it("does not broadcast when checkFourthCallLevel2 declines to fire", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const p1 = seedUser();
    const p2 = seedUser();
    addMember(circleA.id, p1.id);
    addMember(circleA.id, p2.id);
    const session = seedSession(circleA.id, { slots: 2 });
    rsvpConfirmed(session.id, p1.id);
    rsvpConfirmed(session.id, p2.id);

    const calls = capture();
    const result = checkFourthCallLevel2(db, session.id, new Date(), { forceEscalate: true });
    expect(result).toEqual({ fired: false, reason: "already_full" });
    expect(calls).toHaveLength(0);
  });

  it("claimFourthCallSlot broadcasts 'fourth_call' (claimed) and 'rsvp' to session and circle", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const p1 = seedUser();
    addMember(circleA.id, p1.id);
    const session = seedSession(circleA.id, { slots: 4 });
    rsvpConfirmed(session.id, p1.id);
    const invitee = seedUser();
    seedFourthCallNotification(invitee.id, session.id, 2);

    const calls = capture();
    const outcome = claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));
    expect(outcome).toEqual({ ok: true, status: "in", alreadyIn: false });

    const claimedCalls = calls.filter((c) => c.type === "fourth_call" && c.fields.claimed === true);
    const rsvpCalls = calls.filter((c) => c.type === "rsvp");
    expect(claimedCalls).toHaveLength(2);
    expect(rsvpCalls).toHaveLength(2);
    expect(claimedCalls.map((c) => c.topic).sort()).toEqual(
      [sessionChannel(session.id), circleChannel(circleA.id)].sort(),
    );
  });

  it("a second (already-in) claim does not re-broadcast", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const session = seedSession(circleA.id, { slots: 4 });
    const invitee = seedUser();
    seedFourthCallNotification(invitee.id, session.id, 2);
    claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));

    const calls = capture();
    const second = claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));
    expect(second).toEqual({ ok: true, status: "in", alreadyIn: true });
    expect(calls).toHaveLength(0);
  });
});
