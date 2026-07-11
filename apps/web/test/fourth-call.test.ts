import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestClient,
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
  setFourthCallSideHint,
  signRing3Token,
  verifyRing3Token,
} from "@/server/fourth-call";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";
import { circleChannel, sessionChannel } from "@/lib/realtime/channels";

let client: CuatroClient;
let db: CuatroDb;
let n = 0;

beforeEach(async () => {
  client = await createTestClient();
  db = client.db;
  n = 0;
});

afterEach(async () => {
  await client.close();
  __setRealtimeSenderForTests(null);
});

async function seedUser(opts: { rating?: number | null; countryCode?: string } = {}) {
  n += 1;
  const [row] = await db
    .insert(users)
    .values({
      email: `u${n}@example.com`,
      displayName: `User ${n}`,
      rating: opts.rating ?? null,
      confidence: opts.rating != null ? 0.5 : 0,
      verifiedMatchCount: opts.rating != null ? 5 : 0,
      countryCode: opts.countryCode ?? "GB",
    })
    .returning();
  return row;
}

async function seedCircle(createdBy: string, countryCode = "GB") {
  const [row] = await db
    .insert(circles)
    .values({ name: `Circle ${++n}`, inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy, countryCode })
    .returning();
  return row;
}

async function addMember(circleId: string, userId: string, role: "organiser" | "member" = "member") {
  await db.insert(circleMembers).values({ circleId, userId, role });
}

async function seedSession(circleId: string, opts: { slots?: number; startsAt?: Date; status?: "upcoming" | "played" } = {}) {
  let standingGameId: string | undefined;
  if (opts.slots) {
    const [sg] = await db.insert(standingGames).values({ circleId, weekday: 2, startTime: "20:00", slots: opts.slots }).returning();
    standingGameId = sg.id;
  }
  const [row] = await db
    .insert(sessions)
    .values({
      circleId,
      standingGameId,
      startsAt: (opts.startsAt ?? new Date("2026-08-04T20:00:00.000Z")).getTime(),
      status: opts.status ?? "upcoming",
    })
    .returning();
  return row;
}

async function rsvpConfirmed(sessionId: string, userId: string) {
  await db.insert(rsvps).values({ sessionId, userId, status: "in" });
}

async function seedFourthCallNotification(userId: string, sessionId: string, level: 1 | 2, createdAt?: Date) {
  const [row] = await db.insert(notifications).values({ userId, type: "fourth_call", payload: { sessionId, level } }).returning();
  if (createdAt) await db.update(notifications).set({ createdAt: createdAt.getTime() }).where(eq(notifications.id, row.id));
  return row;
}

