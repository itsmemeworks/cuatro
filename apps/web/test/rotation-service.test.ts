import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { notifications, rsvps, sessions, standingGames, users } from "@cuatro/db";
import { seedCircle, type Fixture } from "./support/games-fixtures";
import {
  ROTATION_LOCK_LEAD_MS,
  ROTATION_OFFER_WINDOW_MS,
  checkFourthCallLevel1,
  ensureUpcomingSessionForStandingGame,
  getSessionSummary,
  lockRotationIfDue,
  markAvailable,
  markUnavailable,
  offerRotationSlotIfNeeded,
  rsvpOut,
} from "@/server/games-service";
import { claimFourthCallSlot, hasFourthCallInvite } from "@/server/fourth-call";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";

const HOUR = 60 * 60 * 1000;

let fixture: Fixture | undefined;
afterEach(() => {
  fixture?.close();
  fixture = undefined;
  __setRealtimeSenderForTests(null);
});

/** A rotation-on standing game with `memberCount` members + a current session. */
function rotationFixture(now: Date, memberCount = 5, slots = 4) {
  fixture = seedCircle({ memberCount, standingGame: { weekday: 2, startTime: "20:00", slots, rsvpWindowDays: 6 } });
  fixture.db.update(standingGames).set({ rotationEnabled: true }).where(eq(standingGames.id, fixture.standingGameId!)).run();
  const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
  return { fixture, session };
}

/** Insert a past played session of this standing game with the given players recorded 'in'. */
function seedPastSession(f: Fixture, startsAt: Date, playedUserIds: string[]) {
  const s = f.db
    .insert(sessions)
    .values({ standingGameId: f.standingGameId, circleId: f.circleId, venueId: f.venueId, startsAt, status: "played" })
    .returning()
    .get();
  for (const userId of playedUserIds) {
    f.db.insert(rsvps).values({ sessionId: s.id, userId, status: "in", respondedAt: startsAt }).run();
  }
  return s;
}

describe("markAvailable / markUnavailable", () => {
  it("records availability without holding a slot, idempotently", () => {
    const now = new Date("2026-01-04T00:00:00.000Z");
    const { fixture: f, session } = rotationFixture(now);
    const uid = f.memberIds[0];

    expect(markAvailable(f.db, session.id, uid, now)).toEqual({ ok: true, status: "available" });
    expect(markAvailable(f.db, session.id, uid, now)).toEqual({ ok: true, status: "available" }); // idempotent

    const row = f.db.select().from(rsvps).where(and(eq(rsvps.sessionId, session.id), eq(rsvps.userId, uid))).get();
    expect(row?.status).toBe("available");
    expect(row?.position).toBeNull();
  });

  it("markUnavailable drops the availability pool to 'out'", () => {
    const now = new Date("2026-01-04T00:00:00.000Z");
    const { fixture: f, session } = rotationFixture(now);
    markAvailable(f.db, session.id, f.memberIds[0], now);
    expect(markUnavailable(f.db, session.id, f.memberIds[0], now)).toEqual({ ok: true, status: "out" });
    const row = f.db.select().from(rsvps).where(and(eq(rsvps.sessionId, session.id), eq(rsvps.userId, f.memberIds[0]))).get();
    expect(row?.status).toBe("out");
  });

  it("rejects availability on a non-rotation game", () => {
    const now = new Date("2026-01-04T00:00:00.000Z");
    fixture = seedCircle({ memberCount: 3, standingGame: { weekday: 2, startTime: "20:00" } });
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    expect(markAvailable(fixture.db, session.id, fixture.memberIds[0], now)).toEqual({ ok: false, error: "rotation_not_enabled" });
  });
});

