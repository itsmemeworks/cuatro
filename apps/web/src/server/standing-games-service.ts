/**
 * Standing Game CRUD (organiser-only) + the shared venue create-or-pick
 * helper reused by one-off session creation in games-service.ts.
 *
 * All DB access here is ASYNC (Postgres via drizzle/postgres-js): every query
 * is awaited and returns an array (no better-sqlite3 `.get()/.all()/.run()`
 * terminals). Plain creates don't need explicit transactions; updateStandingGame
 * DOES run in one with a `FOR UPDATE` lock on the standing_games row, because
 * the money opt-in XOR (below) makes it a read-decide-write.
 *
 * MONEY OPT-IN (GitHub issue #21): a game carries at most ONE of a "Booked on"
 * signpost (booking_platform + optional booking_url) or a court cost
 * (cost_minor), never both — a booked-on game never touches the Tab. Enforced
 * HERE, not just in forms: a payload carrying both is rejected
 * (`booking_and_cost`), and setting one clears the other. Default is silence
 * (neither set, no money chrome anywhere).
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
import { BOOKING_PLATFORM_IDS } from "@/lib/booking";
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
  /** The court cost for one occurrence (design/DESIGN-AUDIT.md F4). null/undefined leaves it unset — no "goes on the Tab" split can be offered until an organiser sets one. XOR bookingPlatform (issue #21). */
  costMinor?: number | null;
  costCurrency?: string;
  /** "Booked on" signpost platform id (see lib/booking.ts BOOKING_PLATFORMS). XOR costMinor — a payload carrying both is rejected; setting one clears the other. null clears. */
  bookingPlatform?: string | null;
  /** Optional pasted booking URL (http/https). Only stored alongside a platform; cleared whenever the platform clears. */
  bookingUrl?: string | null;
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
    | "bookingPlatform"
    | "bookingUrl"
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

/**
 * A pasted booking URL, normalised: trimmed, "" -> null, must parse as http(s)
 * (a pasted "playtomic.com/…" without a scheme is not something we can safely
 * link out to) AND have a dotted hostname — "https://x" parses as a URL but
 * links a teammate nowhere (QA4), so the host must read like a real one:
 * non-empty dot-separated labels ("playtomic.io", "192.168.0.1" pass; "x",
 * "x." don't). Mirrored client-side by the forms' MoneyOptInPicker.
 */
export function normalizeBookingUrl(raw: string | null | undefined): { ok: true; url: string | null } | { ok: false } {
  const trimmed = raw?.trim();
  if (!trimmed) return { ok: true, url: null };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false };
    if (!/^[^.]+(\.[^.]+)+$/.test(parsed.hostname)) return { ok: false };
    return { ok: true, url: trimmed };
  } catch {
    return { ok: false };
  }
}

/**
 * The money opt-in XOR, validated against a single payload (issue #21):
 * a booking platform and a court cost may not arrive together, the platform
 * must be a known id (lib/booking.ts is the list), and a URL must be a real
 * http(s) link. Returns the error code, or null when the payload is clean.
 * `bookingPlatform`/`costMinor` here are the payload's VALUES (undefined =
 * field absent, null = explicit clear) — clears never conflict.
 */