describe("claimFourthCallSlot", () => {
  it("lets an invited non-member fill an open slot without joining the circle", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    const p1 = await seedUser({ rating: 4 });
    await addMember(circleA.id, p1.id);
    const session = await seedSession(circleA.id, { slots: 4 });
    await rsvpConfirmed(session.id, p1.id);

    const invitee = await seedUser({ rating: 4.1 });
    await seedFourthCallNotification(invitee.id, session.id, 2);

    const outcome = await claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));

    expect(outcome).toEqual({ ok: true, status: "in", alreadyIn: false });
    const [rsvp] = await db.select().from(rsvps).where(eq(rsvps.userId, invitee.id));
    expect(rsvp?.status).toBe("in");
    const membership = await db
      .select()
      .from(circleMembers)
      .where(eq(circleMembers.userId, invitee.id));
    expect(membership).toHaveLength(0); // claiming does NOT enrol them in the circle
  });

  it("rejects a claim with no matching fourth_call invite", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    const session = await seedSession(circleA.id, { slots: 4 });
    const stranger = await seedUser();

    const outcome = await claimFourthCallSlot(db, session.id, stranger.id);
    expect(outcome).toEqual({ ok: false, error: "no_fourth_call_invite" });
  });

  it("is idempotent — claiming twice returns alreadyIn on the second call", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    const session = await seedSession(circleA.id, { slots: 4 });
    const invitee = await seedUser();
    await seedFourthCallNotification(invitee.id, session.id, 2);

    await claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));
    const second = await claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));

    expect(second).toEqual({ ok: true, status: "in", alreadyIn: true });
  });

  it("rejects a claim once the session is already full", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    const p1 = await seedUser();
    const p2 = await seedUser();
    await addMember(circleA.id, p1.id);
    await addMember(circleA.id, p2.id);
    const session = await seedSession(circleA.id, { slots: 2 });
    await rsvpConfirmed(session.id, p1.id);
    await rsvpConfirmed(session.id, p2.id);

    const invitee = await seedUser();
    await seedFourthCallNotification(invitee.id, session.id, 2);

    const outcome = await claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));
    expect(outcome).toEqual({ ok: false, error: "already_full" });
  });

  it("fires game_filled notifications for the whole four once a claim completes the last slot", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    const p1 = await seedUser();
    await addMember(circleA.id, p1.id);
    const session = await seedSession(circleA.id, { slots: 2 });
    await rsvpConfirmed(session.id, p1.id);

    const invitee = await seedUser();
    await seedFourthCallNotification(invitee.id, session.id, 2);

    await claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));

    const filledNotifs = await db.select().from(notifications).where(eq(notifications.type, "game_filled"));
    expect(filledNotifs.map((n) => n.userId).sort()).toEqual([p1.id, invitee.id].sort());
  });

  it("records source: 'fourth_call' on the rsvps row for both a fresh claim and a re-claim of an existing row", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    const p1 = await seedUser();
    await addMember(circleA.id, p1.id);
    const session = await seedSession(circleA.id, { slots: 4 });
    await rsvpConfirmed(session.id, p1.id);

    const invitee = await seedUser();
    await seedFourthCallNotification(invitee.id, session.id, 2);
    await claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));

    const [freshRow] = await db.select().from(rsvps).where(eq(rsvps.userId, invitee.id));
    expect(freshRow?.source).toBe("fourth_call");

    // Drop out, then re-claim through Fourth Call again — the update path
    // (existing row) must also record source: "fourth_call", not just the
    // insert path.
    await db.update(rsvps).set({ status: "out" }).where(eq(rsvps.id, freshRow!.id));
    await claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));
    const [reclaimedRow] = await db.select().from(rsvps).where(eq(rsvps.userId, invitee.id));
    expect(reclaimedRow?.source).toBe("fourth_call");
  });
});

