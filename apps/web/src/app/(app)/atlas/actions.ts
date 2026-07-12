"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { users, venues, type IndoorOutdoor } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { matchVenue, generateVenueSlug } from "@/server/venues";
import { extractUkPostcode, geocodeAddress } from "@/server/geocode";
import { haversineKm, coarseDistanceKm } from "@/lib/geo";

/**
 * Add-a-court server actions for THE ATLAS (design screen 5). A court is a
 * civic contribution, not a person and not a home-court pick — this creates a
 * venue on the shared map and celebrates it, and it deliberately does NOT
 * touch the adder's own home court / patch (that stays with discovery-actions).
 *
 * Two jobs:
 *  - `verifyPostcodeAction` powers the live "the pin lands there, roughly"
 *    feedback as the postcode is typed (postcodes.io via geocode.ts).
 *  - `addCourtToAtlasAction` geocodes, dedupe-checks, and either surfaces the
 *    near-match ("Hold on. Did you mean this one?") or creates the court and
 *    returns the celebration facts. Duplicates are the failure mode, so the
 *    dedupe check runs before any row is created (composing server/venues.ts
 *    matchVenue) — a court without a resolvable pin is never created, because
 *    an unpinned court can't appear on the map it was added to.
 *
 * All raw codes are page-local (convention #9): the client renders them
 * through add-a-court's own copy map, never straight to the UI.
 */

/** The outward code of a UK postcode ("E9 5EN" -> "E9") — the "district" a first court lands in. */
function postcodeDistrict(postcode: string | null): string | null {
  if (!postcode) return null;
  const outward = postcode.trim().split(/\s+/)[0];
  return outward || null;
}

/**
 * A rough, honest venue-to-pin distance for the dedupe card. This compares two
 * VENUE pins (the submitted postcode centroid and an existing court), never a
 * person's location, so metre-level here is geography, not tracking — but it
 * still rounds hard, in keeping with the never-precise house style.
 */
function pinDistanceLabel(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
  const km = haversineKm(fromLat, fromLng, toLat, toLng);
  if (km < 1) {
    const metres = Math.max(50, Math.round((km * 1000) / 50) * 50);
    return `~${metres} m from your pin`;
  }
  return `~${coarseDistanceKm(km)} km from your pin`;
}

export type PostcodeCheck = { ok: true; postcode: string } | { ok: false };

/**
 * Live postcode check for the add-a-court form. Returns the normalised
 * postcode when it resolves to a pin, so the form can echo it back ("✓ E9 5EN
 * checks out"); false otherwise (the form shows the friendly rough-is-the-point
 * line, never a raw failure). Network-touching but off the persist path.
 */
export async function verifyPostcodeAction(raw: string): Promise<PostcodeCheck> {
  const postcode = extractUkPostcode(raw);
  if (!postcode) return { ok: false };
  const point = await geocodeAddress(raw);
  return point ? { ok: true, postcode } : { ok: false };
}

/** The near-match a submission dedupe-resolved onto — everything the "Did you mean this one?" card needs. */
export interface DedupeVenue {
  id: string;
  slug: string | null;
  name: string;
  indoorOutdoor: IndoorOutdoor | null;
  courtCount: number | null;
  postcode: string | null;
  /** "OUTDOOR · 4 COURTS · E9 7DE · same postcode area, ~400 m from your pin" — pre-assembled, mono. */
  factsLine: string;
  homeCourtPlayers: number;
}

export type AddCourtResult =
  | { status: "created"; venueId: string; slug: string | null; name: string; district: string | null }
  | { status: "dedupe"; submittedName: string; district: string | null; existing: DedupeVenue }
  | { status: "error"; code: string };

const INDOOR_OUTDOOR_VALUES: readonly IndoorOutdoor[] = ["indoor", "outdoor", "mixed"];

/**
 * Create a court on the Atlas (or surface the near-match first). Geocodes the
 * postcode FIRST so a court that can't pin is never created; then, unless the
 * caller passed `force` (the "No, mine is new · pin it" escape after seeing the
 * dedupe card), checks for an existing venue by same postcode or normalised
 * name and returns it for confirmation. On create, the optional community facts
 * (indoor/outdoor, court count) ride along; both stay nullable.
 */
export async function addCourtToAtlasAction(formData: FormData): Promise<AddCourtResult> {
  const user = await getSessionUser();
  if (!user) return { status: "error", code: "unauthorized" };

  const name = (formData.get("name") as string | null)?.trim() ?? "";
  if (!name) return { status: "error", code: "court_name_missing" };

  const address = (formData.get("postcode") as string | null)?.trim() ?? "";
  const force = formData.get("force") === "1";

  const rawIO = (formData.get("indoorOutdoor") as string | null)?.trim() ?? "";
  const indoorOutdoor = INDOOR_OUTDOOR_VALUES.includes(rawIO as IndoorOutdoor) ? (rawIO as IndoorOutdoor) : null;

  const rawCount = Number(formData.get("courtCount"));
  const courtCount = Number.isInteger(rawCount) && rawCount > 0 ? rawCount : null;

  // Geocode first: an unpinned court can't appear on the map it's added to, so
  // a postcode that doesn't resolve saves nothing at all.
  const point = await geocodeAddress(address);
  if (!point) return { status: "error", code: "postcode_unresolved" };

  const postcode = extractUkPostcode(address);
  const district = postcodeDistrict(postcode);

  const { db } = await getDb();

  if (!force) {
    const match = await matchVenue(db, { name, address });
    if (match) {
      const matchPostcode = extractUkPostcode(match.address);
      const sameArea = matchPostcode != null && postcode != null && postcodeDistrict(matchPostcode) === district;
      const parts: string[] = [];
      if (match.indoorOutdoor) parts.push(match.indoorOutdoor.toUpperCase());
      if (match.courtCount != null) parts.push(`${match.courtCount} COURTS`);
      if (matchPostcode) parts.push(matchPostcode);
      if (match.lat != null && match.lng != null) {
        const dist = pinDistanceLabel(point.lat, point.lng, match.lat, match.lng);
        parts.push(sameArea ? `same postcode area, ${dist}` : dist);
      } else if (sameArea) {
        parts.push("same postcode area");
      }
      const playerRows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.homeVenueId, match.id), eq(users.isGuest, false)));

      return {
        status: "dedupe",
        submittedName: name,
        district,
        existing: {
          id: match.id,
          slug: match.slug,
          name: match.name,
          indoorOutdoor: match.indoorOutdoor,
          courtCount: match.courtCount,
          postcode: matchPostcode,
          factsLine: parts.join(" · "),
          homeCourtPlayers: playerRows.length,
        },
      };
    }
  }

  // Every new court needs a slug or it has no shareable court page.
  const slug = await generateVenueSlug(db, name, address || null);
  const [created] = await db
    .insert(venues)
    .values({
      name,
      address: address || null,
      lat: point.lat,
      lng: point.lng,
      indoorOutdoor,
      courtCount,
      slug,
      countryCode: "GB",
      timezone: "Europe/London",
    })
    .returning();

  revalidatePath("/discover");
  revalidatePath("/atlas");

  return { status: "created", venueId: created.id, slug: created.slug, name: created.name, district };
}
