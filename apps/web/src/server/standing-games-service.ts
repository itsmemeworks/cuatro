/**
 * Standing Game CRUD (organiser-only) + the shared venue create-or-pick
 * helper reused by one-off session creation in games-service.ts.
 *
 * All DB access here is ASYNC (Postgres via drizzle/postgres-js): every query
 * is awaited and returns an array (no better-sqlite3 `.get()/.all()/.run()`
 * terminals). These functions don't need explicit transactions themselves (no
 * read-then-write race that matters for plain CRUD); the concurrency-critical
 * paths that DO (session materialisation, RSVP) live in games-service.ts and
 * take row locks there.
 */
import { and, eq } from "drizzle-orm";
import {
  circleMembers,
  circles,
  standingGames,
  venues,
  type CuatroDb,
  type StandingGame,
  type GameType,
} from "@cuatro/db";
import { captureEvent } from "@/lib/analytics";

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
  /** Sets/overwrites the resolved venue's address (design/DESIGN-AUDIT.md F5) — undefined leaves it untouched, "" clears it. */
  venueAddress?: string | null;
  /** The court cost for one occurrence (design/DESIGN-AUDIT.md F4). null/undefined leaves it unset — no "goes on the Tab" split can be offered until an organiser sets one. */
  costMinor?: number | null;
  costCurrency?: string;
  /** THE ROTATION: when true, the weekly RSVP becomes an availability declaration and CUATRO picks a fair four. Defaults false (plain first-come). */
  rotationEnabled?: boolean;
  /** How long before kickoff a LIMITED rotation locks its four. Default 24. */
  rotationCutoffHours?: number;
  /** 'limited' locks at the cutoff (default); 'unlimited' re-ranks to kickoff, never locks. */
  rotationMode?: "limited" | "unlimited";
  /** FRIENDLIES classification. Omit to inherit the circle's default_game_type. */
  gameType?: GameType;
};

export type StandingGamePatch = Partial<
  Pick<
    StandingGameInput,
    | "weekday"
    | "startTime"
    | "durationMinutes"
    | "slots"
    | "rsvpWindowDays"
    | "gameType"
    | "venueId"
    | "venueName"
    | "venueAddress"
    | "costMinor"
    | "costCurrency"
    | "rotationEnabled"
    | "rotationCutoffHours"
    | "rotationMode"
  >
> & { active?: boolean };

const START_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function isOrganiser(db: CuatroDb, circleId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: circleMembers.role })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)));
  return row?.role === "organiser";
}

/**
 * Create-or-pick a venue by exact free-text name, scoped to no particular
 * circle (venues are global rows) but defaulted to the circle's
 * country/timezone when created fresh. `venueAddress` (design/
 * DESIGN-AUDIT.md F5), if given, is written onto whichever venue this call
 * resolves to — an existing venue's address is editable this way too, not
 * just a freshly-created one's.
 */
export async function resolveVenue(
  db: CuatroDb,
  circleId: string,
  venueId?: string | null,
  venueName?: string | null,
  venueAddress?: string | null,
): Promise<string | null> {
  let resolvedId: string | null;

  if (venueId) {
    resolvedId = venueId;
  } else {
    const name = venueName?.trim();
    if (!name) return null;

    const [existing] = await db.select().from(venues).where(eq(venues.name, name));
    if (existing) {
      resolvedId = existing.id;
    } else {
      const [circle] = await db.select().from(circles).where(eq(circles.id, circleId));
      const [created] = await db
        .insert(venues)
        .values({
          name,
          address: venueAddress?.trim() || null,
          countryCode: circle?.countryCode ?? "GB",
          timezone: circle?.timezone ?? "Europe/London",
        })
        .returning();
      return created.id;
    }
  }

  if (venueAddress !== undefined) {
    await db.update(venues).set({ address: venueAddress?.trim() || null }).where(eq(venues.id, resolvedId));
  }
  return resolvedId;
}

function validateWeekdayAndTime(weekday: number, startTime: string): string | null {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return "invalid_weekday";
  if (!START_TIME_RE.test(startTime)) return "invalid_start_time";
  return null;
}

