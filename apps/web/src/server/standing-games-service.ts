/**
 * Standing Game CRUD (organiser-only) + the shared venue create-or-pick
 * helper reused by one-off session creation in games-service.ts.
 *
 * All DB access here is synchronous (`.get()/.all()/.run()`, no
 * `await`) — see games-db.ts for why that matters for the transactional
 * paths in games-service.ts. These functions don't need transactions
 * themselves (no read-then-write race that matters for CRUD), but stay
 * synchronous for consistency and because CuatroDb's better-sqlite3 driver
 * executes every query synchronously under the hood regardless.
 */
import { and, eq } from "drizzle-orm";
import {
  circleMembers,
  circles,
  standingGames,
  venues,
  type CuatroDb,
  type StandingGame,
} from "@cuatro/db";

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type StandingGameInput = {
  circleId: string;
  weekday: number; // 0=Sunday..6=Saturday
  startTime: string; // "HH:MM" local to the venue/circle timezone
  durationMinutes?: number;
  slots?: number;
  rsvpWindowDays?: number;
  venueId?: string | null;
  /** Free-text create-or-pick: matched by exact name, else a new venue row is created. */
  venueName?: string | null;
};

export type StandingGamePatch = Partial<
  Pick<
    StandingGameInput,
    "weekday" | "startTime" | "durationMinutes" | "slots" | "rsvpWindowDays" | "venueId" | "venueName"
  >
> & { active?: boolean };

const START_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isOrganiser(db: CuatroDb, circleId: string, userId: string): boolean {
  const row = db
    .select({ role: circleMembers.role })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)))
    .get();
  return row?.role === "organiser";
}

/** Create-or-pick a venue by exact free-text name, scoped to no particular circle (venues are global rows) but defaulted to the circle's country/timezone when created fresh. */
export function resolveVenue(
  db: CuatroDb,
  circleId: string,
  venueId?: string | null,
  venueName?: string | null,
): string | null {
  if (venueId) return venueId;
  const name = venueName?.trim();
  if (!name) return null;

  const existing = db.select().from(venues).where(eq(venues.name, name)).get();
  if (existing) return existing.id;

  const circle = db.select().from(circles).where(eq(circles.id, circleId)).get();
  const created = db
    .insert(venues)
    .values({
      name,
      countryCode: circle?.countryCode ?? "GB",
      timezone: circle?.timezone ?? "Europe/London",
    })
    .returning()
    .get();
  return created.id;
}

function validateWeekdayAndTime(weekday: number, startTime: string): string | null {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return "invalid_weekday";
  if (!START_TIME_RE.test(startTime)) return "invalid_start_time";
  return null;
}

export function createStandingGame(
  db: CuatroDb,
  userId: string,
  input: StandingGameInput,
): ServiceResult<StandingGame> {
  if (!isOrganiser(db, input.circleId, userId)) return { ok: false, error: "not_an_organiser" };

  const validationError = validateWeekdayAndTime(input.weekday, input.startTime);
  if (validationError) return { ok: false, error: validationError };

  const venueId = resolveVenue(db, input.circleId, input.venueId, input.venueName);

  const created = db
    .insert(standingGames)
    .values({
      circleId: input.circleId,
      venueId,
      weekday: input.weekday,
      startTime: input.startTime,
      durationMinutes: input.durationMinutes ?? 90,
      slots: input.slots ?? 4,
      rsvpWindowDays: input.rsvpWindowDays ?? 6,
      active: true,
    })
    .returning()
    .get();

  return { ok: true, value: created };
}

export function getStandingGame(db: CuatroDb, id: string): StandingGame | null {
  return db.select().from(standingGames).where(eq(standingGames.id, id)).get() ?? null;
}

export function listStandingGamesForCircle(db: CuatroDb, circleId: string): StandingGame[] {
  return db.select().from(standingGames).where(eq(standingGames.circleId, circleId)).all();
}

export function updateStandingGame(
  db: CuatroDb,
  userId: string,
  id: string,
  patch: StandingGamePatch,
): ServiceResult<StandingGame> {
  const existing = getStandingGame(db, id);
  if (!existing) return { ok: false, error: "not_found" };
  if (!isOrganiser(db, existing.circleId, userId)) return { ok: false, error: "not_an_organiser" };

  if (patch.weekday !== undefined || patch.startTime !== undefined) {
    const validationError = validateWeekdayAndTime(
      patch.weekday ?? existing.weekday,
      patch.startTime ?? existing.startTime,
    );
    if (validationError) return { ok: false, error: validationError };
  }

  const venueId =
    patch.venueId !== undefined || patch.venueName !== undefined
      ? resolveVenue(db, existing.circleId, patch.venueId, patch.venueName)
      : undefined;

  const updated = db
    .update(standingGames)
    .set({
      ...(patch.weekday !== undefined ? { weekday: patch.weekday } : {}),
      ...(patch.startTime !== undefined ? { startTime: patch.startTime } : {}),
      ...(patch.durationMinutes !== undefined ? { durationMinutes: patch.durationMinutes } : {}),
      ...(patch.slots !== undefined ? { slots: patch.slots } : {}),
      ...(patch.rsvpWindowDays !== undefined ? { rsvpWindowDays: patch.rsvpWindowDays } : {}),
      ...(venueId !== undefined ? { venueId } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
    })
    .where(eq(standingGames.id, id))
    .returning()
    .get();

  return { ok: true, value: updated };
}

/** Circles the user belongs to, with their role — used to populate "which circle?" pickers. */
export function listCirclesForUser(
  db: CuatroDb,
  userId: string,
): { circleId: string; circleName: string; role: "organiser" | "member" }[] {
  return db
    .select({ circleId: circles.id, circleName: circles.name, role: circleMembers.role })
    .from(circleMembers)
    .innerJoin(circles, eq(circleMembers.circleId, circles.id))
    .where(eq(circleMembers.userId, userId))
    .all();
}
