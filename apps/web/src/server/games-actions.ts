"use server";

import { GAME_TYPES, circles, venues, type GameType } from "@cuatro/db";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "./games-db";
import { createStandingGame, InvalidVenueError, resolveVenue, updateStandingGame } from "./standing-games-service";
import { createOneOffSession, rescheduleUpcomingSessionsForStandingGame } from "./games-service";
import { zonedWallTimeToUtc } from "./tz";
import { emitCircleEvent, emitSessionEvent } from "@/lib/realtime/broadcast";
import { resolveSubmittedVenue, type VenueResolution } from "./venues";
import { geocodeVenueById } from "./geocode";
import { parseAmountToMinor } from "@/components/tab/money";
import type { CuatroClient } from "@cuatro/db";

/** Rotation cutoff + mode from the form (both create and edit render them). Cutoff clamps to a sane 1..168h; mode is the strict enum. */
/** A form's game-type field, coerced to a valid value or undefined (then the
 * service falls back to the circle default). Never trusts a crafted value. */
function parseGameType(v: FormDataEntryValue | null): GameType | undefined {
  return typeof v === "string" && (GAME_TYPES as readonly string[]).includes(v) ? (v as GameType) : undefined;
}

function parseRotationFields(formData: FormData): { rotationCutoffHours: number; rotationMode: "limited" | "unlimited" } {
  const rawHours = Number(formData.get("rotationCutoffHours"));
  const rotationCutoffHours = Number.isFinite(rawHours) && rawHours >= 1 && rawHours <= 168 ? Math.round(rawHours) : 24;
  const rotationMode = formData.get("rotationMode") === "unlimited" ? "unlimited" : "limited";
  return { rotationCutoffHours, rotationMode };
}

/** "" -> null (leave/clear), a valid "32.00"-style string -> minor units, anything unparseable -> undefined (ignored) so a typo doesn't silently zero out an existing cost. */
function parseCostField(raw: FormDataEntryValue | null): number | null | undefined {
  if (raw === null) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  return parseAmountToMinor(trimmed) ?? undefined;
}

/** "Booked on" form fields (issue #21): absent -> undefined (leave unchanged), "" -> null (clear), anything else passes through verbatim — the SERVICE validates platform ids and URLs and enforces the booking XOR cost rule, so a crafted value is rejected there, not silently laundered here. */
function parseBookingField(raw: FormDataEntryValue | null): string | null | undefined {
  if (raw === null) return undefined;
  const trimmed = String(raw).trim();
  return trimmed ? trimmed : null;
}

/**
 * Turn a resolved venue submission into the venue fields create/update
 * expect. Fields stay `undefined` when they don't apply so create/update
 * leave the address untouched (passing `null` would CLEAR a picked venue's
 * address — see resolveVenue's `venueAddress !== undefined` check).
 */
function venueFieldsFor(r: VenueResolution): {
  venueId?: string;
  venueName?: string;
  venueAddress?: string;
} {
  return { venueId: r.venueId, venueName: r.venueName, venueAddress: r.venueAddress };
}

/** Geocode the venue a game landed on (no-op if it's already pinned or has no resolvable postcode). Awaited so it finishes before the action returns. */
async function geocodeResolvedVenue(client: CuatroClient, venueId: string | null): Promise<void> {
  if (venueId) await geocodeVenueById(client, venueId);
}