describe("lockRotationIfDue", () => {
  it("does not lock before T-24h, locks at/after it", () => {
    const now = new Date("2026-01-04T00:00:00.000Z");
    const { fixture: f, session } = rotationFixture(now);
    for (const uid of f.memberIds) markAvailable(f.db, session.id, uid, now);

    const tooEarly = new Date(session.startsAt.getTime() - ROTATION_LOCK_LEAD_MS - HOUR);
    expect(lockRotationIfDue(f.db, session.id, tooEarly)).toEqual({ locked: false, reason: "not_yet" });

    const due = new Date(session.startsAt.getTime() - ROTATION_LOCK_LEAD_MS + HOUR);
    const res = lockRotationIfDue(f.db, session.id, due);
    expect(res.locked).toBe(true);

    // Idempotent: a second view is a no-op.
    expect(lockRotationIfDue(f.db, session.id, due)).toEqual({ locked: false, reason: "already_locked" });
  });

  it("prioritises the player who's sat out most and benches a most-played one", () => {
    const now = new Date("2026-01-13T08:00:00.000Z");
    const { fixture: f, session } = rotationFixture(now, 5, 4);
    const [m0, m1, m2, m3, m4] = f.memberIds;

    // The same four (m0..m3) played the last two sessions; m4 has never played.
    seedPastSession(f, new Date(session.startsAt.getTime() - 14 * 24 * HOUR), [m0, m1, m2, m3]);
    seedPastSession(f, new Date(session.startsAt.getTime() - 7 * 24 * HOUR), [m0, m1, m2, m3]);

    // All five available, replying in order m0..m4 (staggered so availability
    // order is the reply order, not a same-timestamp tie).
    [m0, m1, m2, m3, m4].forEach((uid, i) => markAvailable(f.db, session.id, uid, new Date(now.getTime() + i * 1000)));

    const due = new Date(session.startsAt.getTime() - ROTATION_LOCK_LEAD_MS + HOUR);
    const res = lockRotationIfDue(f.db, session.id, due);
    if (!res.locked) throw new Error("expected lock");

    // m4 (0 plays) is the most due, so is in; the four regulars are equally
    // most-played (each 2), so the sit-out falls to the last of them by
    // availability order — m3. m0..m2 keep their places.
    expect(res.inUserIds).toContain(m4);
    expect(res.sittingUserIds).toEqual([m3]);

    // Committed rows: 4 'in', 1 'reserve' at position 1, lock stamped.
    const rows = f.db.select().from(rsvps).where(eq(rsvps.sessionId, session.id)).all();
    expect(rows.filter((r) => r.status === "in")).toHaveLength(4);
    const reserve = rows.filter((r) => r.status === "reserve");
    expect(reserve).toHaveLength(1);
    expect(reserve[0].userId).toBe(m3);
    expect(reserve[0].position).toBe(1);
    const locked = f.db.select().from(sessions).where(eq(sessions.id, session.id)).get();
    expect(locked?.rotationLockedAt).not.toBeNull();

    // Every available player got a lock notification.
    const notifs = f.db.select().from(notifications).where(eq(notifications.userId, m3)).all();
    expect(notifs.length).toBeGreaterThan(0);
  });

  it("fewer than slots available: everyone is in, no sit-out, Fourth Call fires", () => {
    const now = new Date("2026-01-04T00:00:00.000Z");
    const { fixture: f, session } = rotationFixture(now, 5, 4);
    markAvailable(f.db, session.id, f.memberIds[0], now);
    markAvailable(f.db, session.id, f.memberIds[1], now);

    const due = new Date(session.startsAt.getTime() - ROTATION_LOCK_LEAD_MS + HOUR);
    const res = lockRotationIfDue(f.db, session.id, due);
    if (!res.locked) throw new Error("expected lock");
    expect(res.inUserIds).toHaveLength(2);
    expect(res.sittingUserIds).toEqual([]);

    // Short lineup within the Fourth Call window => the level-1 call fires.
    const fc = checkFourthCallLevel1(f.db, session.id, due);
    expect(fc.fired).toBe(true);
  });

  it("after lock, a dropped starter OFFERS the spot to the first sit-out (no auto-promote)", () => {
    const now = new Date("2026-01-04T00:00:00.000Z");
    const { fixture: f, session } = rotationFixture(now, 5, 4);
    for (const uid of f.memberIds) markAvailable(f.db, session.id, uid, now);
    const due = new Date(session.startsAt.getTime() - ROTATION_LOCK_LEAD_MS + HOUR);
    const res = lockRotationIfDue(f.db, session.id, due);
    if (!res.locked) throw new Error("expected lock");

    const sitter = res.sittingUserIds[0];
    const starter = res.inUserIds[0];
    const out = rsvpOut(f.db, session.id, starter, due);
    expect(out.ok).toBe(true);
    // Consent-based: the sit-out is NOT silently promoted.
    if (out.ok) expect(out.promotedUserId).toBeUndefined();
    const sitterRow = f.db.select().from(rsvps).where(and(eq(rsvps.sessionId, session.id), eq(rsvps.userId, sitter))).get();
    expect(sitterRow?.status).toBe("reserve");

    // They hold a first-refusal offer (a rotation_offer fourth_call notification).
    const offer = f.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, sitter), eq(notifications.type, "fourth_call")))
      .all()
      .find((n) => (n.payload as { via?: string })?.via === "rotation_offer");
    expect(offer).toBeTruthy();
  });

  it("offer cascades to the next sit-out when the first passes or lapses, then hands to the Fourth Call", () => {
    const now = new Date("2026-01-04T00:00:00.000Z");
    const { fixture: f, session } = rotationFixture(now, 6, 4); // 6 available, 4 slots => 2 sit-outs
    for (const uid of f.memberIds) markAvailable(f.db, session.id, uid, now);
    const due = new Date(session.startsAt.getTime() - ROTATION_LOCK_LEAD_MS + HOUR);
    const res = lockRotationIfDue(f.db, session.id, due);
    if (!res.locked) throw new Error("expected lock");
    expect(res.sittingUserIds).toHaveLength(2);
    const [sit1, sit2] = res.sittingUserIds;

    // A starter drops -> offer #1 to the first sit-out.
    rsvpOut(f.db, session.id, res.inUserIds[0], due);
    let offer = offerRotationSlotIfNeeded(f.db, session.id, due);
    expect(offer).toEqual({ state: "waiting", userId: sit1 });

    // sit1 lapses (window passes) -> next view advances to sit2.
    const afterWindow = new Date(due.getTime() + ROTATION_OFFER_WINDOW_MS + 60_000);
    offer = offerRotationSlotIfNeeded(f.db, session.id, afterWindow);
    expect(offer).toEqual({ state: "offered", userId: sit2 });

    // sit2 lapses too -> exhausted, so the Fourth Call may now broadcast.
    const afterWindow2 = new Date(afterWindow.getTime() + ROTATION_OFFER_WINDOW_MS + 60_000);
    offer = offerRotationSlotIfNeeded(f.db, session.id, afterWindow2);
    expect(offer).toEqual({ state: "exhausted" });
  });

  it("an offered sit-out can accept via the Fourth Call claim path", () => {
    const now = new Date("2026-01-04T00:00:00.000Z");
    const { fixture: f, session } = rotationFixture(now, 5, 4);
    for (const uid of f.memberIds) markAvailable(f.db, session.id, uid, now);
    const due = new Date(session.startsAt.getTime() - ROTATION_LOCK_LEAD_MS + HOUR);
    const res = lockRotationIfDue(f.db, session.id, due);
    if (!res.locked) throw new Error("expected lock");
    const sitter = res.sittingUserIds[0];

    rsvpOut(f.db, session.id, res.inUserIds[0], due);
    expect(offerRotationSlotIfNeeded(f.db, session.id, due)).toEqual({ state: "waiting", userId: sitter });

    // The offer is a fourth_call invite, so the sit-out claims through it.
    expect(hasFourthCallInvite(f.db, session.id, sitter)).toBe(true);
    const claim = claimFourthCallSlot(f.db, session.id, sitter, due);
    expect(claim.ok).toBe(true);
    const sitterRow = f.db.select().from(rsvps).where(and(eq(rsvps.sessionId, session.id), eq(rsvps.userId, sitter))).get();
    expect(sitterRow?.status).toBe("in");
  });

  it("post-lock late availability fills an open spot directly (rotation order, no offer)", () => {
    const now = new Date("2026-01-04T00:00:00.000Z");
    const { fixture: f, session } = rotationFixture(now, 5, 4);
    // Only 3 available at lock => everyone in, one open slot.
    const [m0, m1, m2] = f.memberIds;
    for (const uid of [m0, m1, m2]) markAvailable(f.db, session.id, uid, now);
    const due = new Date(session.startsAt.getTime() - ROTATION_LOCK_LEAD_MS + HOUR);
    const res = lockRotationIfDue(f.db, session.id, due);
    if (!res.locked) throw new Error("expected lock");
    expect(res.inUserIds).toHaveLength(3);

    // A fourth member declares available AFTER lock -> takes the open slot.
    const late = markAvailable(f.db, session.id, f.memberIds[3], due);
    expect(late.ok).toBe(true);
    if (late.ok) expect(late.status).toBe("in");
  });
});

