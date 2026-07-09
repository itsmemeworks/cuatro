import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createClient,
  circleMembers,
  circles,
  notifications,
  rsvps,
  sessions,
  standingGames,
  users,
  type CuatroClient,
  type CuatroDb,
} from "@cuatro/db";
import {
  claimFourthCallSlot,
  findFourthCallClaimant,
  getRing3ClaimLink,
  hasFourthCallInvite,
  signRing3Token,
  verifyRing3Token,
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

function seedFourthCallNotification(userId: string, sessionId: string, level: 1 | 2, createdAt?: Date) {
  const row = db.insert(notifications).values({ userId, type: "fourth_call", payload: { sessionId, level } }).returning().get();
  if (createdAt) db.update(notifications).set({ createdAt }).where(eq(notifications.id, row.id)).run();
  return row;
}

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

  it("records source: 'fourth_call' on the rsvps row for both a fresh claim and a re-claim of an existing row", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const p1 = seedUser();
    addMember(circleA.id, p1.id);
    const session = seedSession(circleA.id, { slots: 4 });
    rsvpConfirmed(session.id, p1.id);

    const invitee = seedUser();
    seedFourthCallNotification(invitee.id, session.id, 2);
    claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));

    const [freshRow] = db.select().from(rsvps).where(eq(rsvps.userId, invitee.id)).all();
    expect(freshRow?.source).toBe("fourth_call");

    // Drop out, then re-claim through Fourth Call again — the update path
    // (existing row) must also record source: "fourth_call", not just the
    // insert path.
    db.update(rsvps).set({ status: "out" }).where(eq(rsvps.id, freshRow!.id)).run();
    claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));
    const [reclaimedRow] = db.select().from(rsvps).where(eq(rsvps.userId, invitee.id)).all();
    expect(reclaimedRow?.source).toBe("fourth_call");
  });
});

describe("findFourthCallClaimant", () => {
  it("returns null when every confirmed slot was filled the ordinary way", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const p1 = seedUser();
    addMember(circleA.id, p1.id);
    const session = seedSession(circleA.id, { slots: 4 });
    rsvpConfirmed(session.id, p1.id); // ordinary rsvpConfirmed test helper — source defaults to "rsvp"

    expect(findFourthCallClaimant(db, session.id)).toBeNull();
  });

  it("returns the userId of whoever claimed the slot via Fourth Call", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const p1 = seedUser();
    addMember(circleA.id, p1.id);
    const session = seedSession(circleA.id, { slots: 4 });
    rsvpConfirmed(session.id, p1.id);

    const invitee = seedUser();
    seedFourthCallNotification(invitee.id, session.id, 2);
    claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));

    expect(findFourthCallClaimant(db, session.id)).toBe(invitee.id);
  });

  it("is not fooled by a circle member who merely holds a stale fourth_call notification but never claimed through it", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const p1 = seedUser();
    addMember(circleA.id, p1.id);
    const session = seedSession(circleA.id, { slots: 4 });
    // p1 RSVPs the ordinary way despite also holding a (level-1) invite.
    seedFourthCallNotification(p1.id, session.id, 1);
    rsvpConfirmed(session.id, p1.id);

    expect(findFourthCallClaimant(db, session.id)).toBeNull();
  });
});

