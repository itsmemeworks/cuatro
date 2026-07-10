import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  createTestClient,
  circleMembers,
  circles,
  knocks,
  notifications,
  rsvps,
  sessions,
  standingGames,
  users,
  venues,
  type CuatroClient,
  type CuatroDb,
} from "@cuatro/db";
import {
  boardGames,
  createSessionKnock,
  decideSessionKnock,
  sessionKnocks,
  withdrawSessionKnock,
} from "@/server/discovery";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";

// The three real seeded London pins (see the geo contract §7). Shoreditch↔
// Stratford ≈ 5.1 km (inside the 10 km default); Shoreditch↔Wandsworth ≈
// 11.0 km (the deliberate just-outside boundary case).
const SHOREDITCH = { lat: 51.5265, lng: -0.0805 };
const STRATFORD = { lat: 51.5432, lng: -0.0125 };
const WANDSWORTH = { lat: 51.4571, lng: -0.1931 };

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-07-14T12:00:00.000Z");
const IN_5_DAYS = new Date(NOW.getTime() + 5 * DAY_MS);

let client: CuatroClient;
let db: CuatroDb;

beforeEach(async () => {
  client = await createTestClient();
  db = client.db;
  __setRealtimeSenderForTests(null);
});

afterEach(async () => {
  await client.close();
  __setRealtimeSenderForTests(null);
});

async function mkUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db
    .insert(users)
    .values({ displayName: "U", email: `u${Math.random()}@e.com`, ...overrides })
    .returning();
  return u;
}

async function mkVenue(name: string, pin: { lat: number; lng: number } | null) {
  const [v] = await db
    .insert(venues)
    .values({ name, lat: pin?.lat ?? null, lng: pin?.lng ?? null })
    .returning();
  return v;
}

async function mkCircle(createdBy: string, overrides: Partial<typeof circles.$inferInsert> = {}) {
  const [c] = await db
    .insert(circles)
    .values({ name: "C", inviteCode: `INV${Math.random()}`.slice(0, 12), createdBy, ...overrides })
    .returning();
  return c;
}

/** A circle with one organiser + an upcoming standing-game session at `venueId`, `confirmedRatings.length` players already in. */
async function mkBoardCircle(opts: {
  venueId: string;
  confirmedRatings: (number | null)[];
  boardEnabled?: boolean;
  slots?: number;
  startsAt?: Date;
}) {
  const organiser = await mkUser({ displayName: "Org" });
  const circle = await mkCircle(organiser.id, { boardEnabled: opts.boardEnabled ?? true });
  await db.insert(circleMembers).values({ circleId: circle.id, userId: organiser.id, role: "organiser" });

  const [sg] = await db
    .insert(standingGames)
    .values({ circleId: circle.id, venueId: opts.venueId, weekday: 2, startTime: "20:00", slots: opts.slots ?? 4 })
    .returning();
  const [session] = await db
    .insert(sessions)
    .values({
      standingGameId: sg.id,
      circleId: circle.id,
      venueId: opts.venueId,
      startsAt: (opts.startsAt ?? IN_5_DAYS).getTime(),
      status: "upcoming",
    })
    .returning();

  for (const rating of opts.confirmedRatings) {
    const p = await mkUser({ displayName: "P", rating });
    await db.insert(circleMembers).values({ circleId: circle.id, userId: p.id, role: "member" });
    await db.insert(rsvps).values({ sessionId: session.id, userId: p.id, status: "in" });
  }

  return { organiserId: organiser.id, circleId: circle.id, sessionId: session.id, standingGameId: sg.id };
}