describe("findFourthCallClaimant", () => {
  it("returns null when every confirmed slot was filled the ordinary way", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    const p1 = await seedUser();
    await addMember(circleA.id, p1.id);
    const session = await seedSession(circleA.id, { slots: 4 });
    await rsvpConfirmed(session.id, p1.id); // ordinary rsvpConfirmed test helper — source defaults to "rsvp"

    expect(await findFourthCallClaimant(db, session.id)).toBeNull();
  });

  it("returns the userId of whoever claimed the slot via Fourth Call", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    const p1 = await seedUser();
    await addMember(circleA.id, p1.id);
    const session = await seedSession(circleA.id, { slots: 4 });
    await rsvpConfirmed(session.id, p1.id);

    const invitee = await seedUser();
    await seedFourthCallNotification(invitee.id, session.id, 2);
    await claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));

    expect(await findFourthCallClaimant(db, session.id)).toBe(invitee.id);
  });

  it("is not fooled by a circle member who merely holds a stale fourth_call notification but never claimed through it", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    const p1 = await seedUser();
    await addMember(circleA.id, p1.id);
    const session = await seedSession(circleA.id, { slots: 4 });
    // p1 RSVPs the ordinary way despite also holding a (level-1) invite.
    await seedFourthCallNotification(p1.id, session.id, 1);
    await rsvpConfirmed(session.id, p1.id);

    expect(await findFourthCallClaimant(db, session.id)).toBeNull();
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

  it("getRing3ClaimLink mints a link for an upcoming, not-yet-started session", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    const session = await seedSession(circleA.id, { slots: 4, startsAt: new Date("2026-08-04T20:00:00.000Z") });

    const result = await getRing3ClaimLink(db, session.id, new Date("2026-08-04T18:00:00.000Z"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.path).toBe(`/fc/${result.value.token}`);
    expect(result.value.expiresAt).toEqual(new Date(session.startsAt));
  });

  it("getRing3ClaimLink is idempotent — repeat calls mint the identical token", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    const session = await seedSession(circleA.id, { slots: 4, startsAt: new Date("2026-08-04T20:00:00.000Z") });

    const first = await getRing3ClaimLink(db, session.id, new Date("2026-08-04T18:00:00.000Z"));
    const second = await getRing3ClaimLink(db, session.id, new Date("2026-08-04T18:30:00.000Z"));
    if (!first.ok || !second.ok) throw new Error("unreachable");
    expect(second.value.token).toBe(first.value.token);
  });

  it("getRing3ClaimLink errors for an unknown session", async () => {
    const result = await getRing3ClaimLink(db, "no-such-session");
    expect(result).toEqual({ ok: false, error: "session_not_found" });
  });

  it("getRing3ClaimLink errors once the session has started", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    const session = await seedSession(circleA.id, { slots: 4, startsAt: new Date("2026-08-04T20:00:00.000Z") });

    const result = await getRing3ClaimLink(db, session.id, new Date("2026-08-04T20:00:00.000Z"));
    expect(result).toEqual({ ok: false, error: "session_started" });
  });

  it("claimFourthCallSlot accepts a valid ring-3 token in lieu of a fourth_call notification", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    const p1 = await seedUser();
    await addMember(circleA.id, p1.id);
    const session = await seedSession(circleA.id, { slots: 4, startsAt: new Date("2026-08-04T20:00:00.000Z") });
    await rsvpConfirmed(session.id, p1.id);

    const linkResult = await getRing3ClaimLink(db, session.id, new Date("2026-08-04T18:00:00.000Z"));
    if (!linkResult.ok) throw new Error("unreachable");

    const stranger = await seedUser(); // holds no fourth_call notification at all
    const outcome = await claimFourthCallSlot(db, session.id, stranger.id, new Date("2026-08-04T18:05:00.000Z"), {
      ring3Token: linkResult.value.token,
    });

    expect(outcome).toEqual({ ok: true, status: "in", alreadyIn: false });
    const [row] = await db.select().from(rsvps).where(eq(rsvps.userId, stranger.id));
    expect(row?.source).toBe("fourth_call");
    expect(await findFourthCallClaimant(db, session.id)).toBe(stranger.id);
  });

  it("claimFourthCallSlot rejects a ring-3 token minted for a different session", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    const sessionA = await seedSession(circleA.id, { slots: 4, startsAt: new Date("2026-08-04T20:00:00.000Z") });
    const sessionB = await seedSession(circleA.id, { slots: 4, startsAt: new Date("2026-08-05T20:00:00.000Z") });

    const linkForA = await getRing3ClaimLink(db, sessionA.id, new Date("2026-08-04T18:00:00.000Z"));
    if (!linkForA.ok) throw new Error("unreachable");

    const stranger = await seedUser();
    const outcome = await claimFourthCallSlot(db, sessionB.id, stranger.id, new Date("2026-08-04T18:05:00.000Z"), {
      ring3Token: linkForA.value.token,
    });

    expect(outcome).toEqual({ ok: false, error: "no_fourth_call_invite" });
  });

  it("claimFourthCallSlot rejects an expired ring-3 token (session already started)", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    const session = await seedSession(circleA.id, { slots: 4, startsAt: new Date("2026-08-04T20:00:00.000Z") });

    const linkResult = await getRing3ClaimLink(db, session.id, new Date("2026-08-04T18:00:00.000Z"));
    if (!linkResult.ok) throw new Error("unreachable");

    const stranger = await seedUser();
    // Past the session's kickoff — the token's own embedded expiry (=
    // session.startsAt) has passed, independent of the session_started
    // check that would also catch this.
    const outcome = await claimFourthCallSlot(db, session.id, stranger.id, new Date("2026-08-04T20:00:01.000Z"), {
      ring3Token: linkResult.value.token,
    });

    expect(outcome).toEqual({ ok: false, error: "no_fourth_call_invite" });
  });
});