export async function createStandingGame(
  db: CuatroDb,
  userId: string,
  input: StandingGameInput,
): Promise<ServiceResult<StandingGame>> {
  if (!(await isOrganiser(db, input.circleId, userId))) return { ok: false, error: "not_an_organiser" };

  const validationError = validateWeekdayAndTime(input.weekday, input.startTime);
  if (validationError) return { ok: false, error: validationError };

  const venueId = await resolveVenue(db, input.circleId, input.venueId, input.venueName, input.venueAddress);

  const [circleRow] = await db
    .select({ defaultGameType: circles.defaultGameType })
    .from(circles)
    .where(eq(circles.id, input.circleId));
  const gameType = input.gameType ?? circleRow?.defaultGameType ?? "competitive";

  const [created] = await db
    .insert(standingGames)
    .values({
      circleId: input.circleId,
      gameType,
      venueId,
      weekday: input.weekday,
      startTime: input.startTime,
      durationMinutes: input.durationMinutes ?? 90,
      slots: input.slots ?? 4,
      rsvpWindowDays: input.rsvpWindowDays ?? 6,
      active: true,
      costMinor: input.costMinor ?? null,
      costCurrency: input.costCurrency ?? "GBP",
      rotationEnabled: input.rotationEnabled ?? false,
      rotationCutoffHours: input.rotationCutoffHours ?? 24,
      rotationMode: input.rotationMode ?? "limited",
    })
    .returning();

  // §9 metric 1: standing_game_created (after commit). The fixture is a single
  // weekday slot, so cadence is always "weekly" in v1 (no cadence column —
  // fortnightly/etc. from METRICS.md isn't modelled yet; see metrics-manifest.md).
  captureEvent("standing_game_created", {
    distinctId: userId,
    circleId: created.circleId,
    timestamp: created.createdAt,
    properties: {
      standing_game_id: created.id,
      cadence: "weekly",
      venue_id: created.venueId,
      slots: created.slots,
      game_type: created.gameType,
      created_at: created.createdAt,
    },
  });

  return { ok: true, value: created };
}

export async function getStandingGame(db: CuatroDb, id: string): Promise<StandingGame | null> {
  const [row] = await db.select().from(standingGames).where(eq(standingGames.id, id));
  return row ?? null;
}

export async function listStandingGamesForCircle(db: CuatroDb, circleId: string): Promise<StandingGame[]> {
  return db.select().from(standingGames).where(eq(standingGames.circleId, circleId));
}

export async function updateStandingGame(
  db: CuatroDb,
  userId: string,
  id: string,
  patch: StandingGamePatch,
): Promise<ServiceResult<StandingGame>> {
  const existing = await getStandingGame(db, id);
  if (!existing) return { ok: false, error: "not_found" };
  if (!(await isOrganiser(db, existing.circleId, userId))) return { ok: false, error: "not_an_organiser" };

  if (patch.weekday !== undefined || patch.startTime !== undefined) {
    const validationError = validateWeekdayAndTime(
      patch.weekday ?? existing.weekday,
      patch.startTime ?? existing.startTime,
    );
    if (validationError) return { ok: false, error: validationError };
  }

  // A venueName (or venueId) patch resolves/creates as before, now carrying
  // venueAddress along to whichever venue that resolves to. An address-only
  // patch (no venue swap) instead re-resolves the CURRENT venue by id, so
  // "edit the address" works without also having to re-supply a name — but
  // only if there's a venue to attach it to; a standing game with none yet
  // has nowhere for a bare address to go.
  let venueId: string | null | undefined;
  if (patch.venueId !== undefined || patch.venueName !== undefined) {
    venueId = await resolveVenue(db, existing.circleId, patch.venueId, patch.venueName, patch.venueAddress);
  } else if (patch.venueAddress !== undefined && existing.venueId) {
    venueId = await resolveVenue(db, existing.circleId, existing.venueId, undefined, patch.venueAddress);
  }

  const [updated] = await db
    .update(standingGames)
    .set({
      ...(patch.weekday !== undefined ? { weekday: patch.weekday } : {}),
      ...(patch.startTime !== undefined ? { startTime: patch.startTime } : {}),
      ...(patch.durationMinutes !== undefined ? { durationMinutes: patch.durationMinutes } : {}),
      ...(patch.slots !== undefined ? { slots: patch.slots } : {}),
      ...(patch.rsvpWindowDays !== undefined ? { rsvpWindowDays: patch.rsvpWindowDays } : {}),
      ...(venueId !== undefined ? { venueId } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.costMinor !== undefined ? { costMinor: patch.costMinor } : {}),
      ...(patch.costCurrency !== undefined ? { costCurrency: patch.costCurrency } : {}),
      ...(patch.rotationEnabled !== undefined ? { rotationEnabled: patch.rotationEnabled } : {}),
      ...(patch.rotationCutoffHours !== undefined ? { rotationCutoffHours: patch.rotationCutoffHours } : {}),
      ...(patch.rotationMode !== undefined ? { rotationMode: patch.rotationMode } : {}),
      ...(patch.gameType !== undefined ? { gameType: patch.gameType } : {}),
    })
    .where(eq(standingGames.id, id))
    .returning();

  return { ok: true, value: updated };
}

/** Circles the user belongs to, with their role — used to populate "which circle?" pickers. */
export async function listCirclesForUser(
  db: CuatroDb,
  userId: string,
): Promise<{ circleId: string; circleName: string; role: "organiser" | "member" }[]> {
  return db
    .select({ circleId: circles.id, circleName: circles.name, role: circleMembers.role })
    .from(circleMembers)
    .innerJoin(circles, eq(circleMembers.circleId, circles.id))
    .where(eq(circleMembers.userId, userId));
}