describe("getSessionSummary rotation view", () => {
  it("shows a live provisional four + sitting list with reasons before lock", () => {
    const now = new Date("2026-01-13T08:00:00.000Z");
    const { fixture: f, session } = rotationFixture(now, 5, 4);
    const [m0, m1, m2, m3, m4] = f.memberIds;
    seedPastSession(f, new Date(session.startsAt.getTime() - 7 * 24 * HOUR), [m0, m1, m2, m3]);
    for (const uid of [m0, m1, m2, m3, m4]) markAvailable(f.db, session.id, uid, now);

    const summary = getSessionSummary(f.db, session.id, m4, now);
    if (!summary?.rotation) throw new Error("expected rotation view");
    expect(summary.rotation.lockedAt).toBeNull();
    expect(summary.rotation.available).toHaveLength(5);
    expect(summary.rotation.lineup).toHaveLength(4);
    expect(summary.rotation.sitting).toHaveLength(1);
    expect(summary.rotation.viewerAvailable).toBe(true);
    // m4 never played => in, with an explainable reason.
    expect(summary.rotation.lineup.map((p) => p.userId)).toContain(m4);
    expect(summary.rotation.reasons[m4].reason).toBe("played 0 of last 1");
    // Provisional: no committed slots yet.
    expect(summary.confirmed).toHaveLength(0);
  });

  it("mirrors the committed four + sit-out list after lock", () => {
    const now = new Date("2026-01-04T00:00:00.000Z");
    const { fixture: f, session } = rotationFixture(now, 5, 4);
    for (const uid of f.memberIds) markAvailable(f.db, session.id, uid, now);
    const due = new Date(session.startsAt.getTime() - ROTATION_LOCK_LEAD_MS + HOUR);
    lockRotationIfDue(f.db, session.id, due);

    const summary = getSessionSummary(f.db, session.id, f.memberIds[0], due);
    if (!summary?.rotation) throw new Error("expected rotation view");
    expect(summary.rotation.lockedAt).not.toBeNull();
    expect(summary.rotation.lineup).toHaveLength(4);
    expect(summary.rotation.sitting).toHaveLength(1);
    // Post-lock these are the real committed rows.
    expect(summary.confirmed).toHaveLength(4);
    expect(summary.reserves).toHaveLength(1);
  });

  it("is null for a non-rotation game", () => {
    const now = new Date("2026-01-04T00:00:00.000Z");
    fixture = seedCircle({ memberCount: 3, standingGame: { weekday: 2, startTime: "20:00" } });
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    const summary = getSessionSummary(fixture.db, session.id, fixture.memberIds[0], now);
    expect(summary?.rotation).toBeNull();
  });
});