describe("Ring 3 — signed public claim link", () => {
  const SECRET = "test-secret";
  const OTHER_SECRET = "different-secret";

  it("round-trips a valid, unexpired token", () => {
    const expiresAt = new Date("2026-08-04T20:00:00.000Z");
    const token = signRing3Token("session-123", expiresAt, SECRET);
    const now = new Date("2026-08-04T19:00:00.000Z"); // before expiry

    expect(verifyRing3Token(token, SECRET, now)).toEqual({ sessionId: "session-123" });
  });

  it("rejects an expired token", () => {
    const expiresAt = new Date("2026-08-04T20:00:00.000Z");
    const token = signRing3Token("session-123", expiresAt, SECRET);
    const now = new Date("2026-08-04T20:00:00.001Z"); // 1ms past expiry

    expect(verifyRing3Token(token, SECRET, now)).toBeNull();
  });

  it("accepts a token at exactly its expiry instant", () => {
    const expiresAt = new Date("2026-08-04T20:00:00.000Z");
    const token = signRing3Token("session-123", expiresAt, SECRET);

    expect(verifyRing3Token(token, SECRET, expiresAt)).toEqual({ sessionId: "session-123" });
  });

  it("rejects a token verified with the wrong secret", () => {
    const token = signRing3Token("session-123", new Date("2026-08-04T20:00:00.000Z"), SECRET);
    expect(verifyRing3Token(token, OTHER_SECRET, new Date("2026-08-04T19:00:00.000Z"))).toBeNull();
  });

  it("rejects a tampered payload (sessionId swapped after signing)", () => {
    const token = signRing3Token("session-123", new Date("2026-08-04T20:00:00.000Z"), SECRET);
    const [payloadB64, sig] = token.split(".");
    const forgedPayload = Buffer.from("session-456.1785000000000", "utf8").toString("base64url");
    const tampered = `${forgedPayload}.${sig}`;

    expect(tampered).not.toBe(token);
    expect(payloadB64).toBeTruthy();
    expect(verifyRing3Token(tampered, SECRET, new Date("2026-08-04T19:00:00.000Z"))).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = signRing3Token("session-123", new Date("2026-08-04T20:00:00.000Z"), SECRET);
    const [payloadB64] = token.split(".");
    const tampered = `${payloadB64}.not-a-real-signature`;

    expect(verifyRing3Token(tampered, SECRET, new Date("2026-08-04T19:00:00.000Z"))).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifyRing3Token("garbage", SECRET)).toBeNull();
    expect(verifyRing3Token("a.b.c", SECRET)).toBeNull();
    expect(verifyRing3Token("", SECRET)).toBeNull();
  });

  it("getRing3ClaimLink mints a link for an upcoming, not-yet-started session", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const session = seedSession(circleA.id, { slots: 4, startsAt: new Date("2026-08-04T20:00:00.000Z") });

    const result = getRing3ClaimLink(db, session.id, new Date("2026-08-04T18:00:00.000Z"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.path).toBe(`/fc/${result.value.token}`);
    expect(result.value.expiresAt).toEqual(session.startsAt);
  });

  it("getRing3ClaimLink is idempotent — repeat calls mint the identical token", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const session = seedSession(circleA.id, { slots: 4, startsAt: new Date("2026-08-04T20:00:00.000Z") });

    const first = getRing3ClaimLink(db, session.id, new Date("2026-08-04T18:00:00.000Z"));
    const second = getRing3ClaimLink(db, session.id, new Date("2026-08-04T18:30:00.000Z"));
    if (!first.ok || !second.ok) throw new Error("unreachable");
    expect(second.value.token).toBe(first.value.token);
  });

  it("getRing3ClaimLink errors for an unknown session", () => {
    const result = getRing3ClaimLink(db, "no-such-session");
    expect(result).toEqual({ ok: false, error: "session_not_found" });
  });

  it("getRing3ClaimLink errors once the session has started", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const session = seedSession(circleA.id, { slots: 4, startsAt: new Date("2026-08-04T20:00:00.000Z") });

    const result = getRing3ClaimLink(db, session.id, new Date("2026-08-04T20:00:00.000Z"));
    expect(result).toEqual({ ok: false, error: "session_started" });
  });

  it("claimFourthCallSlot accepts a valid ring-3 token in lieu of a fourth_call notification", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const p1 = seedUser();
    addMember(circleA.id, p1.id);
    const session = seedSession(circleA.id, { slots: 4, startsAt: new Date("2026-08-04T20:00:00.000Z") });
    rsvpConfirmed(session.id, p1.id);

    const linkResult = getRing3ClaimLink(db, session.id, new Date("2026-08-04T18:00:00.000Z"));
    if (!linkResult.ok) throw new Error("unreachable");

    const stranger = seedUser(); // holds no fourth_call notification at all
    const outcome = claimFourthCallSlot(db, session.id, stranger.id, new Date("2026-08-04T18:05:00.000Z"), {
      ring3Token: linkResult.value.token,
    });

    expect(outcome).toEqual({ ok: true, status: "in", alreadyIn: false });
    const [row] = db.select().from(rsvps).where(eq(rsvps.userId, stranger.id)).all();
    expect(row?.source).toBe("fourth_call");
    expect(findFourthCallClaimant(db, session.id)).toBe(stranger.id);
  });

  it("claimFourthCallSlot rejects a ring-3 token minted for a different session", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const sessionA = seedSession(circleA.id, { slots: 4, startsAt: new Date("2026-08-04T20:00:00.000Z") });
    const sessionB = seedSession(circleA.id, { slots: 4, startsAt: new Date("2026-08-05T20:00:00.000Z") });

    const linkForA = getRing3ClaimLink(db, sessionA.id, new Date("2026-08-04T18:00:00.000Z"));
    if (!linkForA.ok) throw new Error("unreachable");

    const stranger = seedUser();
    const outcome = claimFourthCallSlot(db, sessionB.id, stranger.id, new Date("2026-08-04T18:05:00.000Z"), {
      ring3Token: linkForA.value.token,
    });

    expect(outcome).toEqual({ ok: false, error: "no_fourth_call_invite" });
  });

  it("claimFourthCallSlot rejects an expired ring-3 token (session already started)", () => {
    const organiser = seedUser();
    const circleA = seedCircle(organiser.id);
    const session = seedSession(circleA.id, { slots: 4, startsAt: new Date("2026-08-04T20:00:00.000Z") });

    const linkResult = getRing3ClaimLink(db, session.id, new Date("2026-08-04T18:00:00.000Z"));
    if (!linkResult.ok) throw new Error("unreachable");

    const stranger = seedUser();
    // Past the session's kickoff — the token's own embedded expiry (=
    // session.startsAt) has passed, independent of the session_started
    // check that would also catch this.
    const outcome = claimFourthCallSlot(db, session.id, stranger.id, new Date("2026-08-04T20:00:01.000Z"), {
      ring3Token: linkResult.value.token,
    });

    expect(outcome).toEqual({ ok: false, error: "no_fourth_call_invite" });
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
