"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { users, venues } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { resolveSubmittedVenue, generateVenueSlug } from "@/server/venues";
import { geocodeAddress } from "@/server/geocode";
import { PATCH_SIZES, type PatchSize } from "@/lib/geo";

/**
 * What a discovery-settings save reports back to the (client) settings
 * surfaces. Success carries the home venue id that was actually persisted
 * (the wide surface uses it to settle its optimistic select after an
 * add-a-new-court save); failure carries a code the surfaces render through
 * their local copy map (never raw — convention #9).
 */
export type DiscoverySettingsResult =
  | { ok: true; homeVenueId: string | null }
  | { ok: false; error: string };

/** The client-side "Add a new court" select sentinel — never a real id; treated as "no pick" if it ever reaches the server. */
const ADD_NEW_SENTINEL = "__add_new__";

/**
 * Persist the player-side discovery settings that power The Board / Local Ring
 * / Open Door: `findable` (consent to being discovered) and `homeVenueId` (the
 * anchor club whose pin becomes the player's patch — see server/patch.ts).
 *
 * The home court is choose-OR-ADD (same contract as the standing-game venue
 * picker): EITHER a picked `homeVenueId` OR free-form `newCourtName` +
 * `newCourtAddress` (a UK postcode is enough) is submitted, never both. A
 * free-form entry dedupe-matches onto an existing venue before anything is
 * created (server/venues.ts), and a genuinely new court is geocoded FIRST
 * (postcodes.io) — only a court that pins can anchor a patch, so a postcode
 * that doesn't resolve saves nothing at all: no venue row, no user write.
 *
 * The explicit patchLat/patchLng fallback stays server-only (seedable,
 * resolvable) with no UI — a home court covers the launch case. Guarded to the
 * signed-in user; a picked homeVenueId is validated to be a real venue before
 * it's written (the column is an FK, but we drop a stale option quietly
 * rather than 500).
 */
export async function updateDiscoverySettingsAction(formData: FormData): Promise<DiscoverySettingsResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };

  // An unchecked checkbox submits nothing, so absence = not findable.
  const findable = formData.get("findable") != null;

  // Coarse patch size (THE ATLAS). Only written when a valid value is
  // submitted — a discovery form that doesn't carry patchSize (the shipped
  // settings forms predate it) must leave the stored size untouched, never
  // reset it to the default.
  const rawSize = formData.get("patchSize");
  const patchSize: PatchSize | null =
    typeof rawSize === "string" && rawSize in PATCH_SIZES ? (rawSize as PatchSize) : null;

  const rawVenue = formData.get("homeVenueId");
  let pickedId: string | null = null;
  if (typeof rawVenue === "string" && rawVenue.trim().length > 0 && rawVenue.trim() !== ADD_NEW_SENTINEL) {
    pickedId = rawVenue.trim();
  }

  // Presence (even empty) of the free-form fields = the picker was in "add a
  // new court" mode; absence = it wasn't rendered. The distinction matters:
  // an empty add form must error rather than read as "clear my home court".
  const rawName = formData.get("newCourtName");
  const rawAddress = formData.get("newCourtAddress");
  const addingNew = !pickedId && (rawName != null || rawAddress != null);
  const newName = typeof rawName === "string" ? rawName.trim() : "";
  const newAddress = typeof rawAddress === "string" ? rawAddress.trim() : "";

  const { db } = await getDb();

  let homeVenueId: string | null = null;

  if (pickedId) {
    const venue = await db.select({ id: venues.id }).from(venues).where(eq(venues.id, pickedId)).limit(1);
    if (venue.length > 0) homeVenueId = pickedId; // stale option — drop it rather than break the FK
  } else if (addingNew) {
    if (!newName) return { ok: false, error: "court_name_missing" };

    // Dedupe BEFORE creating anything: same postcode or same normalised name
    // means it's a court we already know.
    const resolution = await resolveSubmittedVenue(db, { name: newName, address: newAddress || null });

    if (resolution.outcome === "matched" && resolution.venueId) {
      const [match] = await db.select().from(venues).where(eq(venues.id, resolution.venueId)).limit(1);
      if (!match) return { ok: false, error: "something_went_wrong" };
      if (match.lat == null || match.lng == null) {
        // Known court, but not pinned yet — a home court must pin to anchor a
        // patch. Geocode now; if it won't resolve, save nothing at all.
        const point = await geocodeAddress(newAddress || match.address);
        if (!point) return { ok: false, error: "postcode_unresolved" };
        await db
          .update(venues)
          .set({ lat: point.lat, lng: point.lng, ...(resolution.venueAddress ? { address: resolution.venueAddress } : {}) })
          .where(eq(venues.id, match.id));
      } else if (resolution.venueAddress) {
        // Backfill an address we didn't have — never overwrite a good one.
        await db.update(venues).set({ address: resolution.venueAddress }).where(eq(venues.id, match.id));
      }
      homeVenueId = match.id;
    } else {
      // A genuinely new court. Geocode FIRST so a bad postcode leaves the
      // venues table untouched — nothing half-saved.
      const point = await geocodeAddress(newAddress);
      if (!point) return { ok: false, error: "postcode_unresolved" };
      // Every new court needs a slug or it has no shareable court page.
      const slug = await generateVenueSlug(db, newName, newAddress || null);
      // UK-only launch defaults, same fallback resolveVenue uses (country and
      // timezone are data columns, so this stays world-ready).
      const [created] = await db
        .insert(venues)
        .values({
          name: newName,
          address: newAddress || null,
          lat: point.lat,
          lng: point.lng,
          slug,
          countryCode: "GB",
          timezone: "Europe/London",
        })
        .returning();
      homeVenueId = created.id;
    }
  }

  await db
    .update(users)
    .set({ findable, homeVenueId, ...(patchSize ? { patchSize } : {}) })
    .where(eq(users.id, user.id));

  revalidatePath("/profile");
  revalidatePath("/profile/settings");
  revalidatePath("/home");
  revalidatePath("/discover");
  return { ok: true, homeVenueId };
}
