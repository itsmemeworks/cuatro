import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { notifications, rsvps, sessions, standingGames, users, venues } from "@cuatro/db";
import { seedCircle, type Fixture } from "./support/games-fixtures";
import {
  DEFAULT_SESSION_DURATION_MINUTES,
  DEFAULT_SESSION_SLOTS,
  checkFourthCallLevel1,
  createOneOffSession,
  ensureSessionPlayedTransition,
  ensureUpcomingSessionForStandingGame,
  ensureUpcomingSessionsForCircle,
  getSessionSummary,
  rescheduleUpcomingSessionsForStandingGame,
  rsvpIn,
  rsvpOut,
} from "@/server/games-service";
import { updateStandingGame } from "@/server/standing-games-service";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";
import { circleChannel, sessionChannel } from "@/lib/realtime/channels";

const DAY_MS = 24 * 60 * 60 * 1000;

let fixture: Fixture | undefined;
afterEach(() => {
  fixture?.close();
  fixture = undefined;
  __setRealtimeSenderForTests(null);
});

describe("ensureUpcomingSessionForStandingGame", () => {
  it("creates the next session for an active standing game, timezone-correct", () => {
    fixture = seedCircle({
      memberCount: 3,
      timezone: "Europe/London",
      standingGame: { weekday: 2, startTime: "20:00" }, // Tuesday 20:00
    });
    const now = new Date("2026-01-04T00:00:00.000Z"); // Sunday

    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);

    expect(session.startsAt.toISOString()).toBe("2026-01-06T20:00:00.000Z");
    expect(session.circleId).toBe(fixture.circleId);
    expect(session.status).toBe("upcoming");
  });

  it("is idempotent: a repeat call while the occurrence is still upcoming returns the same row", () => {
    fixture = seedCircle({
      memberCount: 2,
      standingGame: { weekday: 2, startTime: "20:00" },
    });
    const now = new Date("2026-01-04T00:00:00.000Z");

    const first = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    const second = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, new Date("2026-01-05T00:00:00.000Z"));

    expect(second.id).toBe(first.id);
    const allSessions = fixture.db.select().from(sessions).all();
    expect(allSessions).toHaveLength(1);
  });

  it("advances to next week's occurrence once the current one's start time has passed", () => {
    fixture = seedCircle({
      memberCount: 2,
      standingGame: { weekday: 2, startTime: "20:00" },
    });
    const first = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, new Date("2026-01-04T00:00:00.000Z"));
    expect(first.startsAt.toISOString()).toBe("2026-01-06T20:00:00.000Z");

    // Now well past that Tuesday's kickoff.
    const second = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, new Date("2026-01-07T00:00:00.000Z"));
    expect(second.id).not.toBe(first.id);
    expect(second.startsAt.toISOString()).toBe("2026-01-13T20:00:00.000Z");

    const allSessions = fixture.db.select().from(sessions).all();
    expect(allSessions).toHaveLength(2);
  });

  it("ensureUpcomingSessionsForCircle only generates for active standing games", () => {
    fixture = seedCircle({
      memberCount: 2,
      standingGame: { weekday: 2, startTime: "20:00", active: false },
    });
    const created = ensureUpcomingSessionsForCircle(fixture.db, fixture.circleId, new Date("2026-01-04T00:00:00.000Z"));
    expect(created).toHaveLength(0);
  });
});