describe("hasFourthCallInvite", () => {
  it("is true once a fourth_call notification (any level) exists for that user/session", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    const session = await seedSession(circleA.id, { slots: 4 });
    const invitee = await seedUser();

    expect(await hasFourthCallInvite(db, session.id, invitee.id)).toBe(false);
    await seedFourthCallNotification(invitee.id, session.id, 2);
    expect(await hasFourthCallInvite(db, session.id, invitee.id)).toBe(true);
  });

  it("is scoped per session — an invite for a different session doesn't count", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    const sessionA = await seedSession(circleA.id, { slots: 4 });
    const sessionB = await seedSession(circleA.id, { slots: 4, startsAt: new Date("2026-09-01T18:00:00.000Z") });
    const invitee = await seedUser();
    await seedFourthCallNotification(invitee.id, sessionA.id, 1);

    expect(await hasFourthCallInvite(db, sessionB.id, invitee.id)).toBe(false);
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

  it("claimFourthCallSlot broadcasts 'fourth_call' (claimed) and 'rsvp' to session and circle", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    const p1 = await seedUser();
    await addMember(circleA.id, p1.id);
    const session = await seedSession(circleA.id, { slots: 4 });
    await rsvpConfirmed(session.id, p1.id);
    const invitee = await seedUser();
    await seedFourthCallNotification(invitee.id, session.id, 2);

    const calls = capture();
    const outcome = await claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));
    expect(outcome).toEqual({ ok: true, status: "in", alreadyIn: false });

    const claimedCalls = calls.filter((c) => c.type === "fourth_call" && c.fields.claimed === true);
    const rsvpCalls = calls.filter((c) => c.type === "rsvp");
    expect(claimedCalls).toHaveLength(2);
    expect(rsvpCalls).toHaveLength(2);
    expect(claimedCalls.map((c) => c.topic).sort()).toEqual(
      [sessionChannel(session.id), circleChannel(circleA.id)].sort(),
    );
  });

  it("a second (already-in) claim does not re-broadcast", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    const session = await seedSession(circleA.id, { slots: 4 });
    const invitee = await seedUser();
    await seedFourthCallNotification(invitee.id, session.id, 2);
    await claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));

    const calls = capture();
    const second = await claimFourthCallSlot(db, session.id, invitee.id, new Date("2026-08-04T18:00:00.000Z"));
    expect(second).toEqual({ ok: true, status: "in", alreadyIn: true });
    expect(calls).toHaveLength(0);
  });
});