export async function createStandingGameAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const circleId = String(formData.get("circleId") ?? "");
  const startTime = String(formData.get("startTime") ?? "");
  // Bounce back to the form with a code (rendered via errorCopy) rather than
  // silently re-rendering an unchanged page — see games/standing/new/page.tsx.
  const backToForm = (error: string) =>
    `/games/standing/new?error=${error}${circleId ? `&circleId=${circleId}` : ""}`;
  if (!circleId || !startTime) redirect(backToForm("bad_request"));

  const client = await getGamesClient();
  const { db } = client;
  // The picker submits EITHER a chosen venueId or free-form name + address.
  // Resolve first so a near-duplicate free-form entry dedupe-matches onto an
  // existing venue instead of creating a second row.
  const venue = await resolveSubmittedVenue(db, {
    venueId: String(formData.get("venueId") ?? ""),
    name: String(formData.get("venueName") ?? ""),
    address: String(formData.get("venueAddress") ?? ""),
  });
  const result = await createStandingGame(db, user.id, {
    circleId,
    weekday: Number(formData.get("weekday")),
    startTime,
    durationMinutes: Number(formData.get("durationMinutes") ?? 90),
    slots: Number(formData.get("slots") ?? 4),
    rsvpWindowDays: Number(formData.get("rsvpWindowDays") ?? 6),
    ...venueFieldsFor(venue),
    costMinor: parseCostField(formData.get("costAmount")) ?? null,
    // Money opt-in (issue #21): booking signpost XOR court cost, enforced by
    // the service — a form somehow submitting both bounces back with a code.
    bookingPlatform: parseBookingField(formData.get("bookingPlatform")) ?? null,
    bookingUrl: parseBookingField(formData.get("bookingUrl")) ?? null,
    // Unchecked checkboxes submit nothing, so absence = off.
    rotationEnabled: formData.get("rotationEnabled") === "on",
    ...parseRotationFields(formData),
    gameType: parseGameType(formData.get("gameType")),
  });

  revalidatePath("/games/standing");
  if (!result.ok) redirect(backToForm(result.error));

  // Geocode the venue so discovery can pin it (no-op if already pinned).
  await geocodeResolvedVenue(client, result.value.venueId);

  // ?created=1 turns the edit page's top into a success moment (next session
  // + invite pointer) instead of dropping the organiser onto a silent form;
  // ?matched surfaces a quiet "matched to X, no duplicate" confirmation.
  const matchedParam = venue.outcome === "matched" && venue.matchedName ? `&matched=${encodeURIComponent(venue.matchedName)}` : "";
  redirect(`/games/standing/${result.value.id}?created=1${matchedParam}`);
}

/**
 * Creates a one-off session from the /games/one-off/new form (QA4: the API
 * existed, the UI entry point didn't). The organiser types a wall-clock date +
 * time; the ONE place that becomes a UTC instant is zonedWallTimeToUtc with
 * the session's effective timezone — the venue's, else the Circle's (the
 * standing-game materialiser's exact rule), never the runtime's TZ.
 */
export async function createOneOffSessionAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const circleId = String(formData.get("circleId") ?? "");
  const date = String(formData.get("date") ?? "");
  const startTime = String(formData.get("startTime") ?? "");
  const backToForm = (error: string) =>
    `/games/one-off/new?error=${error}${circleId ? `&circleId=${circleId}` : ""}`;
  if (!circleId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime)) {
    redirect(backToForm("bad_request"));
  }

  const client = await getGamesClient();
  const { db } = client;
  const [circleRow] = await db.select({ timezone: circles.timezone }).from(circles).where(eq(circles.id, circleId));
  if (!circleRow) redirect(backToForm("bad_request"));

  // Same picker contract as the standing forms: a chosen venueId, or free-form
  // name + address that dedupe-matches. Materialise the row NOW (create-or-pick,
  // the standing service's own helper) so the instant below can anchor to the
  // venue's timezone rather than resolving the venue after the fact.
  const venue = await resolveSubmittedVenue(db, {
    venueId: String(formData.get("venueId") ?? ""),
    name: String(formData.get("venueName") ?? ""),
    address: String(formData.get("venueAddress") ?? ""),
  });
  let venueId: string | null;
  try {
    venueId = await resolveVenue(db, circleId, venue.venueId, venue.venueName, venue.venueAddress);
  } catch (err) {
    if (err instanceof InvalidVenueError) redirect(backToForm("invalid_venue"));
    throw err;
  }

  let timezone = circleRow.timezone;
  if (venueId) {
    const [venueRow] = await db.select({ timezone: venues.timezone }).from(venues).where(eq(venues.id, venueId));
    if (venueRow?.timezone) timezone = venueRow.timezone;
  }
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = startTime.split(":").map(Number);
  const startsAt = zonedWallTimeToUtc(year, month - 1, day, hour, minute, timezone);
  if (startsAt.getTime() <= Date.now()) redirect(backToForm("starts_in_past"));

  const result = await createOneOffSession(db, user.id, {
    circleId,
    startsAt,
    venueId,
    gameType: parseGameType(formData.get("gameType")),
    // "Booked on" only — sessions carry no cost column (issue #21), so the
    // one-off form renders MoneyOptInPicker with allowCost={false}.
    bookingPlatform: parseBookingField(formData.get("bookingPlatform")) ?? null,
    bookingUrl: parseBookingField(formData.get("bookingUrl")) ?? null,
  });
  if (!result.ok) redirect(backToForm(result.error));

  await geocodeResolvedVenue(client, result.value.venueId);
  revalidatePath(`/circles/${circleId}/games`);
  // Land on the game itself — the session page is the success moment (RSVP
  // grid, share, the lot), no interstitial needed.
  redirect(`/games/${result.value.id}`);
}

