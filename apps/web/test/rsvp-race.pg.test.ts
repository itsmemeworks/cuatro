/**
 * REAL-POSTGRES concurrency proof for the RSVP last-slot race.
 *
 * PGlite (the unit-test driver) is a single in-process connection and
 * serialises everything, so it can NEVER exhibit — nor disprove — the lost-
 * update the `.for('update')` lock in rsvpIn exists to prevent. This test runs
 * against the local Supabase stack's real Postgres, where two transactions on
 * two pooled connections genuinely contend for the same row.
 *
 * Two circle members race the SINGLE open slot of a slots=1 session. Without
 * the FOR UPDATE lock on the session row, both transactions read
 * confirmedCount=0 and both write status='in', oversubscribing the court. With
 * it, the second blocks until the first commits, re-reads count=1, and is sent
 * to the reserve queue. We assert exactly one winner.
 *
 * CI has no Postgres stack, so this is skip-guarded on PG_RACE. Run locally:
 *   PG_RACE=1 npx vitest run test/rsvp-race.pg.test.ts
 * (the local stack must be up: `supabase start` from the repo root).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
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
} from "@cuatro/db";
import { rsvpIn } from "@/server/games-service";

const PG_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54422/postgres";

describe.skipIf(!process.env.PG_RACE)("rsvp last-slot race (real Postgres)", () => {
  let client: CuatroClient;

  // The ids we create, so afterAll can delete exactly our rows from the shared
  // local dev DB (FK order: children first).
  const ids = {
    userA: "",
    userB: "",
    circle: "",
    standingGame: "",
    session: "",
  };

  beforeAll(async () => {
    client = await createClient(PG_URL);
    const { db } = client;

    const [a] = await db.insert(users).values({ email: `race-a-${crypto.randomUUID()}@example.com`, displayName: "Race A" }).returning();
    const [b] = await db.insert(users).values({ email: `race-b-${crypto.randomUUID()}@example.com`, displayName: "Race B" }).returning();
    const [circle] = await db
      .insert(circles)
      .values({ name: "Race Circle", timezone: "Europe/London", inviteCode: `RACE-${crypto.randomUUID().slice(0, 8)}`, createdBy: a.id })
      .returning();
    await db.insert(circleMembers).values([
      { circleId: circle.id, userId: a.id, role: "organiser" },
      { circleId: circle.id, userId: b.id, role: "member" },
    ]);
    // slots = 1: a single open slot for the two racers to fight over.
    const [sg] = await db
      .insert(standingGames)
      .values({ circleId: circle.id, weekday: 2, startTime: "20:00", slots: 1, rsvpWindowDays: 6 })
      .returning();
    // Insert the session directly (startsAt 1h out => inside the RSVP window,
    // not yet started) rather than depend on tz next-occurrence math.
    const [session] = await db
      .insert(sessions)
      .values({ standingGameId: sg.id, circleId: circle.id, startsAt: Date.now() + 60 * 60 * 1000, status: "upcoming" })
      .returning();

    ids.userA = a.id;
    ids.userB = b.id;
    ids.circle = circle.id;
    ids.standingGame = sg.id;
    ids.session = session.id;
  });

  afterAll(async () => {
    if (client && ids.session) {
      const { db } = client;
      // game_filled notifications land on the confirmed racer when the slot
      // fills; clear them before their users (FK order).
      await db.delete(notifications).where(inArray(notifications.userId, [ids.userA, ids.userB]));
      await db.delete(rsvps).where(eq(rsvps.sessionId, ids.session));
      await db.delete(sessions).where(eq(sessions.id, ids.session));
      await db.delete(standingGames).where(eq(standingGames.id, ids.standingGame));
      await db.delete(circleMembers).where(eq(circleMembers.circleId, ids.circle));
      await db.delete(circles).where(eq(circles.id, ids.circle));
      await db.delete(users).where(inArray(users.id, [ids.userA, ids.userB]));
    }
    await client?.close();
  });

  it("gives the last slot to exactly one of two concurrent RSVPs, the other to reserve", async () => {
    const { db } = client;
    const now = new Date();

    // Fire both RSVPs at once. rsvpIn opens its own db.transaction, so each
    // grabs a separate pooled connection => genuine two-connection contention
    // on the session row's FOR UPDATE lock.
    const [outcomeA, outcomeB] = await Promise.all([
      rsvpIn(db, ids.session, ids.userA, now),
      rsvpIn(db, ids.session, ids.userB, now),
    ]);

    expect(outcomeA.ok).toBe(true);
    expect(outcomeB.ok).toBe(true);
    if (!outcomeA.ok || !outcomeB.ok) throw new Error("unreachable");

    // Exactly one 'in', exactly one 'reserve' — never two winners.
    const statuses = [outcomeA.status, outcomeB.status].sort();
    expect(statuses).toEqual(["in", "reserve"]);

    // And the DB agrees: precisely one confirmed row for the single slot.
    const confirmed = await db
      .select({ userId: rsvps.userId })
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, ids.session), eq(rsvps.status, "in")));
    expect(confirmed).toHaveLength(1);

    const reserve = await db
      .select({ userId: rsvps.userId })
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, ids.session), eq(rsvps.status, "reserve")));
    expect(reserve).toHaveLength(1);
  });
});