describe("setFourthCallSideHint (issue #21)", () => {
  const before = new Date("2026-08-04T18:00:00.000Z");

  it("lets an organiser set and clear the hint", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    await addMember(circleA.id, organiser.id, "organiser");
    const session = await seedSession(circleA.id, { slots: 4 });

    const set = await setFourthCallSideHint(db, session.id, organiser.id, "left", before);
    expect(set).toEqual({ ok: true, sideHint: "left" });
    let [row] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(row?.fourthCallSideHint).toBe("left");

    const cleared = await setFourthCallSideHint(db, session.id, organiser.id, null, before);
    expect(cleared).toEqual({ ok: true, sideHint: null });
    [row] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(row?.fourthCallSideHint).toBeNull();
  });

  it("rejects a non-organiser member and a total stranger", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    await addMember(circleA.id, organiser.id, "organiser");
    const member = await seedUser();
    await addMember(circleA.id, member.id);
    const stranger = await seedUser();
    const session = await seedSession(circleA.id, { slots: 4 });

    expect(await setFourthCallSideHint(db, session.id, member.id, "left", before)).toEqual({
      ok: false,
      error: "not_an_organiser",
    });
    expect(await setFourthCallSideHint(db, session.id, stranger.id, "right", before)).toEqual({
      ok: false,
      error: "not_an_organiser",
    });
    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(row?.fourthCallSideHint).toBeNull();
  });

  it("rejects anything that isn't 'left', 'right' or null", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    await addMember(circleA.id, organiser.id, "organiser");
    const session = await seedSession(circleA.id, { slots: 4 });

    for (const bad of ["both", "LEFT", "", 3, undefined, {}]) {
      expect(await setFourthCallSideHint(db, session.id, organiser.id, bad, before)).toEqual({
        ok: false,
        error: "invalid_hint",
      });
    }
  });

  it("rejects once the session has started, and 404s a missing session", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    await addMember(circleA.id, organiser.id, "organiser");
    const session = await seedSession(circleA.id, { slots: 4, startsAt: new Date("2026-08-04T20:00:00.000Z") });

    expect(await setFourthCallSideHint(db, session.id, organiser.id, "left", new Date("2026-08-04T20:00:00.000Z"))).toEqual({
      ok: false,
      error: "session_started",
    });
    expect(await setFourthCallSideHint(db, "00000000-0000-0000-0000-000000000000", organiser.id, "left", before)).toEqual({
      ok: false,
      error: "session_not_found",
    });
  });

  it("broadcasts fourth_call to session and circle after a successful set, and not on a failed one", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    await addMember(circleA.id, organiser.id, "organiser");
    const member = await seedUser();
    await addMember(circleA.id, member.id);
    const session = await seedSession(circleA.id, { slots: 4 });

    const calls: { topic: string; type: string; fields: Record<string, unknown> }[] = [];
    __setRealtimeSenderForTests(async (topic, type, fields) => {
      calls.push({ topic, type, fields });
    });

    await setFourthCallSideHint(db, session.id, organiser.id, "right", before);
    expect(calls.filter((c) => c.type === "fourth_call").map((c) => c.topic).sort()).toEqual(
      [sessionChannel(session.id), circleChannel(circleA.id)].sort(),
    );

    calls.length = 0;
    await setFourthCallSideHint(db, session.id, member.id, "left", before);
    expect(calls).toHaveLength(0);
  });

  it("NEVER filters: a wrong-sided player can still claim a hinted call through the public link", async () => {
    const organiser = await seedUser();
    const circleA = await seedCircle(organiser.id);
    await addMember(circleA.id, organiser.id, "organiser");
    const p1 = await seedUser();
    await addMember(circleA.id, p1.id);
    const session = await seedSession(circleA.id, { slots: 4, startsAt: new Date("2026-08-04T20:00:00.000Z") });
    await rsvpConfirmed(session.id, p1.id);

    // Organiser asks for a left-sider…
    await setFourthCallSideHint(db, session.id, organiser.id, "left", before);

    // …and a committed RIGHT-sider with no invite at all claims via ring 3.
    const rightSider = await seedUser();
    await db.update(users).set({ courtSide: "right" }).where(eq(users.id, rightSider.id));

    const linkResult = await getRing3ClaimLink(db, session.id, before);
    if (!linkResult.ok) throw new Error("unreachable");
    const outcome = await claimFourthCallSlot(db, session.id, rightSider.id, new Date("2026-08-04T18:05:00.000Z"), {
      ring3Token: linkResult.value.token,
    });

    expect(outcome).toEqual({ ok: true, status: "in", alreadyIn: false });
    const [row] = await db.select().from(rsvps).where(eq(rsvps.userId, rightSider.id));
    expect(row?.status).toBe("in");
  });
});
