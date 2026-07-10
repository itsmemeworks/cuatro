"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "./games-db";
import { createStandingGame, updateStandingGame } from "./standing-games-service";
import { rescheduleUpcomingSessionsForStandingGame } from "./games-service";
import { emitCircleEvent, emitSessionEvent } from "@/lib/realtime/broadcast";
import { resolveSubmittedVenue, type VenueResolution } from "./venues";
import { geocodeVenueById } from "./geocode";
import { parseAmountToMinor } from "@/components/tab/money";
import type { CuatroClient } from "@cuatro/db";

/** "" -> null (leave/clear), a valid "32.00"-style string -> minor units, anything unparseable -> undefined (ignored) so a typo doesn't silently zero out an existing cost. */
function parseCostField(raw: FormDataEntryValue | null): number | null | undefined {
  if (raw === null) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  return parseAmountToMinor(trimmed) ?? undefined;
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
  const venue = resolveSubmittedVenue(db, {
    venueId: String(formData.get("venueId") ?? ""),
    name: String(formData.get("venueName") ?? ""),
    address: String(formData.get("venueAddress") ?? ""),
  });
  const result = createStandingGame(db, user.id, {
    circleId,
    weekday: Number(formData.get("weekday")),
    startTime,
    durationMinutes: Number(formData.get("durationMinutes") ?? 90),
    slots: Number(formData.get("slots") ?? 4),
    rsvpWindowDays: Number(formData.get("rsvpWindowDays") ?? 6),
    ...venueFieldsFor(venue),
    costMinor: parseCostField(formData.get("costAmount")) ?? null,
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

export async function updateStandingGameAction(id: string, formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  const client = await getGamesClient();
  const { db } = client;
  // Same picker contract as create: a chosen venueId, or free-form name +
  // address that dedupe-matches before creating. `none` (nothing submitted)
  // leaves the game's venue untouched.
  const venue = resolveSubmittedVenue(db, {
    venueId: String(formData.get("venueId") ?? ""),
    name: String(formData.get("venueName") ?? ""),
    address: String(formData.get("venueAddress") ?? ""),
  });

  const result = updateStandingGame(db, user.id, id, {
    weekday: formData.get("weekday") !== null ? Number(formData.get("weekday")) : undefined,
    startTime: formData.get("startTime") ? String(formData.get("startTime")) : undefined,
    durationMinutes: formData.get("durationMinutes") ? Number(formData.get("durationMinutes")) : undefined,
    slots: formData.get("slots") ? Number(formData.get("slots")) : undefined,
    rsvpWindowDays: formData.get("rsvpWindowDays") ? Number(formData.get("rsvpWindowDays")) : undefined,
    ...venueFieldsFor(venue),
    costMinor: parseCostField(formData.get("costAmount")),
  });

  if (result.ok) {
    await geocodeResolvedVenue(client, result.value.venueId);

    // A day/time (or venue) change leaves the already-materialised next
    // session on its old slot — move it and tell anyone who RSVP'd (v1 audit,
    // journeys finding 5). No-op for edits that don't touch the slot/venue
    // (e.g. a cost-only change). Realtime signals fire AFTER the reschedule
    // transaction commits, per lib/realtime/broadcast.ts's contract.
    const reschedule = rescheduleUpcomingSessionsForStandingGame(db, id);
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
  updateStandingGame(db, user.id, id, { active });

  revalidatePath("/games/standing");
  revalidatePath(`/games/standing/${id}`);
}
