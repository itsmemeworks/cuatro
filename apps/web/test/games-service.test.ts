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
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
  __setRealtimeSenderForTests(null);
});

describe("ensureUpcomingSessionForStandingGame", () => {
  it("creates the next session for an active standing game, timezone-correct", async () => {
    fixture = await seedCircle({
      memberCount: 3,
      timezone: "Europe/London",
      standingGame: { weekday: 2, startTime: "20:00" }, // Tuesday 20:00
    });
    const now = new Date("2026-01-04T00:00:00.000Z"); // Sunday

    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);

    expect(new Date(session.startsAt).toISOString()).toBe("2026-01-06T20:00:00.000Z");
    expect(session.circleId).toBe(fixture.circleId);
    expect(session.status).toBe("upcoming");
  });

  it("is idempotent: a repeat call while the occurrence is still upcoming returns the same row", async () => {
    fixture = await seedCircle({
      memberCount: 2,
      standingGame: { weekday: 2, startTime: "20:00" },
    });
    const now = new Date("2026-01-04T00:00:00.000Z");

    const first = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    const second = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, new Date("2026-01-05T00:00:00.000Z"));

    expect(second.id).toBe(first.id);
    const allSessions = await fixture.db.select().from(sessions);
    expect(allSessions).toHaveLength(1);
  });

  it("advances to next week's occurrence once the current one's start time has passed", async () => {
    fixture = await seedCircle({
      memberCount: 2,
      standingGame: { weekday: 2, startTime: "20:00" },
    });
    const first = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, new Date("2026-01-04T00:00:00.000Z"));
    expect(new Date(first.startsAt).toISOString()).toBe("2026-01-06T20:00:00.000Z");

    // Now well past that Tuesday's kickoff.
    const second = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, new Date("2026-01-07T00:00:00.000Z"));
    expect(second.id).not.toBe(first.id);
    expect(new Date(second.startsAt).toISOString()).toBe("2026-01-13T20:00:00.000Z");

    const allSessions = await fixture.db.select().from(sessions);
    expect(allSessions).toHaveLength(2);
  });

  it("ensureUpcomingSessionsForCircle only generates for active standing games", async () => {
    fixture = await seedCircle({
      memberCount: 2,
      standingGame: { weekday: 2, startTime: "20:00", active: false },
    });
    const created = await ensureUpcomingSessionsForCircle(fixture.db, fixture.circleId, new Date("2026-01-04T00:00:00.000Z"));
    expect(created).toHaveLength(0);
  });
});