describe("boardGames — the 10 km boundary", () => {
  it("shows the Stratford game (5 km) but not the Wandsworth one (11 km) for a Shoreditch viewer", async () => {
    const shoreditch = await mkVenue("Powerleague Shoreditch", SHOREDITCH);
    const stratford = await mkVenue("Padel Social Club Stratford", STRATFORD);
    const wandsworth = await mkVenue("Rocket Padel Wandsworth", WANDSWORTH);

    const viewer = await mkUser({ displayName: "Viewer", homeVenueId: shoreditch.id, findable: true });

    const near = await mkBoardCircle({ venueId: stratford.id, confirmedRatings: [3.1, 3.8] });
    await mkBoardCircle({ venueId: wandsworth.id, confirmedRatings: [3.0, 3.2] });

    const board = await boardGames(db, viewer.id, { now: NOW });

    expect(board).toHaveLength(1);
    expect(board[0].sessionId).toBe(near.sessionId);
    expect(board[0].slotsOpen).toBe(2);
    expect(board[0].confirmedCount).toBe(2);
    expect(board[0].levelLine).toBe("Glass 3.10–3.80");
    expect(board[0].distanceLabel).toMatch(/km away$/);
    expect(board[0].viewerHasPendingKnock).toBe(false);
  });

  it("returns [] when the viewer has no resolvable patch", async () => {
    const stratford = await mkVenue("Stratford", STRATFORD);
    const viewer = await mkUser({ displayName: "Viewer" }); // no home venue, no patch
    await mkBoardCircle({ venueId: stratford.id, confirmedRatings: [3.1] });

    expect(await boardGames(db, viewer.id, { now: NOW })).toEqual([]);
  });

  it("excludes full games, board-disabled circles, and circles the viewer belongs to", async () => {
    const shoreditch = await mkVenue("Shoreditch", SHOREDITCH);
    const stratford = await mkVenue("Stratford", STRATFORD);
    const viewer = await mkUser({ displayName: "Viewer", homeVenueId: shoreditch.id });

    // full (4/4) — excluded
    await mkBoardCircle({ venueId: stratford.id, confirmedRatings: [3, 3, 3, 3] });
    // board disabled — excluded
    await mkBoardCircle({ venueId: stratford.id, confirmedRatings: [3], boardEnabled: false });
    // viewer is a member — excluded
    const mine = await mkBoardCircle({ venueId: stratford.id, confirmedRatings: [3] });
    await db.insert(circleMembers).values({ circleId: mine.circleId, userId: viewer.id, role: "member" });

    expect(await boardGames(db, viewer.id, { now: NOW })).toEqual([]);
  });

  it("excludes a game whose RSVP window has not opened yet", async () => {
    const shoreditch = await mkVenue("Shoreditch", SHOREDITCH);
    const stratford = await mkVenue("Stratford", STRATFORD);
    const viewer = await mkUser({ displayName: "Viewer", homeVenueId: shoreditch.id });

    // startsAt far enough out that the 6-day window is still shut at NOW.
    await mkBoardCircle({
      venueId: stratford.id,
      confirmedRatings: [3.1],
      startsAt: new Date(NOW.getTime() + 20 * DAY_MS),
    });

    expect(await boardGames(db, viewer.id, { now: NOW })).toEqual([]);
  });

  it("labels an all-unrated confirmed set as still forming", async () => {
    const shoreditch = await mkVenue("Shoreditch", SHOREDITCH);
    const stratford = await mkVenue("Stratford", STRATFORD);
    const viewer = await mkUser({ displayName: "Viewer", homeVenueId: shoreditch.id });
    await mkBoardCircle({ venueId: stratford.id, confirmedRatings: [null, null] });

    const board = await boardGames(db, viewer.id, { now: NOW });
    expect(board[0].levelLine).toBe("New group, still unrated");
  });
});

