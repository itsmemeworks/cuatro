import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { circleMembers, circles, rsvps, sessions, standingGames, users } from "@cuatro/db";
import { seedCircle, type Fixture } from "./support/games-fixtures";
import { buildQuickSwitchData, QUICK_SWITCH_WINDOW_DAYS } from "@/server/quick-switch";

let fixture: Fixture | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

const DAY_MS = 24 * 60 * 60 * 1000;
// Tuesday 2026-07-14 19:00 UTC (8pm London, BST); "now" is the hour before.
const TUESDAY_8PM = Date.UTC(2026, 6, 14, 19, 0, 0);
const NOW = new Date(TUESDAY_8PM - 60 * 60 * 1000);

async function insertSession(fx: Fixture, opts: { startsAt: number; standingGameId?: string | null; rotationLockedAt?: number | null; status?: string }) {
  const [session] = await fx.db
    .insert(sessions)
    .values({
      circleId: fx.circleId,
      venueId: fx.venueId,
      standingGameId: opts.standingGameId ?? null,
      startsAt: opts.startsAt,
      rotationLockedAt: opts.rotationLockedAt ?? null,
      ...(opts.status ? { status: opts.status as "upcoming" } : {}),
    })
    .returning();
  return session;
}

describe("buildQuickSwitchData — people", () => {
  it("returns distinct real members across the viewer's circles, excluding guests and the viewer", async () => {
    fixture = await seedCircle({ memberCount: 2 });
    const viewer = fixture.organiserId;

    // A guest member (first-class users row, isGuest) — must not appear.
    const [guest] = await fixture.db.insert(users).values({ email: null, displayName: "Guest Gary", isGuest: true }).returning();
    await fixture.db.insert(circleMembers).values({ circleId: fixture.circleId, userId: guest.id, role: "member" });

    const data = await buildQuickSwitchData(fixture.db, viewer, NOW);
    expect(data.people.map((p) => p.displayName).sort()).toEqual(["Member 0", "Member 1"]);
    expect(data.people.every((p) => p.userId !== viewer)).toBe(true);
    expect(data.people[0].circleNames).toEqual(["Test Circle"]);
  });

  it("dedupes a person shared across two circles and collects both circle names", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const viewer = fixture.organiserId;
    const shared = fixture.memberIds[0];

    const [second] = await fixture.db
      .insert(circles)
      .values({ name: "Work Lot", timezone: "Europe/London", inviteCode: "TEST-WL0001", createdBy: viewer })
      .returning();
    await fixture.db.insert(circleMembers).values([
      { circleId: second.id, userId: viewer, role: "organiser" },
      { circleId: second.id, userId: shared, role: "member" },
    ]);

    const data = await buildQuickSwitchData(fixture.db, viewer, NOW);
    expect(data.people).toHaveLength(1);
    expect(data.people[0].userId).toBe(shared);
    expect(data.people[0].circleNames.sort()).toEqual(["Test Circle", "Work Lot"]);
  });

  it("returns nothing for a viewer with no circles", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    const [loner] = await fixture.db.insert(users).values({ email: "loner@example.com", displayName: "Loner" }).returning();
    const data = await buildQuickSwitchData(fixture.db, loner.id, NOW);
    expect(data).toEqual({ people: [], games: [] });
  });
});

describe("buildQuickSwitchData — games", () => {
  it("lists upcoming sessions inside the 7-day window only, earliest first, with venue + timezone facts", async () => {
    fixture = await seedCircle({ memberCount: 2 });
    const inWindow = await insertSession(fixture, { startsAt: TUESDAY_8PM });
    await insertSession(fixture, { startsAt: NOW.getTime() + (QUICK_SWITCH_WINDOW_DAYS + 1) * DAY_MS }); // beyond the window
    await insertSession(fixture, { startsAt: NOW.getTime() - DAY_MS }); // past
    await insertSession(fixture, { startsAt: TUESDAY_8PM + DAY_MS, status: "cancelled" });

    const data = await buildQuickSwitchData(fixture.db, fixture.organiserId, NOW);
    expect(data.games.map((g) => g.sessionId)).toEqual([inWindow.id]);
    expect(data.games[0]).toMatchObject({
      circleName: "Test Circle",
      venueName: "Test Venue",
      timezone: "Europe/London",
      startsAt: TUESDAY_8PM,
    });
  });

  it("flags needs-answer only for an open game the viewer has not answered", async () => {
    fixture = await seedCircle({ memberCount: 3 });
    const [m0, m1, m2] = fixture.memberIds;
    const viewer = fixture.organiserId;

    // 3 in, viewer silent → open ask.
    const open = await insertSession(fixture, { startsAt: TUESDAY_8PM });
    await fixture.db.insert(rsvps).values([
      { sessionId: open.id, userId: m0, status: "in" },
      { sessionId: open.id, userId: m1, status: "in" },
      { sessionId: open.id, userId: m2, status: "in" },
    ]);
    // Viewer already answered 'out' → not an ask.
    const answered = await insertSession(fixture, { startsAt: TUESDAY_8PM + DAY_MS });
    await fixture.db.insert(rsvps).values({ sessionId: answered.id, userId: viewer, status: "out" });
    // Full game → not an ask.
    const full = await insertSession(fixture, { startsAt: TUESDAY_8PM + 2 * DAY_MS });
    await fixture.db.insert(rsvps).values([
      { sessionId: full.id, userId: m0, status: "in" },
      { sessionId: full.id, userId: m1, status: "in" },
      { sessionId: full.id, userId: m2, status: "in" },
      { sessionId: full.id, userId: viewer, status: "in" },
    ]);

    const data = await buildQuickSwitchData(fixture.db, viewer, NOW);
    const byId = new Map(data.games.map((g) => [g.sessionId, g]));
    expect(byId.get(open.id)).toMatchObject({ needsAnswer: true, confirmedCount: 3, slots: 4 });
    expect(byId.get(answered.id)?.needsAnswer).toBe(false);
    expect(byId.get(full.id)).toMatchObject({ needsAnswer: false, confirmedCount: 4 });
  });

  it("never flags a pre-lock rotation game (available, not grab), but can flag it once locked", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    await fixture.db.update(standingGames).set({ rotationEnabled: true }).where(eq(standingGames.id, fixture.standingGameId!));

    const preLock = await insertSession(fixture, { startsAt: TUESDAY_8PM, standingGameId: fixture.standingGameId });
    const locked = await insertSession(fixture, {
      startsAt: TUESDAY_8PM + DAY_MS,
      standingGameId: fixture.standingGameId,
      rotationLockedAt: NOW.getTime() - 1000,
    });

    const data = await buildQuickSwitchData(fixture.db, fixture.organiserId, NOW);
    const byId = new Map(data.games.map((g) => [g.sessionId, g]));
    expect(byId.get(preLock.id)?.needsAnswer).toBe(false);
    expect(byId.get(locked.id)?.needsAnswer).toBe(true);
  });
});
