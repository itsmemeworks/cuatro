import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestClient,
  circleMembers,
  circles,
  rsvps,
  sessions,
  users,
  type CuatroClient,
  type CuatroDb,
} from "@cuatro/db";
import {
  isGenericConversionDestination,
  resolveConvertedGuestLanding,
} from "@/app/auth/callback/converted-landing";

// QA8 finding 4 / fix-wave F5: a guest who converts to a member must land in
// the Circle (or game) they actually joined, never a generic surface. These
// exercise the post-conversion landing resolution against a real schema.

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
});

const NOW = new Date("2026-08-01T12:00:00.000Z");

async function seedUser(displayName = "Member") {
  n += 1;
  const [row] = await db.insert(users).values({ email: `u${n}@example.com`, displayName }).returning();
  return row;
}

async function seedCircle(createdBy: string, inviteCode = `INV${++n}`) {
  const [row] = await db.insert(circles).values({ name: `Circle ${n}`, inviteCode, createdBy }).returning();
  return row;
}

async function joinCircle(circleId: string, userId: string, joinedAt: number) {
  await db.insert(circleMembers).values({ circleId, userId, joinedAt });
}

async function seedUpcomingSession(circleId: string, startsAt: Date) {
  const [row] = await db
    .insert(sessions)
    .values({ circleId, startsAt: startsAt.getTime(), status: "upcoming" })
    .returning();
  return row;
}

describe("isGenericConversionDestination", () => {
  it("flags the two generic convert-CTA destinations", () => {
    expect(isGenericConversionDestination("/home")).toBe(true);
    expect(isGenericConversionDestination("/join/T8U3DMXJ")).toBe(true);
  });

  it("leaves specific destinations alone", () => {
    expect(isGenericConversionDestination("/games/abc")).toBe(false);
    expect(isGenericConversionDestination("/circles/abc")).toBe(false);
    expect(isGenericConversionDestination("/home/anything")).toBe(false);
  });
});

describe("resolveConvertedGuestLanding", () => {
  it("a /join/[code] bounce lands in THAT Circle when the converted guest is a member of it", async () => {
    const organiser = await seedUser("Organiser");
    const other = await seedCircle(organiser.id, "OTHERAAA");
    const invited = await seedCircle(organiser.id, "INVITEDB");
    const guest = await seedUser("Converted");
    // Deliberately make the OTHER circle the most recent join: the invite
    // code must win over recency for a /join destination.
    await joinCircle(invited.id, guest.id, NOW.getTime() - 10_000);
    await joinCircle(other.id, guest.id, NOW.getTime() - 1_000);

    expect(await resolveConvertedGuestLanding(db, guest.id, "/join/INVITEDB", NOW)).toBe(`/circles/${invited.id}`);
  });

  it("a /join/[code] for a circle they did NOT join falls back to their latest Circle", async () => {
    const organiser = await seedUser("Organiser");
    const mine = await seedCircle(organiser.id, "MINECODE");
    const guest = await seedUser("Converted");
    await joinCircle(mine.id, guest.id, NOW.getTime() - 1_000);

    expect(await resolveConvertedGuestLanding(db, guest.id, "/join/SOMEONEE", NOW)).toBe(`/circles/${mine.id}`);
  });

  it("/home upgrades to the most recently joined Circle", async () => {
    const organiser = await seedUser("Organiser");
    const first = await seedCircle(organiser.id);
    const latest = await seedCircle(organiser.id);
    const guest = await seedUser("Converted");
    await joinCircle(first.id, guest.id, NOW.getTime() - 60_000);
    await joinCircle(latest.id, guest.id, NOW.getTime() - 1_000);

    expect(await resolveConvertedGuestLanding(db, guest.id, "/home", NOW)).toBe(`/circles/${latest.id}`);
  });

  it("a pure Fourth Call guest (no Circle) lands on their next upcoming committed game", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const later = await seedUpcomingSession(circle.id, new Date("2026-08-09T20:00:00.000Z"));
    const soon = await seedUpcomingSession(circle.id, new Date("2026-08-02T20:00:00.000Z"));
    const guest = await seedUser("FC Guest");
    await db.insert(rsvps).values({ sessionId: later.id, userId: guest.id, status: "in" });
    await db.insert(rsvps).values({ sessionId: soon.id, userId: guest.id, status: "in" });

    expect(await resolveConvertedGuestLanding(db, guest.id, "/home", NOW)).toBe(`/games/${soon.id}`);
  });

  it("an out RSVP or a started/past session never anchors the landing", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const past = await seedUpcomingSession(circle.id, new Date("2026-07-01T20:00:00.000Z"));
    const future = await seedUpcomingSession(circle.id, new Date("2026-08-09T20:00:00.000Z"));
    const guest = await seedUser("FC Guest");
    await db.insert(rsvps).values({ sessionId: past.id, userId: guest.id, status: "in" });
    await db.insert(rsvps).values({ sessionId: future.id, userId: guest.id, status: "out" });

    expect(await resolveConvertedGuestLanding(db, guest.id, "/home", NOW)).toBeNull();
  });

  it("nothing to anchor to returns null so the caller keeps the original destination", async () => {
    const guest = await seedUser("Loner");
    expect(await resolveConvertedGuestLanding(db, guest.id, "/home", NOW)).toBeNull();
  });
});