describe("session knock flow", () => {
  async function scenario() {
    const shoreditch = await mkVenue("Shoreditch", SHOREDITCH);
    const stratford = await mkVenue("Stratford", STRATFORD);
    const viewer = await mkUser({ displayName: "Viewer", homeVenueId: shoreditch.id, rating: 3.4 });
    const game = await mkBoardCircle({ venueId: stratford.id, confirmedRatings: [3.1, 3.8] });
    return { viewer, game };
  }

  it("creates a pending knock and notifies the organiser (knock_received)", async () => {
    const { viewer, game } = await scenario();

    const res = await createSessionKnock(db, game.sessionId, viewer.id, "Can I join?", NOW);
    expect(res.ok).toBe(true);

    const [knock] = await db.select().from(knocks).where(eq(knocks.userId, viewer.id));
    expect(knock?.status).toBe("pending");
    expect(knock?.kind).toBe("session");
    expect(knock?.targetId).toBe(game.sessionId);

    const [notif] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, game.organiserId), eq(notifications.type, "knock_received")));
    expect(notif).toBeTruthy();
  });

  it("enforces one open knock per target (second create rejected)", async () => {
    const { viewer, game } = await scenario();
    expect((await createSessionKnock(db, game.sessionId, viewer.id, null, NOW)).ok).toBe(true);

    const second = await createSessionKnock(db, game.sessionId, viewer.id, null, NOW);
    expect(second).toEqual({ ok: false, error: "already_knocked" });

    // exactly one row survived
    expect(await db.select().from(knocks).where(eq(knocks.userId, viewer.id))).toHaveLength(1);
  });

  it("rejects a knock from an existing circle member", async () => {
    const { viewer, game } = await scenario();
    await db.insert(circleMembers).values({ circleId: game.circleId, userId: viewer.id, role: "member" });

    expect(await createSessionKnock(db, game.sessionId, viewer.id, null, NOW)).toEqual({
      ok: false,
      error: "already_member",
    });
  });

  it("accepts a knock: knocker is RSVP'd in as a non-member participant and notified", async () => {
    const { viewer, game } = await scenario();
    await createSessionKnock(db, game.sessionId, viewer.id, null, NOW);

    const [before] = await db.select({ n: users.rsvpInCount }).from(users).where(eq(users.id, viewer.id));
    const [knock] = await db.select().from(knocks).where(eq(knocks.userId, viewer.id));

    const res = await decideSessionKnock(db, knock.id, game.organiserId, "accept", NOW);
    expect(res).toMatchObject({ ok: true, decision: "accepted", knockerId: viewer.id });

    const [updated] = await db.select().from(knocks).where(eq(knocks.id, knock.id));
    expect(updated?.status).toBe("accepted");
    expect(updated?.decidedBy).toBe(game.organiserId);
    expect(updated?.decidedAt).toBeTruthy();

    const [rsvp] = await db
      .select()
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, game.sessionId), eq(rsvps.userId, viewer.id)));
    expect(rsvp?.status).toBe("in");
    expect(rsvp?.source).toBe("fourth_call"); // non-member session participant, never a circle member

    // NOT added to the circle
    const [membership] = await db
      .select()
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, game.circleId), eq(circleMembers.userId, viewer.id)));
    expect(membership).toBeUndefined();

    const [after] = await db.select({ n: users.rsvpInCount }).from(users).where(eq(users.id, viewer.id));
    expect(after!.n).toBe(before!.n + 1);

    const [accepted] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, viewer.id), eq(notifications.type, "knock_accepted")));
    expect(accepted).toBeTruthy();
  });

  it("declines a knock: marked declined, knocker notified, no RSVP created", async () => {
    const { viewer, game } = await scenario();
    await createSessionKnock(db, game.sessionId, viewer.id, null, NOW);
    const [knock] = await db.select().from(knocks).where(eq(knocks.userId, viewer.id));

    const res = await decideSessionKnock(db, knock.id, game.organiserId, "decline", NOW);
    expect(res).toMatchObject({ ok: true, decision: "declined" });

    const [declined] = await db.select().from(knocks).where(eq(knocks.id, knock.id));
    expect(declined?.status).toBe("declined");
    const [rsvp] = await db
      .select()
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, game.sessionId), eq(rsvps.userId, viewer.id)));
    expect(rsvp).toBeUndefined();
    const [notif] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, viewer.id), eq(notifications.type, "knock_declined")));
    expect(notif).toBeTruthy();
  });

  it("only an organiser can decide", async () => {
    const { viewer, game } = await scenario();
    const stranger = await mkUser({ displayName: "Stranger" });
    await createSessionKnock(db, game.sessionId, viewer.id, null, NOW);
    const [knock] = await db.select().from(knocks).where(eq(knocks.userId, viewer.id));

    expect(await decideSessionKnock(db, knock.id, stranger.id, "accept", NOW)).toEqual({
      ok: false,
      error: "not_an_organiser",
    });
    const [still] = await db.select().from(knocks).where(eq(knocks.id, knock.id));
    expect(still?.status).toBe("pending");
  });

  it("a withdrawn knock frees a re-knock and clears the Board pending flag", async () => {
    const { viewer, game } = await scenario();
    await createSessionKnock(db, game.sessionId, viewer.id, null, NOW);

    let board = await boardGames(db, viewer.id, { now: NOW });
    expect(board[0].viewerHasPendingKnock).toBe(true);

    expect(await withdrawSessionKnock(db, game.sessionId, viewer.id, NOW)).toEqual({ ok: true });
    const [withdrawn] = await db.select().from(knocks).where(eq(knocks.userId, viewer.id));
    expect(withdrawn?.status).toBe("withdrawn");

    board = await boardGames(db, viewer.id, { now: NOW });
    expect(board[0].viewerHasPendingKnock).toBe(false);

    // re-knock allowed after withdrawal
    expect((await createSessionKnock(db, game.sessionId, viewer.id, null, NOW)).ok).toBe(true);
  });

  it("surfaces pending knocks to the organiser with Glass, reliability and distance", async () => {
    const { viewer, game } = await scenario();
    await createSessionKnock(db, game.sessionId, viewer.id, "keen", NOW);

    const rows = await sessionKnocks(db, game.sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(viewer.id);
    expect(rows[0].message).toBe("keen");
    expect(rows[0].rating).toBe(3.4);
    expect(rows[0].distanceLabel).toMatch(/km away$/); // viewer (Shoreditch) → game venue (Stratford)
  });
});
