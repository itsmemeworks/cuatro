import { createTestClient } from "@cuatro/db";
import type { CuatroClient, CuatroDb } from "@cuatro/db";
import { circleMembers, circles, standingGames, users, venues } from "@cuatro/db";

export type Fixture = {
  db: CuatroDb;
  close: () => Promise<void>;
  circleId: string;
  venueId: string;
  organiserId: string;
  memberIds: string[];
  standingGameId?: string;
};

/**
 * A circle in `timezone` (default Europe/London) with one organiser +
 * `memberCount` additional members, a venue, and — if `standingGame` is
 * given — an active standing game. Each call opens a brand-new, fully
 * isolated in-memory PGlite database (createTestClient() applies all
 * migrations to a fresh in-process Postgres per call).
 */
export async function seedCircle(opts: {
  memberCount: number;
  timezone?: string;
  standingGame?: {
    weekday: number;
    startTime: string;
    slots?: number;
    rsvpWindowDays?: number;
    active?: boolean;
  };
}): Promise<Fixture> {
  const { db, close }: CuatroClient = await createTestClient();
  const timezone = opts.timezone ?? "Europe/London";

  const [organiser] = await db
    .insert(users)
    .values({ email: "organiser@example.com", displayName: "Organiser" })
    .returning();

  const memberIds: string[] = [];
  for (let i = 0; i < opts.memberCount; i++) {
    const [member] = await db
      .insert(users)
      .values({ email: `member${i}@example.com`, displayName: `Member ${i}` })
      .returning();
    memberIds.push(member.id);
  }

  const [venue] = await db.insert(venues).values({ name: "Test Venue", timezone }).returning();
  const [circle] = await db
    .insert(circles)
    .values({
      name: "Test Circle",
      timezone,
      inviteCode: `TEST-${Math.random().toString(36).slice(2, 8)}`,
      createdBy: organiser.id,
    })
    .returning();

  await db.insert(circleMembers).values({ circleId: circle.id, userId: organiser.id, role: "organiser" });
  for (const id of memberIds) {
    await db.insert(circleMembers).values({ circleId: circle.id, userId: id, role: "member" });
  }

  let standingGameId: string | undefined;
  if (opts.standingGame) {
    const [sg] = await db
      .insert(standingGames)
      .values({
        circleId: circle.id,
        venueId: venue.id,
        weekday: opts.standingGame.weekday,
        startTime: opts.standingGame.startTime,
        slots: opts.standingGame.slots ?? 4,
        rsvpWindowDays: opts.standingGame.rsvpWindowDays ?? 6,
        active: opts.standingGame.active ?? true,
      })
      .returning();
    standingGameId = sg.id;
  }

  return {
    db,
    close,
    circleId: circle.id,
    venueId: venue.id,
    organiserId: organiser.id,
    memberIds,
    standingGameId,
  };
}