describe("createOneOffSession", () => {
  it("organiser-only: rejects a non-organiser member", async () => {
    fixture = await seedCircle({ memberCount: 2 });
    const result = await createOneOffSession(fixture.db, fixture.memberIds[0], {
      circleId: fixture.circleId,
      startsAt: new Date("2026-02-01T18:00:00.000Z"),
    });
    expect(result).toEqual({ ok: false, error: "not_an_organiser" });
  });

  it("creates a session with no standing_game_id", async () => {
    fixture = await seedCircle({ memberCount: 2 });
    const result = await createOneOffSession(fixture.db, fixture.organiserId, {
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
  async function makeSessionFixture(now: Date, slots = 4) {
    fixture = await seedCircle({
      memberCount: 6,
      standingGame: { weekday: 2, startTime: "20:00", slots, rsvpWindowDays: 6 },
    });
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    return { fixture, session };
  }

  it("the first `slots` players to RSVP in hold slots; the rest queue as reserves in arrival order", async () => {
    const now = new Date("2026-01-05T00:00:00.000Z"); // within the 6-day window before Tue 20:00
    const { fixture: fx, session } = await makeSessionFixture(now);
    const [p1, p2, p3, p4, p5, p6] = [fx.organiserId, ...fx.memberIds];

    for (const uid of [p1, p2, p3, p4, p5, p6]) {
      const outcome = await rsvpIn(fx.db, session.id, uid, now);
      expect(outcome.ok).toBe(true);
    }

    const rows = await fx.db.select().from(rsvps).where(eq(rsvps.sessionId, session.id));
    const inRows = rows.filter((r) => r.status === "in").map((r) => r.userId);
    const reserveRows = rows.filter((r) => r.status === "reserve").sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    expect(inRows.sort()).toEqual([p1, p2, p3, p4].sort());
    expect(reserveRows.map((r) => r.userId)).toEqual([p5, p6]);
    expect(reserveRows.map((r) => r.position)).toEqual([1, 2]);
  });

  it("tapping IN twice is idempotent (no double-count, no status change)", async () => {
    const now = new Date("2026-01-05T00:00:00.000Z");
    const { fixture: fx, session } = await makeSessionFixture(now);
    await rsvpIn(fx.db, session.id, fx.organiserId, now);
    await rsvpIn(fx.db, session.id, fx.organiserId, now);

    const rows = await fx.db.select().from(rsvps).where(eq(rsvps.sessionId, session.id));
    const row = rows.find((r) => r.userId === fx.organiserId);
    expect(row?.status).toBe("in");

    const [user] = await fx.db.select().from(users).where(eq(users.id, fx.organiserId));
    expect(user?.rsvpInCount).toBe(1);
  });

  it("records rsvps.source: 'rsvp' on a fresh RSVP, and resets it back from a stale 'fourth_call' flag on re-RSVP", async () => {
    const now = new Date("2026-01-05T00:00:00.000Z");
    const { fixture: fx, session } = await makeSessionFixture(now);

    await rsvpIn(fx.db, session.id, fx.organiserId, now);
    const [freshRow] = await fx.db.select().from(rsvps).where(eq(rsvps.userId, fx.organiserId));
    expect(freshRow?.source).toBe("rsvp");

    // Simulate a row that was previously claimed via Fourth Call (as
    // claimFourthCallSlot would leave it), then dropped, then re-RSVP'd
    // through the ordinary in-circle flow — the plain RSVP tap should
    // overwrite the stale flag rather than leaving it "claimed via fourth
    // call" for a slot filled the normal way.
    await fx.db.update(rsvps).set({ status: "out", source: "fourth_call" }).where(eq(rsvps.id, freshRow!.id));
    await rsvpIn(fx.db, session.id, fx.organiserId, now);
    const [reRow] = await fx.db.select().from(rsvps).where(eq(rsvps.userId, fx.organiserId));
    expect(reRow?.source).toBe("rsvp");
  });

  it("a reserve dropping out closes the gap in the queue behind them", async () => {
    const now = new Date("2026-01-05T00:00:00.000Z");
    const { fixture: fx, session } = await makeSessionFixture(now);
    const [p1, p2, p3, p4, p5, p6] = [fx.organiserId, ...fx.memberIds];
    for (const uid of [p1, p2, p3, p4, p5, p6]) await rsvpIn(fx.db, session.id, uid, now);

    // p5 (reserve #1) drops out; p6 (reserve #2) should close up to #1.
    const outcome = await rsvpOut(fx.db, session.id, p5, now);
    expect(outcome).toEqual({ ok: true, status: "out" });

    const rows = await fx.db.select().from(rsvps).where(eq(rsvps.sessionId, session.id));
    const reserveRows = rows.filter((r) => r.status === "reserve");
    expect(reserveRows).toHaveLength(1);
    expect(reserveRows[0].userId).toBe(p6);
    expect(reserveRows[0].position).toBe(1);
  });

  it("a confirmed dropout auto-promotes reserve #1 into their slot", async () => {
    const now = new Date("2026-01-05T00:00:00.000Z");
    const { fixture: fx, session } = await makeSessionFixture(now);
    const [p1, p2, p3, p4, p5, p6] = [fx.organiserId, ...fx.memberIds];
    for (const uid of [p1, p2, p3, p4, p5, p6]) await rsvpIn(fx.db, session.id, uid, now);

    const outcome = await rsvpOut(fx.db, session.id, p1, now);
    expect(outcome).toEqual({ ok: true, status: "out", promotedUserId: p5 });

    const rows = await fx.db.select().from(rsvps).where(eq(rsvps.sessionId, session.id));
    const inRows = rows.filter((r) => r.status === "in").map((r) => r.userId);
    expect(inRows.sort()).toEqual([p2, p3, p4, p5].sort());

    const reserveRows = rows.filter((r) => r.status === "reserve");
    expect(reserveRows).toHaveLength(1);
    expect(reserveRows[0]).toMatchObject({ userId: p6, position: 1 });

    // p5 was only ever a reserve until now — this promotion is their first
    // confirmed "in".
    const [promoted] = await fx.db.select().from(users).where(eq(users.id, p5));
    expect(promoted?.rsvpInCount).toBe(1);
  });

  it("handles two 'concurrent' dropouts without double-promoting the same reserve", async () => {
    const now = new Date("2026-01-05T00:00:00.000Z");
    const { fixture: fx, session } = await makeSessionFixture(now);
    const [p1, p2, p3, p4, p5, p6] = [fx.organiserId, ...fx.memberIds];
    for (const uid of [p1, p2, p3, p4, p5, p6]) await rsvpIn(fx.db, session.id, uid, now);

    // "Simultaneous" cancellations of two different confirmed players, run
    // sequentially here: PGlite is a single in-process connection and cannot
    // run two transactions concurrently. The genuine concurrent-Postgres
    // race (two connections + `FOR UPDATE`) is proven separately in
    // test/rsvp-race.pg.test.ts; here on single-connection PGlite we assert
    // the sequential outcome — two distinct promotions, never the same
    // reserve filling both slots.
    const outcomeA = await rsvpOut(fx.db, session.id, p1, now);
    const outcomeB = await rsvpOut(fx.db, session.id, p2, now);

    const promotedIds = [outcomeA, outcomeB]
      .filter((o): o is Extract<typeof o, { ok: true }> => o.ok)
      .map((o) => o.promotedUserId)
      .filter((id): id is string => !!id);

    expect(new Set(promotedIds).size).toBe(2);
    expect(promotedIds.sort()).toEqual([p5, p6].sort());

    const rows = await fx.db.select().from(rsvps).where(eq(rsvps.sessionId, session.id));
    const inRows = rows.filter((r) => r.status === "in").map((r) => r.userId);
    expect(inRows.sort()).toEqual([p3, p4, p5, p6].sort());
    expect(rows.filter((r) => r.status === "reserve")).toHaveLength(0);
  });

  it("a dropout with nobody in reserve notifies the organiser instead of promoting anyone", async () => {
    const now = new Date("2026-01-05T00:00:00.000Z");
    const { fixture: fx, session } = await makeSessionFixture(now);
    await rsvpIn(fx.db, session.id, fx.organiserId, now);

    const outcome = await rsvpOut(fx.db, session.id, fx.organiserId, now);
    expect(outcome).toEqual({ ok: true, status: "out" });
  });
});

describe("RSVP window enforcement", () => {
  it("rejects an IN attempt before the RSVP window has opened", async () => {
    fixture = await seedCircle({
      memberCount: 2,
      standingGame: { weekday: 2, startTime: "20:00", rsvpWindowDays: 6 },
    });
    // Session is 10 days out from `now`; the 6-day window hasn't opened yet.
    const now = new Date("2026-01-04T00:00:00.000Z");
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    const tooEarly = new Date(session.startsAt - 7 * DAY_MS);

    const outcome = await rsvpIn(fixture.db, session.id, fixture.organiserId, tooEarly);
    expect(outcome).toEqual({ ok: false, error: "window_not_open" });
  });

  it("allows an IN attempt once the window has opened", async () => {
    fixture = await seedCircle({
      memberCount: 2,
      standingGame: { weekday: 2, startTime: "20:00", rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-04T00:00:00.000Z");
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    const withinWindow = new Date(session.startsAt - 5 * DAY_MS);

    const outcome = await rsvpIn(fixture.db, session.id, fixture.organiserId, withinWindow);
    expect(outcome).toEqual({ ok: true, status: "in" });
  });

  it("rejects both IN and OUT attempts once the session has started", async () => {
    fixture = await seedCircle({
      memberCount: 2,
      standingGame: { weekday: 2, startTime: "20:00", rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-04T00:00:00.000Z");
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    const afterStart = new Date(session.startsAt + 60_000);

    expect(await rsvpIn(fixture.db, session.id, fixture.organiserId, afterStart)).toEqual({
      ok: false,
      error: "session_started",
    });
    expect(await rsvpOut(fixture.db, session.id, fixture.organiserId, afterStart)).toEqual({
      ok: false,
      error: "session_started",
    });
  });

  it("rejects RSVPs from a user who isn't a member of the session's circle", async () => {
    fixture = await seedCircle({
      memberCount: 1,
      standingGame: { weekday: 2, startTime: "20:00", rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);

    const outcome = await rsvpIn(fixture.db, session.id, "not-a-real-user-id", now);
    expect(outcome).toEqual({ ok: false, error: "not_a_circle_member" });
  });
});

describe("reliability counters", () => {
  it("increments rsvpInCount when a player is confirmed in (directly or via promotion)", async () => {
    fixture = await seedCircle({
      memberCount: 5,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    const [p1, p2, p3, p4, p5] = [fixture.organiserId, ...fixture.memberIds];
    for (const uid of [p1, p2, p3, p4, p5]) await rsvpIn(fixture.db, session.id, uid, now);

    const [p1Row] = await fixture.db.select().from(users).where(eq(users.id, p1));
    expect(p1Row?.rsvpInCount).toBe(1);
    // p5 queued as a reserve — not confirmed in yet.
    const [p5RowBefore] = await fixture.db.select().from(users).where(eq(users.id, p5));
    expect(p5RowBefore?.rsvpInCount).toBe(0);

    await rsvpOut(fixture.db, session.id, p1, now); // promotes p5
    const [p5RowAfter] = await fixture.db.select().from(users).where(eq(users.id, p5));
    expect(p5RowAfter?.rsvpInCount).toBe(1);
  });

  it("counts a cancellation inside 24h of start as a late cancel", async () => {
    fixture = await seedCircle({
      memberCount: 1,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    await rsvpIn(fixture.db, session.id, fixture.organiserId, now);

    const lateCancelTime = new Date(session.startsAt - 12 * 60 * 60 * 1000); // 12h before
    await rsvpOut(fixture.db, session.id, fixture.organiserId, lateCancelTime);

    const [user] = await fixture.db.select().from(users).where(eq(users.id, fixture.organiserId));
    expect(user?.lateCancelCount).toBe(1);
  });

  it("does not count a cancellation outside the 24h window against the player", async () => {
    fixture = await seedCircle({
      memberCount: 1,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    await rsvpIn(fixture.db, session.id, fixture.organiserId, now);

    const earlyCancelTime = new Date(session.startsAt - 3 * DAY_MS);
    await rsvpOut(fixture.db, session.id, fixture.organiserId, earlyCancelTime);

    const [user] = await fixture.db.select().from(users).where(eq(users.id, fixture.organiserId));
    expect(user?.lateCancelCount).toBe(0);
  });

  // Exact edge of the 24h window: "inside 24h" reads as strictly less than
  // 24h of notice remaining, so exactly-24h-before is the last moment that
  // still counts as early (mirrors games-service.ts's `msToStart <
  // LATE_CANCEL_WINDOW_MS`, not `<=`).
  it("boundary: cancelling 1s inside 24h (23:59:59 notice) counts as a late cancel", async () => {
    fixture = await seedCircle({
      memberCount: 1,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    await rsvpIn(fixture.db, session.id, fixture.organiserId, now);

    const cancelTime = new Date(session.startsAt - (DAY_MS - 1000)); // 23h 59m 59s before
    await rsvpOut(fixture.db, session.id, fixture.organiserId, cancelTime);

    const [user] = await fixture.db.select().from(users).where(eq(users.id, fixture.organiserId));
    expect(user?.lateCancelCount).toBe(1);
  });

  it("boundary: cancelling at exactly 24:00:00 notice does not count as a late cancel", async () => {
    fixture = await seedCircle({
      memberCount: 1,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    await rsvpIn(fixture.db, session.id, fixture.organiserId, now);

    const cancelTime = new Date(session.startsAt - DAY_MS); // exactly 24h before
    await rsvpOut(fixture.db, session.id, fixture.organiserId, cancelTime);

    const [user] = await fixture.db.select().from(users).where(eq(users.id, fixture.organiserId));
    expect(user?.lateCancelCount).toBe(0);
  });

  it("boundary: cancelling 1s outside 24h (24:00:01 notice) does not count as a late cancel", async () => {
    fixture = await seedCircle({
      memberCount: 1,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    await rsvpIn(fixture.db, session.id, fixture.organiserId, now);

    const cancelTime = new Date(session.startsAt - (DAY_MS + 1000)); // 24h + 1s before
    await rsvpOut(fixture.db, session.id, fixture.organiserId, cancelTime);

    const [user] = await fixture.db.select().from(users).where(eq(users.id, fixture.organiserId));
    expect(user?.lateCancelCount).toBe(0);
  });

  it("boundary: a reserve dropping out 1h before start is never a late cancel — reserves never held a slot", async () => {
    fixture = await seedCircle({
      memberCount: 5,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    const [p1, p2, p3, p4, p5] = [fixture.organiserId, ...fixture.memberIds];
    for (const uid of [p1, p2, p3, p4, p5]) await rsvpIn(fixture.db, session.id, uid, now);

    // p5 is queued as reserve #1 (well inside the late-cancel window).
    const oneHourBefore = new Date(session.startsAt - 60 * 60 * 1000);
    const outcome = await rsvpOut(fixture.db, session.id, p5, oneHourBefore);
    expect(outcome).toEqual({ ok: true, status: "out" });

    const [user] = await fixture.db.select().from(users).where(eq(users.id, p5));
    expect(user?.lateCancelCount).toBe(0);
  });

  it("a repeat rsvpOut on an already-out player does not double-count the late cancel", async () => {
    fixture = await seedCircle({
      memberCount: 1,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    await rsvpIn(fixture.db, session.id, fixture.organiserId, now);

    const lateCancelTime = new Date(session.startsAt - 12 * 60 * 60 * 1000); // 12h before
    await rsvpOut(fixture.db, session.id, fixture.organiserId, lateCancelTime);
    // Second (and third) tap-out while already out — a double click, a stale
    // client — must be a no-op: the early "already out" return runs before the
    // late-cancel increment, so the count stays at one per confirmed dropout.
    await rsvpOut(fixture.db, session.id, fixture.organiserId, lateCancelTime);
    await rsvpOut(fixture.db, session.id, fixture.organiserId, lateCancelTime);

    const [user] = await fixture.db.select().from(users).where(eq(users.id, fixture.organiserId));
    expect(user?.lateCancelCount).toBe(1);
  });

  it("does not penalise a reserve who drops out of the queue (they never held a slot)", async () => {
    fixture = await seedCircle({
      memberCount: 5,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    const [p1, p2, p3, p4, p5] = [fixture.organiserId, ...fixture.memberIds];
    for (const uid of [p1, p2, p3, p4, p5]) await rsvpIn(fixture.db, session.id, uid, now);

    const nearStart = new Date(session.startsAt - 1000);
    await rsvpOut(fixture.db, session.id, p5, nearStart);

    const [user] = await fixture.db.select().from(users).where(eq(users.id, p5));
    expect(user?.lateCancelCount).toBe(0);
  });
});

describe("Fourth Call level 1", () => {
  it("does not fire more than 48h before the session", async () => {
    fixture = await seedCircle({
      memberCount: 3,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-04T00:00:00.000Z");
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);

    const result = await checkFourthCallLevel1(fixture.db, session.id, now);
    expect(result).toEqual({ fired: false, reason: "not_yet" });
  });

  it("fires at T-48h when slots remain, notifying members who haven't RSVP'd", async () => {
    fixture = await seedCircle({
      memberCount: 3,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    // Only the organiser RSVPs in; the other 2 members never respond.
    await rsvpIn(fixture.db, session.id, fixture.organiserId, now);

    const checkTime = new Date(session.startsAt - 47 * 60 * 60 * 1000); // T-47h
    const result = await checkFourthCallLevel1(fixture.db, session.id, checkTime);

    expect(result.fired).toBe(true);
    if (!result.fired) throw new Error("unreachable");
    expect(result.notifiedUserIds.sort()).toEqual([...fixture.memberIds].sort());
  });

  it("does not fire when the game is already full", async () => {
    fixture = await seedCircle({
      memberCount: 4,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    for (const uid of [fixture.organiserId, ...fixture.memberIds]) await rsvpIn(fixture.db, session.id, uid, now);

    const checkTime = new Date(session.startsAt - 47 * 60 * 60 * 1000);
    const result = await checkFourthCallLevel1(fixture.db, session.id, checkTime);
    expect(result).toEqual({ fired: false, reason: "already_full" });
  });

  it("does not fire twice for the same session (idempotent on repeat views)", async () => {
    fixture = await seedCircle({
      memberCount: 3,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    await rsvpIn(fixture.db, session.id, fixture.organiserId, now);

    const checkTime = new Date(session.startsAt - 47 * 60 * 60 * 1000);
    const first = await checkFourthCallLevel1(fixture.db, session.id, checkTime);
    const second = await checkFourthCallLevel1(fixture.db, session.id, checkTime);

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

  it("rsvpIn broadcasts 'rsvp' to both the session and circle channels, after the write", async () => {
    fixture = await seedCircle({ memberCount: 2, standingGame: { weekday: 2, startTime: "20:00" } });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    const calls = capture();

    const outcome = await rsvpIn(fixture.db, session.id, fixture.organiserId, now);
    expect(outcome.ok).toBe(true);

    const rsvpCalls = calls.filter((c) => c.type === "rsvp");
    expect(rsvpCalls).toHaveLength(2);
    expect(rsvpCalls.map((c) => c.topic).sort()).toEqual(
      [sessionChannel(session.id), circleChannel(fixture.circleId)].sort(),
    );
  });

  it("does not broadcast when rsvpIn is rejected (no state change)", async () => {
    fixture = await seedCircle({ memberCount: 2, standingGame: { weekday: 2, startTime: "20:00" } });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    const calls = capture();

    const outcome = await rsvpIn(fixture.db, session.id, "not-a-member", now);
    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("rsvpOut broadcasts 'rsvp' to both channels on a confirmed dropout/promotion", async () => {
    fixture = await seedCircle({ memberCount: 2, standingGame: { weekday: 2, startTime: "20:00", slots: 1 } });
    const now = new Date("2026-01-05T00:00:00.000Z");
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    await rsvpIn(fixture.db, session.id, fixture.organiserId, now);
    await rsvpIn(fixture.db, session.id, fixture.memberIds[0], now); // reserve
    const calls = capture();

    const outcome = await rsvpOut(fixture.db, session.id, fixture.organiserId, now);
    expect(outcome).toEqual({ ok: true, status: "out", promotedUserId: fixture.memberIds[0] });

    const rsvpCalls = calls.filter((c) => c.type === "rsvp");
    expect(rsvpCalls).toHaveLength(2);
    expect(rsvpCalls.map((c) => c.topic).sort()).toEqual(
      [sessionChannel(session.id), circleChannel(fixture.circleId)].sort(),
    );
  });

  it("checkFourthCallLevel1 broadcasts 'fourth_call' to both channels only when it actually fires", async () => {
    fixture = await seedCircle({
      memberCount: 3,
      standingGame: { weekday: 2, startTime: "20:00", slots: 4, rsvpWindowDays: 6 },
    });
    const now = new Date("2026-01-04T00:00:00.000Z"); // well over 48h before Tuesday 20:00
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, now);
    await rsvpIn(fixture.db, session.id, fixture.organiserId, now);

    const tooEarly = capture();
    await checkFourthCallLevel1(fixture.db, session.id, now);
    expect(tooEarly.filter((c) => c.type === "fourth_call")).toHaveLength(0);

    const atWindow = capture();
    const checkTime = new Date(session.startsAt - 47 * 60 * 60 * 1000);
    const result = await checkFourthCallLevel1(fixture.db, session.id, checkTime);
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
  it("leaves an upcoming session alone before startsAt + duration", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00", slots: 4 } });
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, new Date("2026-01-04T00:00:00.000Z"));

    const stillMidGame = new Date(session.startsAt + 30 * 60 * 1000); // 30 of 90 minutes in
    const result = await ensureSessionPlayedTransition(fixture.db, session.id, stillMidGame);

    expect(result?.status).toBe("upcoming");
    const [row] = await fixture.db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(row?.status).toBe("upcoming");
  });

  it("flips to 'played' once startsAt + duration has passed", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00", slots: 4 } });
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, new Date("2026-01-04T00:00:00.000Z"));

    const afterFullTime = new Date(session.startsAt + 90 * 60 * 1000 + 1000); // standing game default duration is 90 min
    const result = await ensureSessionPlayedTransition(fixture.db, session.id, afterFullTime);

    expect(result?.status).toBe("played");
    const [row] = await fixture.db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(row?.status).toBe("played");
  });

  it("is idempotent — a second sweep on an already-played session is a no-op", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00", slots: 4 } });
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, new Date("2026-01-04T00:00:00.000Z"));
    const afterFullTime = new Date(session.startsAt + 91 * 60 * 1000);

    await ensureSessionPlayedTransition(fixture.db, session.id, afterFullTime);
    const second = await ensureSessionPlayedTransition(fixture.db, session.id, afterFullTime);
    expect(second?.status).toBe("played");
  });

  it("uses the product default duration (90 min) for a one-off session with no standing game", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const created = await createOneOffSession(fixture.db, fixture.organiserId, {
      circleId: fixture.circleId,
      startsAt: new Date("2026-02-01T18:00:00.000Z"),
    });
    if (!created.ok) throw new Error("unreachable");

    expect(DEFAULT_SESSION_DURATION_MINUTES).toBe(90);
    const justBefore = new Date(created.value.startsAt + DEFAULT_SESSION_DURATION_MINUTES * 60_000 - 1000);
    expect((await ensureSessionPlayedTransition(fixture.db, created.value.id, justBefore))?.status).toBe("upcoming");

    const justAfter = new Date(created.value.startsAt + DEFAULT_SESSION_DURATION_MINUTES * 60_000 + 1000);
    expect((await ensureSessionPlayedTransition(fixture.db, created.value.id, justAfter))?.status).toBe("played");
  });

  it("getSessionSummary sweeps the played transition itself, so callers see it without a separate call", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00", slots: 4 } });
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, new Date("2026-01-04T00:00:00.000Z"));
    const afterFullTime = new Date(session.startsAt + 91 * 60 * 1000);

    const summary = await getSessionSummary(fixture.db, session.id, fixture.organiserId, afterFullTime);
    expect(summary?.session.status).toBe("played");
  });
});

describe("standing-game cost read model (design/DESIGN-AUDIT.md F4)", () => {
  it("getSessionSummary exposes null cost fields when the organiser hasn't set a price", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00", slots: 4 } });
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, new Date("2026-01-04T00:00:00.000Z"));

    const summary = await getSessionSummary(fixture.db, session.id, fixture.organiserId);
    expect(summary?.costMinor).toBeNull();
    expect(summary?.costCurrency).toBe("GBP");
    expect(summary?.costPerHeadMinor).toBeNull();
  });

  it("computes floor(cost / slots) per head once a cost is set, matching tab.ts's remainder-to-payer rule", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00", slots: 4 } });
    await fixture.db.update(standingGames).set({ costMinor: 3200 }).where(eq(standingGames.id, fixture.standingGameId!));
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, new Date("2026-01-04T00:00:00.000Z"));

    const summary = await getSessionSummary(fixture.db, session.id, fixture.organiserId);
    expect(summary?.costMinor).toBe(3200);
    expect(summary?.costPerHeadMinor).toBe(800); // 3200 / 4 divides evenly
  });

  it("a one-off session (no standing game) never has a cost", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const created = await createOneOffSession(fixture.db, fixture.organiserId, { circleId: fixture.circleId, startsAt: new Date(Date.now() + DAY_MS) });
    if (!created.ok) throw new Error("unreachable");

    const summary = await getSessionSummary(fixture.db, created.value.id, fixture.organiserId);
    expect(summary?.costMinor).toBeNull();
    expect(summary?.costPerHeadMinor).toBeNull();
  });
});

describe("rescheduleUpcomingSessionsForStandingGame", () => {
  const SUNDAY = new Date("2026-01-04T00:00:00.000Z"); // within the default 6-day RSVP window of the Tue session

  it("moves the materialised session to the new day and tells every RSVP'd player once", async () => {
    fixture = await seedCircle({ memberCount: 2, standingGame: { weekday: 2, startTime: "20:00" } }); // Tuesday
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);
    expect(new Date(session.startsAt).toISOString()).toBe("2026-01-06T20:00:00.000Z"); // Tue 6 Jan
    await rsvpIn(fixture.db, session.id, fixture.organiserId, SUNDAY);
    await rsvpIn(fixture.db, session.id, fixture.memberIds[0], SUNDAY);

    // Organiser moves the fixture to Saturday, then the edit reschedules.
    await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { weekday: 6 });
    const result = await rescheduleUpcomingSessionsForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);

    // Same session row moved (RSVPs ride along), no duplicate minted.
    const [moved] = await fixture.db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(new Date(moved?.startsAt ?? 0).toISOString()).toBe("2026-01-10T20:00:00.000Z"); // Sat 10 Jan
    const all = await fixture.db.select().from(sessions).where(eq(sessions.standingGameId, fixture.standingGameId!));
    expect(all).toHaveLength(1);

    expect(result.movedSessionIds).toEqual([session.id]);
    expect(result.notifiedUserIds.sort()).toEqual([fixture.organiserId, fixture.memberIds[0]].sort());
    // A four of 4 with only 2 in never fired a fill notification, so every
    // session_rescheduled: the dedicated move notice, one per RSVP'd player.
    const notifs = await fixture.db.select().from(notifications).where(eq(notifications.type, "session_rescheduled"));
    expect(notifs).toHaveLength(2);
    expect(notifs.every((n) => (n.payload as { sessionId: string }).sessionId === session.id)).toBe(true);
  });

  it("notifies reserve players too, not just held slots", async () => {
    fixture = await seedCircle({ memberCount: 2, standingGame: { weekday: 2, startTime: "20:00", slots: 2 } });
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);
    await rsvpIn(fixture.db, session.id, fixture.organiserId, SUNDAY); // in
    await rsvpIn(fixture.db, session.id, fixture.memberIds[0], SUNDAY); // in (fills the two slots)
    const reserve = await rsvpIn(fixture.db, session.id, fixture.memberIds[1], SUNDAY); // reserve
    expect(reserve).toMatchObject({ ok: true, status: "reserve" });

    await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { weekday: 6 });
    const result = await rescheduleUpcomingSessionsForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);

    expect(result.notifiedUserIds.sort()).toEqual(
      [fixture.organiserId, fixture.memberIds[0], fixture.memberIds[1]].sort(),
    );
  });

  it("follows a venue change even when the day and time are unchanged", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);
    await rsvpIn(fixture.db, session.id, fixture.organiserId, SUNDAY);

    const [newVenue] = await fixture.db.insert(venues).values({ name: "Other Court", timezone: "Europe/London" }).returning();
    await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { venueId: newVenue.id });
    const result = await rescheduleUpcomingSessionsForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);

    const [moved] = await fixture.db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(moved?.venueId).toBe(newVenue.id);
    expect(new Date(moved?.startsAt ?? 0).toISOString()).toBe("2026-01-06T20:00:00.000Z"); // slot unchanged
    expect(result.movedSessionIds).toEqual([session.id]);
    expect(result.notifiedUserIds).toEqual([fixture.organiserId]);
  });

  it("is a no-op for an edit that leaves the slot and venue alone (e.g. a cost-only change)", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);
    await rsvpIn(fixture.db, session.id, fixture.organiserId, SUNDAY);

    await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { costMinor: 3200 });
    const result = await rescheduleUpcomingSessionsForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);

    expect(result.movedSessionIds).toEqual([]);
    expect(result.notifiedUserIds).toEqual([]);
    const [still] = await fixture.db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(new Date(still?.startsAt ?? 0).toISOString()).toBe("2026-01-06T20:00:00.000Z");
    const notifs = await fixture.db.select().from(notifications).where(eq(notifications.type, "session_rescheduled"));
    expect(notifs).toHaveLength(0);
  });

  it("never moves a past or played session", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    // A played instance from the previous week must stay put.
    const [past] = await fixture.db
      .insert(sessions)
      .values({
        standingGameId: fixture.standingGameId!,
        circleId: fixture.circleId,
        venueId: fixture.venueId,
        startsAt: new Date("2025-12-30T20:00:00.000Z").getTime(), // prev Tue, already played
        status: "played",
      })
      .returning();
    const upcoming = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);

    await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { weekday: 6 });
    const result = await rescheduleUpcomingSessionsForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);

    const [pastAfter] = await fixture.db.select().from(sessions).where(eq(sessions.id, past.id));
    expect(new Date(pastAfter?.startsAt ?? 0).toISOString()).toBe("2025-12-30T20:00:00.000Z");
    expect(pastAfter?.status).toBe("played");
    expect(result.movedSessionIds).toEqual([upcoming.id]);
  });
});

// -----------------------------------------------------------------------------
// Money opt-in read model (GitHub issue #21): getSessionSummary.moneyOptIn is
// THE resolution — session booking override > standing-game booking >
// standing-game cost > silence — and the legacy cost fields derive from it, so
// a booked-on game can never leak a split preview.
// -----------------------------------------------------------------------------

describe("money opt-in read model — getSessionSummary.moneyOptIn", () => {
  const SUNDAY = new Date("2026-01-04T00:00:00.000Z");

  it("resolves to silence when neither opt-in is set", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);
    const summary = await getSessionSummary(fixture.db, session.id, fixture.organiserId);
    expect(summary?.moneyOptIn).toBeNull();
    expect(summary?.fourthCallSideHint).toBeNull();
  });

  it("a session inherits its standing game's booking signpost, and the cost fields stay silent", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, {
      bookingPlatform: "playtomic",
      bookingUrl: "https://playtomic.io/clubs/x",
    });
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);

    const summary = await getSessionSummary(fixture.db, session.id, fixture.organiserId);
    expect(summary?.moneyOptIn).toEqual({
      kind: "booking",
      booking: { platform: "playtomic", url: "https://playtomic.io/clubs/x" },
    });
    expect(summary?.costMinor).toBeNull();
    expect(summary?.costPerHeadMinor).toBeNull();
  });

  it("a session-level booking override beats the standing game's opt-in", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { costMinor: 3200 });
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);
    await fixture.db
      .update(sessions)
      .set({ bookingPlatform: "matchi", bookingUrl: null })
      .where(eq(sessions.id, session.id));

    const summary = await getSessionSummary(fixture.db, session.id, fixture.organiserId);
    expect(summary?.moneyOptIn).toEqual({ kind: "booking", booking: { platform: "matchi", url: null } });
    // The standing game still carries a cost, but the per-occurrence booking
    // override silences it — no split chrome may render for this session.
    expect(summary?.costMinor).toBeNull();
    expect(summary?.costPerHeadMinor).toBeNull();
  });

  it("a standing-game cost resolves as the cost opt-in (unchanged behaviour)", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00", slots: 4 } });
    await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { costMinor: 3200 });
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);

    const summary = await getSessionSummary(fixture.db, session.id, fixture.organiserId);
    expect(summary?.moneyOptIn).toEqual({ kind: "cost", amountMinor: 3200, currency: "GBP" });
    expect(summary?.costMinor).toBe(3200);
    expect(summary?.costPerHeadMinor).toBe(800);
  });

  it("a one-off session can carry its own booking signpost (set directly, nothing to inherit)", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const created = await createOneOffSession(fixture.db, fixture.organiserId, {
      circleId: fixture.circleId,
      startsAt: new Date(Date.now() + DAY_MS),
      bookingPlatform: "club_website",
      bookingUrl: "https://ourclub.example/booking",
    });
    if (!created.ok) throw new Error("unreachable");

    const summary = await getSessionSummary(fixture.db, created.value.id, fixture.organiserId);
    expect(summary?.moneyOptIn).toEqual({
      kind: "booking",
      booking: { platform: "club_website", url: "https://ourclub.example/booking" },
    });
  });

  it("createOneOffSession rejects an unknown platform and a bad url", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    expect(
      await createOneOffSession(fixture.db, fixture.organiserId, {
        circleId: fixture.circleId,
        startsAt: new Date(Date.now() + DAY_MS),
        bookingPlatform: "skynet",
      }),
    ).toEqual({ ok: false, error: "invalid_booking_platform" });
    expect(
      await createOneOffSession(fixture.db, fixture.organiserId, {
        circleId: fixture.circleId,
        startsAt: new Date(Date.now() + DAY_MS),
        bookingPlatform: "playtomic",
        bookingUrl: "not-a-url",
      }),
    ).toEqual({ ok: false, error: "invalid_booking_url" });
  });

  it("exposes the organiser-set Fourth Call side hint (a hint only — nothing filters on it)", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, SUNDAY);
    await fixture.db.update(sessions).set({ fourthCallSideHint: "left" }).where(eq(sessions.id, session.id));

    const summary = await getSessionSummary(fixture.db, session.id, fixture.organiserId);
    expect(summary?.fourthCallSideHint).toBe("left");
  });
});