describe("createOneOffSession", () => {
  it("organiser-only: rejects a non-organiser member", () => {
    fixture = seedCircle({ memberCount: 2 });
    const result = createOneOffSession(fixture.db, fixture.memberIds[0], {
      circleId: fixture.circleId,
      startsAt: new Date("2026-02-01T18:00:00.000Z"),
    });
    expect(result).toEqual({ ok: false, error: "not_an_organiser" });
  });

  it("creates a session with no standing_game_id", () => {
    fixture = seedCircle({ memberCount: 2 });
    const result = createOneOffSession(fixture.db, fixture.organiserId, {
      circleId: fixture.circleId,
      startsAt: new Date("2026-02-01T18:00:00.000Z"),
      venueName: "Pop-up court",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.standingGameId).toBeNull();
  });
});

describe("rsvpIn / rsvpOut — slot and reserve assignment", () => {
  function makeSessionFixture(now: Date, slots = 4) {
    fixture = seedCircle({
      memberCount: 6,
      standingGame: { weekday: 2, startTime: "20:00", slots, rsvpWindowDays: 6 },
    });
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    return { fixture, session };
  }

  it("the first `slots` players to RSVP in hold slots; the rest queue as reserves in arrival order", () => {
    const now = new Date("2026-01-05T00:00:00.000Z"); // within the 6-day window before Tue 20:00
    const { fixture: fx, session } = makeSessionFixture(now);
    const [p1, p2, p3, p4, p5, p6] = [fx.organiserId, ...fx.memberIds];

    for (const uid of [p1, p2, p3, p4, p5, p6]) {
      const outcome = rsvpIn(fx.db, session.id, uid, now);
      expect(outcome.ok).toBe(true);
    }

    const rows = fx.db.select().from(rsvps).where(eq(rsvps.sessionId, session.id)).all();
    const inRows = rows.filter((r) => r.status === "in").map((r) => r.userId);
    const reserveRows = rows.filter((r) => r.status === "reserve").sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    expect(inRows.sort()).toEqual([p1, p2, p3, p4].sort());
    expect(reserveRows.map((r) => r.userId)).toEqual([p5, p6]);
    expect(reserveRows.map((r) => r.position)).toEqual([1, 2]);
  });

  it("tapping IN twice is idempotent (no double-count, no status change)", () => {
    const now = new Date("2026-01-05T00:00:00.000Z");
    const { fixture: fx, session } = makeSessionFixture(now);
    rsvpIn(fx.db, session.id, fx.organiserId, now);
    rsvpIn(fx.db, session.id, fx.organiserId, now);

    const row = fx.db
      .select()
      .from(rsvps)
      .where(eq(rsvps.sessionId, session.id))
      .all()
      .find((r) => r.userId === fx.organiserId);
    expect(row?.status).toBe("in");

    const user = fx.db.select().from(users).where(eq(users.id, fx.organiserId)).get();
    expect(user?.rsvpInCount).toBe(1);
  });

  it("records rsvps.source: 'rsvp' on a fresh RSVP, and resets it back from a stale 'fourth_call' flag on re-RSVP", () => {
    const now = new Date("2026-01-05T00:00:00.000Z");
    const { fixture: fx, session } = makeSessionFixture(now);

    rsvpIn(fx.db, session.id, fx.organiserId, now);
    const [freshRow] = fx.db.select().from(rsvps).where(eq(rsvps.userId, fx.organiserId)).all();
    expect(freshRow?.source).toBe("rsvp");

    // Simulate a row that was previously claimed via Fourth Call (as
    // claimFourthCallSlot would leave it), then dropped, then re-RSVP'd
    // through the ordinary in-circle flow — the plain RSVP tap should
    // overwrite the stale flag rather than leaving it "claimed via fourth
    // call" for a slot filled the normal way.
    fx.db.update(rsvps).set({ status: "out", source: "fourth_call" }).where(eq(rsvps.id, freshRow!.id)).run();
    rsvpIn(fx.db, session.id, fx.organiserId, now);
    const [reRow] = fx.db.select().from(rsvps).where(eq(rsvps.userId, fx.organiserId)).all();
    expect(reRow?.source).toBe("rsvp");
  });

  it("a reserve dropping out closes the gap in the queue behind them", () => {
    const now = new Date("2026-01-05T00:00:00.000Z");
    const { fixture: fx, session } = makeSessionFixture(now);
    const [p1, p2, p3, p4, p5, p6] = [fx.organiserId, ...fx.memberIds];
    for (const uid of [p1, p2, p3, p4, p5, p6]) rsvpIn(fx.db, session.id, uid, now);

    // p5 (reserve #1) drops out; p6 (reserve #2) should close up to #1.
    const outcome = rsvpOut(fx.db, session.id, p5, now);
    expect(outcome).toEqual({ ok: true, status: "out" });

    const reserveRows = fx.db
      .select()
      .from(rsvps)
      .where(eq(rsvps.sessionId, session.id))
      .all()
      .filter((r) => r.status === "reserve");
    expect(reserveRows).toHaveLength(1);
    expect(reserveRows[0].userId).toBe(p6);
    expect(reserveRows[0].position).toBe(1);
  });

  it("a confirmed dropout auto-promotes reserve #1 into their slot", () => {
    const now = new Date("2026-01-05T00:00:00.000Z");
    const { fixture: fx, session } = makeSessionFixture(now);
    const [p1, p2, p3, p4, p5, p6] = [fx.organiserId, ...fx.memberIds];
    for (const uid of [p1, p2, p3, p4, p5, p6]) rsvpIn(fx.db, session.id, uid, now);

    const outcome = rsvpOut(fx.db, session.id, p1, now);
    expect(outcome).toEqual({ ok: true, status: "out", promotedUserId: p5 });

    const rows = fx.db.select().from(rsvps).where(eq(rsvps.sessionId, session.id)).all();
    const inRows = rows.filter((r) => r.status === "in").map((r) => r.userId);
    expect(inRows.sort()).toEqual([p2, p3, p4, p5].sort());

    const reserveRows = rows.filter((r) => r.status === "reserve");
    expect(reserveRows).toHaveLength(1);
    expect(reserveRows[0]).toMatchObject({ userId: p6, position: 1 });

    // p5 was only ever a reserve until now — this promotion is their first
    // confirmed "in".
    const promoted = fx.db.select().from(users).where(eq(users.id, p5)).get();
    expect(promoted?.rsvpInCount).toBe(1);
  });

  it("handles two 'concurrent' dropouts without double-promoting the same reserve", async () => {
    const now = new Date("2026-01-05T00:00:00.000Z");
    const { fixture: fx, session } = makeSessionFixture(now);
    const [p1, p2, p3, p4, p5, p6] = [fx.organiserId, ...fx.memberIds];
    for (const uid of [p1, p2, p3, p4, p5, p6]) rsvpIn(fx.db, session.id, uid, now);

    // "Simultaneous" cancellations of two different confirmed players.
    // Each rsvpOut call runs a single synchronous db.transaction with no
    // internal `await`, so even issued together these cannot interleave —
    // this proves the two dropouts resolve to two distinct promotions,
    // never the same reserve filling both slots.
    const [outcomeA, outcomeB] = await Promise.all([
      Promise.resolve(rsvpOut(fx.db, session.id, p1, now)),
      Promise.resolve(rsvpOut(fx.db, session.id, p2, now)),
    ]);

    const promotedIds = [outcomeA, outcomeB]
      .filter((o): o is Extract<typeof o, { ok: true }> => o.ok)
      .map((o) => o.promotedUserId)
      .filter((id): id is string => !!id);

    expect(new Set(promotedIds).size).toBe(2);
    expect(promotedIds.sort()).toEqual([p5, p6].sort());

    const rows = fx.db.select().from(rsvps).where(eq(rsvps.sessionId, session.id)).all();
    const inRows = rows.filter((r) => r.status === "in").map((r) => r.userId);
    expect(inRows.sort()).toEqual([p3, p4, p5, p6].sort());
    expect(rows.filter((r) => r.status === "reserve")).toHaveLength(0);
  });

  it("a dropout with nobody in reserve notifies the organiser instead of promoting anyone", () => {
    const now = new Date("2026-01-05T00:00:00.000Z");
    const { fixture: fx, session } = makeSessionFixture(now);
    rsvpIn(fx.db, session.id, fx.organiserId, now);

    const outcome = rsvpOut(fx.db, session.id, fx.organiserId, now);
    expect(outcome).toEqual({ ok: true, status: "out" });
  });
});

describe("RSVP window enforcement", () => {
  it("rejects an IN attempt before the RSVP window has opened", () => {
    fixture = seedCircle({
      memberCount: 2,
      standingGame: { weekday: 2, startTime: "20:00", rsvpWindowDays: 6 },
    });
    // Session is 10 days out from `now`; the 6-day window hasn't opened yet.
    const now = new Date("2026-01-04T00:00:00.000Z");
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    const tooEarly = new Date(session.startsAt.getTime() - 7 * DAY_MS);

    const outcome = rsvpIn(fixture.db, session.id, fixture.organiserId, tooEarly);
    expect(outcome).toEqual({ ok: false, error: "window_not_open" });
  });

  it("allows an IN attempt once the window has opened", () => {
    fixture = seedCircle({
      memberCount: 2,
      standingGame: { weekday: 2, startTime: "20:00", rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-04T00:00:00.000Z");
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    const withinWindow = new Date(session.startsAt.getTime() - 5 * DAY_MS);

    const outcome = rsvpIn(fixture.db, session.id, fixture.organiserId, withinWindow);
    expect(outcome).toEqual({ ok: true, status: "in" });
  });

  it("rejects both IN and OUT attempts once the session has started", () => {
    fixture = seedCircle({
      memberCount: 2,
      standingGame: { weekday: 2, startTime: "20:00", rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-04T00:00:00.000Z");
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    const afterStart = new Date(session.startsAt.getTime() + 60_000);

    expect(rsvpIn(fixture.db, session.id, fixture.organiserId, afterStart)).toEqual({
      ok: false,
      error: "session_started",
    });
    expect(rsvpOut(fixture.db, session.id, fixture.organiserId, afterStart)).toEqual({
      ok: false,
      error: "session_started",
    });
  });

  it("rejects RSVPs from a user who isn't a member of the session's circle", () => {
    fixture = seedCircle({
      memberCount: 1,
      standingGame: { weekday: 2, startTime: "20:00", rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);

    const outcome = rsvpIn(fixture.db, session.id, "not-a-real-user-id", now);
    expect(outcome).toEqual({ ok: false, error: "not_a_circle_member" });
  });
});

describe("reliability counters", () => {
  it("increments rsvpInCount when a player is confirmed in (directly or via promotion)", () => {
    fixture = seedCircle({
      memberCount: 5,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    const [p1, p2, p3, p4, p5] = [fixture.organiserId, ...fixture.memberIds];
    for (const uid of [p1, p2, p3, p4, p5]) rsvpIn(fixture.db, session.id, uid, now);

    expect(fixture.db.select().from(users).where(eq(users.id, p1)).get()?.rsvpInCount).toBe(1);
    // p5 queued as a reserve — not confirmed in yet.
    expect(fixture.db.select().from(users).where(eq(users.id, p5)).get()?.rsvpInCount).toBe(0);

    rsvpOut(fixture.db, session.id, p1, now); // promotes p5
    expect(fixture.db.select().from(users).where(eq(users.id, p5)).get()?.rsvpInCount).toBe(1);
  });

  it("counts a cancellation inside 24h of start as a late cancel", () => {
    fixture = seedCircle({
      memberCount: 1,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    rsvpIn(fixture.db, session.id, fixture.organiserId, now);

    const lateCancelTime = new Date(session.startsAt.getTime() - 12 * 60 * 60 * 1000); // 12h before
    rsvpOut(fixture.db, session.id, fixture.organiserId, lateCancelTime);

    const user = fixture.db.select().from(users).where(eq(users.id, fixture.organiserId)).get();
    expect(user?.lateCancelCount).toBe(1);
  });

  it("does not count a cancellation outside the 24h window against the player", () => {
    fixture = seedCircle({
      memberCount: 1,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    rsvpIn(fixture.db, session.id, fixture.organiserId, now);

    const earlyCancelTime = new Date(session.startsAt.getTime() - 3 * DAY_MS);
    rsvpOut(fixture.db, session.id, fixture.organiserId, earlyCancelTime);

    const user = fixture.db.select().from(users).where(eq(users.id, fixture.organiserId)).get();
    expect(user?.lateCancelCount).toBe(0);
  });

  // Exact edge of the 24h window: "inside 24h" reads as strictly less than
  // 24h of notice remaining, so exactly-24h-before is the last moment that
  // still counts as early (mirrors games-service.ts's `msToStart <
  // LATE_CANCEL_WINDOW_MS`, not `<=`).
  it("boundary: cancelling 1s inside 24h (23:59:59 notice) counts as a late cancel", () => {
    fixture = seedCircle({
      memberCount: 1,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    rsvpIn(fixture.db, session.id, fixture.organiserId, now);

    const cancelTime = new Date(session.startsAt.getTime() - (DAY_MS - 1000)); // 23h 59m 59s before
    rsvpOut(fixture.db, session.id, fixture.organiserId, cancelTime);

    const user = fixture.db.select().from(users).where(eq(users.id, fixture.organiserId)).get();
    expect(user?.lateCancelCount).toBe(1);
  });

  it("boundary: cancelling at exactly 24:00:00 notice does not count as a late cancel", () => {
    fixture = seedCircle({
      memberCount: 1,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    rsvpIn(fixture.db, session.id, fixture.organiserId, now);

    const cancelTime = new Date(session.startsAt.getTime() - DAY_MS); // exactly 24h before
    rsvpOut(fixture.db, session.id, fixture.organiserId, cancelTime);

    const user = fixture.db.select().from(users).where(eq(users.id, fixture.organiserId)).get();
    expect(user?.lateCancelCount).toBe(0);
  });

  it("boundary: cancelling 1s outside 24h (24:00:01 notice) does not count as a late cancel", () => {
    fixture = seedCircle({
      memberCount: 1,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    rsvpIn(fixture.db, session.id, fixture.organiserId, now);

    const cancelTime = new Date(session.startsAt.getTime() - (DAY_MS + 1000)); // 24h + 1s before
    rsvpOut(fixture.db, session.id, fixture.organiserId, cancelTime);

    const user = fixture.db.select().from(users).where(eq(users.id, fixture.organiserId)).get();
    expect(user?.lateCancelCount).toBe(0);
  });

  it("boundary: a reserve dropping out 1h before start is never a late cancel — reserves never held a slot", () => {
    fixture = seedCircle({
      memberCount: 5,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    const [p1, p2, p3, p4, p5] = [fixture.organiserId, ...fixture.memberIds];
    for (const uid of [p1, p2, p3, p4, p5]) rsvpIn(fixture.db, session.id, uid, now);

    // p5 is queued as reserve #1 (well inside the late-cancel window).
    const oneHourBefore = new Date(session.startsAt.getTime() - 60 * 60 * 1000);
    const outcome = rsvpOut(fixture.db, session.id, p5, oneHourBefore);
    expect(outcome).toEqual({ ok: true, status: "out" });

    const user = fixture.db.select().from(users).where(eq(users.id, p5)).get();
    expect(user?.lateCancelCount).toBe(0);
  });

  it("a repeat rsvpOut on an already-out player does not double-count the late cancel", () => {
    fixture = seedCircle({
      memberCount: 1,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    rsvpIn(fixture.db, session.id, fixture.organiserId, now);

    const lateCancelTime = new Date(session.startsAt.getTime() - 12 * 60 * 60 * 1000); // 12h before
    rsvpOut(fixture.db, session.id, fixture.organiserId, lateCancelTime);
    // Second (and third) tap-out while already out — a double click, a stale
    // client — must be a no-op: the early "already out" return runs before the
    // late-cancel increment, so the count stays at one per confirmed dropout.
    rsvpOut(fixture.db, session.id, fixture.organiserId, lateCancelTime);
    rsvpOut(fixture.db, session.id, fixture.organiserId, lateCancelTime);

    const user = fixture.db.select().from(users).where(eq(users.id, fixture.organiserId)).get();
    expect(user?.lateCancelCount).toBe(1);
  });

  it("does not penalise a reserve who drops out of the queue (they never held a slot)", () => {
    fixture = seedCircle({
      memberCount: 5,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    const [p1, p2, p3, p4, p5] = [fixture.organiserId, ...fixture.memberIds];
    for (const uid of [p1, p2, p3, p4, p5]) rsvpIn(fixture.db, session.id, uid, now);

    const nearStart = new Date(session.startsAt.getTime() - 1000);
    rsvpOut(fixture.db, session.id, p5, nearStart);

    const user = fixture.db.select().from(users).where(eq(users.id, p5)).get();
    expect(user?.lateCancelCount).toBe(0);
  });
});

describe("Fourth Call level 1", () => {
  it("does not fire more than 48h before the session", () => {
    fixture = seedCircle({
      memberCount: 3,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-04T00:00:00.000Z");
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);

    const result = checkFourthCallLevel1(fixture.db, session.id, now);
    expect(result).toEqual({ fired: false, reason: "not_yet" });
  });

  it("fires at T-48h when slots remain, notifying members who haven't RSVP'd", () => {
    fixture = seedCircle({
      memberCount: 3,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    // Only the organiser RSVPs in; the other 2 members never respond.
    rsvpIn(fixture.db, session.id, fixture.organiserId, now);

    const checkTime = new Date(session.startsAt.getTime() - 47 * 60 * 60 * 1000); // T-47h
    const result = checkFourthCallLevel1(fixture.db, session.id, checkTime);

    expect(result.fired).toBe(true);
    if (!result.fired) throw new Error("unreachable");
    expect(result.notifiedUserIds.sort()).toEqual([...fixture.memberIds].sort());
  });

  it("does not fire when the game is already full", () => {
    fixture = seedCircle({
      memberCount: 4,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    for (const uid of [fixture.organiserId, ...fixture.memberIds]) rsvpIn(fixture.db, session.id, uid, now);

    const checkTime = new Date(session.startsAt.getTime() - 47 * 60 * 60 * 1000);
    const result = checkFourthCallLevel1(fixture.db, session.id, checkTime);
    expect(result).toEqual({ fired: false, reason: "already_full" });
  });

  it("does not fire twice for the same session (idempotent on repeat views)", () => {
    fixture = seedCircle({
      memberCount: 3,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    rsvpIn(fixture.db, session.id, fixture.organiserId, now);

    const checkTime = new Date(session.startsAt.getTime() - 47 * 60 * 60 * 1000);
    const first = checkFourthCallLevel1(fixture.db, session.id, checkTime);
    const second = checkFourthCallLevel1(fixture.db, session.id, checkTime);

    expect(first.fired).toBe(true);
    expect(second).toEqual({ fired: false, reason: "already_notified" });
  });
});

describe("slotsForSession default", () => {
  it("defaults to 4 for a one-off session with no standing game", () => {
    expect(DEFAULT_SESSION_SLOTS).toBe(4);
  });
});

describe("realtime — rsvp and fourth_call events", () => {
  function capture() {
    const calls: { topic: string; type: string; fields: Record<string, unknown> }[] = [];
    __setRealtimeSenderForTests(async (topic, type, fields) => {
      calls.push({ topic, type, fields });
    });
    return calls;
  }

  it("rsvpIn broadcasts 'rsvp' to both the session and circle channels, after the write", () => {
    fixture = seedCircle({ memberCount: 2, standingGame: { weekday: 2, startTime: "20:00" } });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    const calls = capture();

    const outcome = rsvpIn(fixture.db, session.id, fixture.organiserId, now);
    expect(outcome.ok).toBe(true);

    const rsvpCalls = calls.filter((c) => c.type === "rsvp");
    expect(rsvpCalls).toHaveLength(2);
    expect(rsvpCalls.map((c) => c.topic).sort()).toEqual(
      [sessionChannel(session.id), circleChannel(fixture.circleId)].sort(),
    );
  });

  it("does not broadcast when rsvpIn is rejected (no state change)", () => {
    fixture = seedCircle({ memberCount: 2, standingGame: { weekday: 2, startTime: "20:00" } });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    const calls = capture();

    const outcome = rsvpIn(fixture.db, session.id, "not-a-member", now);
    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("rsvpOut broadcasts 'rsvp' to both channels on a confirmed dropout/promotion", () => {
    fixture = seedCircle({ memberCount: 2, standingGame: { weekday: 2, startTime: "20:00", slots: 1 } });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    rsvpIn(fixture.db, session.id, fixture.organiserId, now);
    rsvpIn(fixture.db, session.id, fixture.memberIds[0], now); // reserve
    const calls = capture();

    const outcome = rsvpOut(fixture.db, session.id, fixture.organiserId, now);
    expect(outcome).toEqual({ ok: true, status: "out", promotedUserId: fixture.memberIds[0] });

    const rsvpCalls = calls.filter((c) => c.type === "rsvp");
    expect(rsvpCalls).toHaveLength(2);
    expect(rsvpCalls.map((c) => c.topic).sort()).toEqual(
      [sessionChannel(session.id), circleChannel(fixture.circleId)].sort(),
    );
  });

  it("checkFourthCallLevel1 broadcasts 'fourth_call' to both channels only when it actually fires", () => {
    fixture = seedCircle({
      memberCount: 3,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-04T00:00:00.000Z"); // well over 48h before Tuesday 20:00
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    rsvpIn(fixture.db, session.id, fixture.organiserId, now);

    const tooEarly = capture();
    checkFourthCallLevel1(fixture.db, session.id, now);
    expect(tooEarly.filter((c) => c.type === "fourth_call")).toHaveLength(0);

    const atWindow = capture();
    const checkTime = new Date(session.startsAt.getTime() - 47 * 60 * 60 * 1000);
    const result = checkFourthCallLevel1(fixture.db, session.id, checkTime);
    expect(result.fired).toBe(true);

    const fourthCallCalls = atWindow.filter((c) => c.type === "fourth_call");
    expect(fourthCallCalls).toHaveLength(2);
    expect(fourthCallCalls.map((c) => c.topic).sort()).toEqual(
      [sessionChannel(session.id), circleChannel(fixture.circleId)].sort(),
    );
    expect(fourthCallCalls.every((c) => c.fields.level === 1)).toBe(true);
  });
});

describe("ensureSessionPlayedTransition — lazy played sweep", () => {
  it("leaves an upcoming session alone before startsAt + duration", () => {
    fixture = seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00", slots: 4 } });
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, new Date("2026-01-04T00:00:00.000Z"));

    const stillMidGame = new Date(session.startsAt.getTime() + 30 * 60 * 1000); // 30 of 90 minutes in
    const result = ensureSessionPlayedTransition(fixture.db, session.id, stillMidGame);

    expect(result?.status).toBe("upcoming");
    const row = fixture.db.select().from(sessions).where(eq(sessions.id, session.id)).get();
    expect(row?.status).toBe("upcoming");
  });

  it("flips to 'played' once startsAt + duration has passed", () => {
    fixture = seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00", slots: 4 } });
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, new Date("2026-01-04T00:00:00.000Z"));

    const afterFullTime = new Date(session.startsAt.getTime() + 90 * 60 * 1000 + 1000); // standing game default duration is 90 min
    const result = ensureSessionPlayedTransition(fixture.db, session.id, afterFullTime);

    expect(result?.status).toBe("played");
    const row = fixture.db.select().from(sessions).where(eq(sessions.id, session.id)).get();
    expect(row?.status).toBe("played");
  });

  it("is idempotent — a second sweep on an already-played session is a no-op", () => {
    fixture = seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00", slots: 4 } });
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, new Date("2026-01-04T00:00:00.000Z"));
    const afterFullTime = new Date(session.startsAt.getTime() + 91 * 60 * 1000);

    ensureSessionPlayedTransition(fixture.db, session.id, afterFullTime);
    const second = ensureSessionPlayedTransition(fixture.db, session.id, afterFullTime);
    expect(second?.status).toBe("played");
  });

  it("uses the product default duration (90 min) for a one-off session with no standing game", () => {
    fixture = seedCircle({ memberCount: 1 });
    const created = createOneOffSession(fixture.db, fixture.organiserId, {
      circleId: fixture.circleId,
      startsAt: new Date("2026-02-01T18:00:00.000Z"),
    });
    if (!created.ok) throw new Error("unreachable");

    expect(DEFAULT_SESSION_DURATION_MINUTES).toBe(90);
    const justBefore = new Date(created.value.startsAt.getTime() + DEFAULT_SESSION_DURATION_MINUTES * 60_000 - 1000);
    expect(ensureSessionPlayedTransition(fixture.db, created.value.id, justBefore)?.status).toBe("upcoming");

    const justAfter = new Date(created.value.startsAt.getTime() + DEFAULT_SESSION_DURATION_MINUTES * 60_000 + 1000);
    expect(ensureSessionPlayedTransition(fixture.db, created.value.id, justAfter)?.status).toBe("played");
  });

  it("getSessionSummary sweeps the played transition itself, so callers see it without a separate call", () => {
    fixture = seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00", slots: 4 } });
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, new Date("2026-01-04T00:00:00.000Z"));
    const afterFullTime = new Date(session.startsAt.getTime() + 91 * 60 * 1000);

    const summary = getSessionSummary(fixture.db, session.id, fixture.organiserId, afterFullTime);
    expect(summary?.session.status).toBe("played");
  });
});

describe("standing-game cost read model (design/DESIGN-AUDIT.md F4)", () => {
  it("getSessionSummary exposes null cost fields when the organiser hasn't set a price", () => {
    fixture = seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00", slots: 4 } });
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, new Date("2026-01-04T00:00:00.000Z"));

    const summary = getSessionSummary(fixture.db, session.id, fixture.organiserId);
    expect(summary?.costMinor).toBeNull();
    expect(summary?.costCurrency).toBe("GBP");
    expect(summary?.costPerHeadMinor).toBeNull();
  });

  it("computes floor(cost / slots) per head once a cost is set, matching tab.ts's remainder-to-payer rule", () => {
    fixture = seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00", slots: 4 } });
    fixture.db.update(standingGames).set({ costMinor: 3200 }).where(eq(standingGames.id, fixture.standingGameId!)).run();
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, new Date("2026-01-04T00:00:00.000Z"));

    const summary = getSessionSummary(fixture.db, session.id, fixture.organiserId);
    expect(summary?.costMinor).toBe(3200);
    expect(summary?.costPerHeadMinor).toBe(800); // 3200 / 4 divides evenly
  });

  it("a one-off session (no standing game) never has a cost", () => {
    fixture = seedCircle({ memberCount: 1 });
    const created = createOneOffSession(fixture.db, fixture.organiserId, { circleId: fixture.circleId, startsAt: new Date(Date.now() + DAY_MS) });
    if (!created.ok) throw new Error("unreachable");

    const summary = getSessionSummary(fixture.db, created.value.id, fixture.organiserId);
    expect(summary?.costMinor).toBeNull();
    expect(summary?.costPerHeadMinor).toBeNull();
  });
});

describe("rescheduleUpcomingSessionsForStandingGame", () => {
  const SUNDAY = new Date("2026-01-04T00:00:00.000Z"); // within the default 6-day RSVP window of the Tue session

  it("moves the materialised session to the new day and tells every RSVP'd player once", () => {
    fixture = seedCircle({ memberCount: 2, standingGame: { weekday: 2, startTime: "20:00" } }); // Tuesday
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);
    expect(session.startsAt.toISOString()).toBe("2026-01-06T20:00:00.000Z"); // Tue 6 Jan
    rsvpIn(fixture.db, session.id, fixture.organiserId, SUNDAY);
    rsvpIn(fixture.db, session.id, fixture.memberIds[0], SUNDAY);

    // Organiser moves the fixture to Saturday, then the edit reschedules.
    updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { weekday: 6 });
    const result = rescheduleUpcomingSessionsForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);

    // Same session row moved (RSVPs ride along), no duplicate minted.
    const moved = fixture.db.select().from(sessions).where(eq(sessions.id, session.id)).get();
    expect(moved?.startsAt.toISOString()).toBe("2026-01-10T20:00:00.000Z"); // Sat 10 Jan
    const all = fixture.db.select().from(sessions).where(eq(sessions.standingGameId, fixture.standingGameId!)).all();
    expect(all).toHaveLength(1);

    expect(result.movedSessionIds).toEqual([session.id]);
    expect(result.notifiedUserIds.sort()).toEqual([fixture.organiserId, fixture.memberIds[0]].sort());
    // A four of 4 with only 2 in never fired a fill notification, so every
    // session_rescheduled: the dedicated move notice, one per RSVP'd player.
    const notifs = fixture.db.select().from(notifications).where(eq(notifications.type, "session_rescheduled")).all();
    expect(notifs).toHaveLength(2);
    expect(notifs.every((n) => (n.payload as { sessionId: string }).sessionId === session.id)).toBe(true);
  });

  it("notifies reserve players too, not just held slots", () => {
    fixture = seedCircle({ memberCount: 2, standingGame: { weekday: 2, startTime: "20:00", slots: 2 } });
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);
    rsvpIn(fixture.db, session.id, fixture.organiserId, SUNDAY); // in
    rsvpIn(fixture.db, session.id, fixture.memberIds[0], SUNDAY); // in (fills the two slots)
    const reserve = rsvpIn(fixture.db, session.id, fixture.memberIds[1], SUNDAY); // reserve
    expect(reserve).toMatchObject({ ok: true, status: "reserve" });

    updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { weekday: 6 });
    const result = rescheduleUpcomingSessionsForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);

    expect(result.notifiedUserIds.sort()).toEqual(
      [fixture.organiserId, fixture.memberIds[0], fixture.memberIds[1]].sort(),
    );
  });

  it("follows a venue change even when the day and time are unchanged", () => {
    fixture = seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);
    rsvpIn(fixture.db, session.id, fixture.organiserId, SUNDAY);

    const newVenue = fixture.db.insert(venues).values({ name: "Other Court", timezone: "Europe/London" }).returning().get();
    updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { venueId: newVenue.id });
    const result = rescheduleUpcomingSessionsForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);

    const moved = fixture.db.select().from(sessions).where(eq(sessions.id, session.id)).get();
    expect(moved?.venueId).toBe(newVenue.id);
    expect(moved?.startsAt.toISOString()).toBe("2026-01-06T20:00:00.000Z"); // slot unchanged
    expect(result.movedSessionIds).toEqual([session.id]);
    expect(result.notifiedUserIds).toEqual([fixture.organiserId]);
  });

  it("is a no-op for an edit that leaves the slot and venue alone (e.g. a cost-only change)", () => {
    fixture = seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    const session = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);
    rsvpIn(fixture.db, session.id, fixture.organiserId, SUNDAY);

    updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { costMinor: 3200 });
    const result = rescheduleUpcomingSessionsForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);

    expect(result.movedSessionIds).toEqual([]);
    expect(result.notifiedUserIds).toEqual([]);
    const still = fixture.db.select().from(sessions).where(eq(sessions.id, session.id)).get();
    expect(still?.startsAt.toISOString()).toBe("2026-01-06T20:00:00.000Z");
    const notifs = fixture.db.select().from(notifications).where(eq(notifications.type, "session_rescheduled")).all();
    expect(notifs).toHaveLength(0);
  });

  it("never moves a past or played session", () => {
    fixture = seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    // A played instance from the previous week must stay put.
    const past = fixture.db
      .insert(sessions)
      .values({
        standingGameId: fixture.standingGameId!,
        circleId: fixture.circleId,
        venueId: fixture.venueId,
        startsAt: new Date("2025-12-30T20:00:00.000Z"), // prev Tue, already played
        status: "played",
      })
      .returning()
      .get();
    const upcoming = ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);

    updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { weekday: 6 });
    const result = rescheduleUpcomingSessionsForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);

    const pastAfter = fixture.db.select().from(sessions).where(eq(sessions.id, past.id)).get();
    expect(pastAfter?.startsAt.toISOString()).toBe("2025-12-30T20:00:00.000Z");
    expect(pastAfter?.status).toBe("played");
    expect(result.movedSessionIds).toEqual([upcoming.id]);
  });
});