export async function updateStandingGameAction(id: string, formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  const client = await getGamesClient();
  const { db } = client;
  // Same picker contract as create: a chosen venueId, or free-form name +
  // address that dedupe-matches before creating. `none` (nothing submitted)
  // leaves the game's venue untouched.
  const venue = await resolveSubmittedVenue(db, {
    venueId: String(formData.get("venueId") ?? ""),
    name: String(formData.get("venueName") ?? ""),
    address: String(formData.get("venueAddress") ?? ""),
  });

  const result = await updateStandingGame(db, user.id, id, {
    weekday: formData.get("weekday") !== null ? Number(formData.get("weekday")) : undefined,
    startTime: formData.get("startTime") ? String(formData.get("startTime")) : undefined,
    durationMinutes: formData.get("durationMinutes") ? Number(formData.get("durationMinutes")) : undefined,
    slots: formData.get("slots") ? Number(formData.get("slots")) : undefined,
    rsvpWindowDays: formData.get("rsvpWindowDays") ? Number(formData.get("rsvpWindowDays")) : undefined,
    ...venueFieldsFor(venue),
    costMinor: parseCostField(formData.get("costAmount")),
    // Booking fields follow the cost field's convention: absent = leave
    // unchanged, "" = clear. The service enforces the XOR against the stored row.
    bookingPlatform: parseBookingField(formData.get("bookingPlatform")),
    bookingUrl: parseBookingField(formData.get("bookingUrl")),
    // The edit form always renders the rotation checkbox, so its absence is an
    // explicit "off", not "leave unchanged".
    rotationEnabled: formData.get("rotationEnabled") === "on",
    ...parseRotationFields(formData),
    gameType: parseGameType(formData.get("gameType")),
  });

  // A validation failure must bounce back visibly (?error=code, same
  // convention as create) — falling through here made a bad edit (e.g. an
  // invalid booking URL) look saved while saving nothing.
  if (!result.ok) redirect(`/games/standing/${id}?error=${result.error}`);

  if (result.ok) {
    await geocodeResolvedVenue(client, result.value.venueId);

    // A day/time (or venue) change leaves the already-materialised next
    // session on its old slot — move it and tell anyone who RSVP'd (v1 audit,
    // journeys finding 5). No-op for edits that don't touch the slot/venue
    // (e.g. a cost-only change). Realtime signals fire AFTER the reschedule
    // transaction commits, per lib/realtime/broadcast.ts's contract.
    const reschedule = await rescheduleUpcomingSessionsForStandingGame(db, id);
    if (reschedule.circleId && reschedule.movedSessionIds.length > 0) {
      for (const movedId of reschedule.movedSessionIds) {
        emitSessionEvent(movedId, "rsvp", { circleId: reschedule.circleId });
      }
      emitCircleEvent(reschedule.circleId, "rsvp", { sessionIds: reschedule.movedSessionIds });
    }
  }

  revalidatePath("/games/standing");
  revalidatePath(`/games/standing/${id}`);
}

export async function toggleStandingGameActiveAction(id: string, active: boolean): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  const { db } = await getGamesClient();
  await updateStandingGame(db, user.id, id, { active });

  revalidatePath("/games/standing");
  revalidatePath(`/games/standing/${id}`);
}
