import { createClient } from "@cuatro/db";
import type { CuatroClient, CuatroDb } from "@cuatro/db";
import { circleMembers, circles, standingGames, users, venues } from "@cuatro/db";

export type Fixture = {
  db: CuatroDb;
  close: () => void;
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
 * isolated `:memory:` SQLite database (better-sqlite3 never shares state
 * across separate `:memory:` opens).
 */
export function seedCircle(opts: {
  memberCount: number;
  timezone?: string;
  standingGame?: {
    weekday: number;
    startTime: string;
    slots?: number;
    rsvpWindowDays?: number;
    active?: boolean;
  };
}): Fixture {
  const { db, close }: CuatroClient = createClient(":memory:");
  const timezone = opts.timezone ?? "Europe/London";

  const organiser = db
    .insert(users)
    .values({ email: "organiser@example.com", displayName: "Organiser" })
    .returning()
    .get();

  const memberIds: string[] = [];
  for (let i = 0; i < opts.memberCount; i++) {
    const member = db
      .insert(users)
      .values({ email: `member${i}@example.com`, displayName: `Member ${i}` })
      .returning()
      .get();
    memberIds.push(member.id);
  }

  const venue = db.insert(venues).values({ name: "Test Venue", timezone }).returning().get();
  const circle = db
    .insert(circles)
    .values({
      name: "Test Circle",
      timezone,
      inviteCode: `TEST-${Math.random().toString(36).slice(2, 8)}`,
      createdBy: organiser.id,
    })
    .returning()
    .get();

  db.insert(circleMembers).values({ circleId: circle.id, userId: organiser.id, role: "organiser" }).run();
  for (const id of memberIds) {
    db.insert(circleMembers).values({ circleId: circle.id, userId: id, role: "member" }).run();
  }

  let standingGameId: string | undefined;
  if (opts.standingGame) {
    const sg = db
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
      .returning()
      .get();
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