function validateMoneyOptIn(input: {
  bookingPlatform?: string | null;
  bookingUrl?: string | null;
  costMinor?: number | null;
}): string | null {
  if (input.bookingPlatform != null && input.costMinor != null) return "booking_and_cost";
  if (input.bookingPlatform != null && !(BOOKING_PLATFORM_IDS as readonly string[]).includes(input.bookingPlatform)) {
    return "invalid_booking_platform";
  }
  if (input.bookingUrl !== undefined && !normalizeBookingUrl(input.bookingUrl).ok) return "invalid_booking_url";
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

  // Money opt-in XOR (issue #21): booking signpost and court cost never arrive
  // together; a booking-signposted game stores no cost (it never touches the Tab).
  const moneyError = validateMoneyOptIn(input);
  if (moneyError) return { ok: false, error: moneyError };
  // Safe narrow: validateMoneyOptIn just proved any non-null value is a known id.
  const bookingPlatform = (input.bookingPlatform ?? null) as StandingGame["bookingPlatform"];
  const bookingUrlResult = normalizeBookingUrl(input.bookingUrl);
  const bookingUrl = bookingPlatform && bookingUrlResult.ok ? bookingUrlResult.url : null;

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
      costMinor: bookingPlatform ? null : (input.costMinor ?? null),
      costCurrency: input.costCurrency ?? "GBP",
      bookingPlatform,
      bookingUrl,
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
  // One transaction with a FOR UPDATE lock on the game row: the money opt-in
  // XOR below decides what to write FROM what's already stored (setting a cost
  // must clear an existing booking and vice versa), which makes this a
  // read-decide-write — two concurrent edits must serialise, not interleave
  // into a row carrying both opt-ins (CLAUDE.md convention 1).
  return db.transaction(async (tx): Promise<ServiceResult<StandingGame>> => {
    const [existing] = await tx.select().from(standingGames).where(eq(standingGames.id, id)).for("update");
    if (!existing) return { ok: false, error: "not_found" };
    if (!(await isOrganiser(tx, existing.circleId, userId))) return { ok: false, error: "not_an_organiser" };

    if (patch.weekday !== undefined || patch.startTime !== undefined) {
      const validationError = validateWeekdayAndTime(
        patch.weekday ?? existing.weekday,
        patch.startTime ?? existing.startTime,
      );
      if (validationError) return { ok: false, error: validationError };
    }

    // Money opt-in XOR (issue #21). The PAYLOAD may never carry both; against
    // the stored row, setting one side clears the other:
    //   - a (non-null) bookingPlatform clears any stored costMinor
    //   - a (non-null) costMinor clears any stored booking signpost
    //   - clearing the platform (null) also drops its URL
    //   - a bookingUrl only sticks while a platform exists after this patch
    const moneyError = validateMoneyOptIn(patch);
    if (moneyError) return { ok: false, error: moneyError };
    const money: Partial<typeof standingGames.$inferInsert> = {};
    if (patch.bookingPlatform !== undefined) {
      // Safe narrow: validateMoneyOptIn just proved any non-null value is a known id.
      money.bookingPlatform = patch.bookingPlatform as StandingGame["bookingPlatform"];
      if (patch.bookingPlatform != null) money.costMinor = null;
      else money.bookingUrl = null;
    }
    if (patch.bookingUrl !== undefined) {
      const platformAfter = patch.bookingPlatform !== undefined ? patch.bookingPlatform : existing.bookingPlatform;
      const normalized = normalizeBookingUrl(patch.bookingUrl);
      money.bookingUrl = platformAfter && normalized.ok ? normalized.url : null;
    }
    if (patch.costMinor !== undefined) {
      money.costMinor = patch.costMinor;
      if (patch.costMinor != null) {
        money.bookingPlatform = null;
        money.bookingUrl = null;
      }
    }

    // A venueName (or venueId) patch resolves/creates as before, now carrying
    // venueAddress along to whichever venue that resolves to. An address-only
    // patch (no venue swap) instead re-resolves the CURRENT venue by id, so
    // "edit the address" works without also having to re-supply a name — but
    // only if there's a venue to attach it to; a standing game with none yet
    // has nowhere for a bare address to go.
    let venueId: string | null | undefined;
    if (patch.venueId !== undefined || patch.venueName !== undefined) {
      venueId = await resolveVenue(tx, existing.circleId, patch.venueId, patch.venueName, patch.venueAddress);
    } else if (patch.venueAddress !== undefined && existing.venueId) {
      venueId = await resolveVenue(tx, existing.circleId, existing.venueId, undefined, patch.venueAddress);
    }

    const [updated] = await tx
      .update(standingGames)
      .set({
        ...(patch.weekday !== undefined ? { weekday: patch.weekday } : {}),
        ...(patch.startTime !== undefined ? { startTime: patch.startTime } : {}),
        ...(patch.durationMinutes !== undefined ? { durationMinutes: patch.durationMinutes } : {}),
        ...(patch.slots !== undefined ? { slots: patch.slots } : {}),
        ...(patch.rsvpWindowDays !== undefined ? { rsvpWindowDays: patch.rsvpWindowDays } : {}),
        ...(venueId !== undefined ? { venueId } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        ...money,
        ...(patch.costCurrency !== undefined ? { costCurrency: patch.costCurrency } : {}),
        ...(patch.rotationEnabled !== undefined ? { rotationEnabled: patch.rotationEnabled } : {}),
        ...(patch.rotationCutoffHours !== undefined ? { rotationCutoffHours: patch.rotationCutoffHours } : {}),
        ...(patch.rotationMode !== undefined ? { rotationMode: patch.rotationMode } : {}),
        ...(patch.gameType !== undefined ? { gameType: patch.gameType } : {}),
      })
      .where(eq(standingGames.id, id))
      .returning();

    return { ok: true, value: updated };
  });
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
