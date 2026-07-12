/**
 * Venue matching + ordered listing for the game-creation venue picker.
 *
 * Two jobs:
 *
 *  1. `listVenuesForCircle` powers the picker dropdown: the circle's home
 *     court first, then venues the circle has actually played at, then every
 *     other known venue alphabetically, each with a short area hint pulled
 *     from its address.
 *
 *  2. `matchVenue` / `resolveSubmittedVenue` dedupe free-form submissions
 *     against existing venues BEFORE a duplicate row can be created. A match
 *     is confident when the normalised names are equal (case/punctuation/
 *     whitespace-insensitive, tolerating generic suffixes like "padel club")
 *     OR both carry the same extracted UK postcode. On no match a genuinely
 *     new court is created as before — an unmatched entry is never blocked.
 *
 * All DB access here is async (postgres-js/drizzle) — callers `await`. No
 * network happens in this module (geocoding, which does hit the network, stays
 * in geocode.ts and is triggered by the caller after the row is resolved), so
 * the awaits here are pure DB round-trips.
 */
import { eq, isNotNull, ne } from "drizzle-orm";
import { circles, sessions, standingGames, venues, type CuatroDb, type Venue } from "@cuatro/db";
import { extractUkPostcode } from "./geocode";

// Generic tails we drop when comparing names, so "Powerleague Shoreditch" and
// "Powerleague Shoreditch Padel Club" fold together. Longest-first so the
// multi-word forms strip before the single words they contain. We only ever
// strip a trailing suffix, and never down to an empty string.
const NAME_NOISE_SUFFIXES = [
  "padel club",
  "padel centre",
  "padel center",
  "tennis club",
  "sports club",
  "padel",
  "club",
  "centre",
  "center",
];

/**
 * Fold a venue name to a comparison key: lower-cased, punctuation and runs of
 * whitespace collapsed to single spaces, and one trailing generic suffix
 * removed. "Powerleague Shoreditch" and "powerleague  shoreditch!" and
 * "Powerleague Shoreditch Padel Club" all fold to "powerleague shoreditch".
 */
export function normaliseVenueName(raw: string | null | undefined): string {
  if (!raw) return "";
  const base = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return "";
  for (const suffix of NAME_NOISE_SUFFIXES) {
    if (base.endsWith(" " + suffix)) {
      return base.slice(0, base.length - suffix.length - 1).trim();
    }
  }
  return base;
}

/** A short location hint for a picker row: the postcode outward code ("SW18"), else the last comma-separated chunk of the address, else null. */
export function venueAreaHint(address: string | null | undefined): string | null {
  const postcode = extractUkPostcode(address);
  if (postcode) return postcode.split(" ")[0];
  if (!address) return null;
  const parts = address
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

/**
 * Slugify a venue name into a URL-safe stem: diacritics stripped, everything
 * that isn't a Unicode letter or number collapsed to a single hyphen, trimmed.
 * World-ready — non-Latin scripts survive (\p{L}/\p{N}), so it never assumes
 * ASCII/English. Returns "" for a name with no sluggable characters (the
 * caller substitutes a fallback stem).
 */
export function slugifyVenueName(raw: string | null | undefined): string {
  return (raw ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Generate a unique venue slug for cuatro.app/courts/<slug>. Base is the
 * slugified name; on collision it appends an area/postcode-district
 * disambiguator (the same short hint the picker uses), then a numeric suffix
 * as the last resort — so two "Padel Social Club"s in different areas get
 * distinct, human-readable slugs rather than a naked "-2". Read-only (the
 * caller writes the slug on the venue it's creating); pass `excludeId` when
 * regenerating a slug for an existing row so it doesn't collide with itself.
 * World-ready: the disambiguator falls through name → area → number, no UK
 * hardcoding in the language.
 */
export async function generateVenueSlug(
  db: CuatroDb,
  name: string | null | undefined,
  address: string | null | undefined,
  opts: { excludeId?: string } = {},
): Promise<string> {
  const base = slugifyVenueName(name) || "venue";

  const rows = await db
    .select({ slug: venues.slug })
    .from(venues)
    .where(opts.excludeId ? ne(venues.id, opts.excludeId) : isNotNull(venues.slug));
  const taken = new Set(rows.map((r) => r.slug).filter((s): s is string => !!s));

  if (!taken.has(base)) return base;

  const areaSlug = slugifyVenueName(venueAreaHint(address));
  if (areaSlug) {
    const withArea = `${base}-${areaSlug}`;
    if (!taken.has(withArea)) return withArea;
  }

  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Fetch a venue by its shareable slug (the court-page handle). Null if none. */
export async function getVenueBySlug(db: CuatroDb, slug: string): Promise<Venue | null> {
  const [row] = await db.select().from(venues).where(eq(venues.slug, slug)).limit(1);
  return row ?? null;
}

export type VenueOption = { id: string; name: string; areaHint: string | null };

/**
 * Known venues ordered for the picker: the circle's explicit home court
 * first, then venues this circle has played at (standing games + sessions,
 * alphabetical), then every remaining venue alphabetically. Each carries a
 * short area hint. Global list — venues aren't scoped to a circle, only the
 * ordering is.
 */
export async function listVenuesForCircle(db: CuatroDb, circleId: string): Promise<VenueOption[]> {
  const allVenues = await db.select().from(venues);
  if (allVenues.length === 0) return [];

  const [circle] = await db.select({ homeVenueId: circles.homeVenueId }).from(circles).where(eq(circles.id, circleId));
  const homeVenueId = circle?.homeVenueId ?? null;

  const playedAt = new Set<string>();
  for (const r of await db.select({ venueId: standingGames.venueId }).from(standingGames).where(eq(standingGames.circleId, circleId))) {
    if (r.venueId) playedAt.add(r.venueId);
  }
  for (const r of await db.select({ venueId: sessions.venueId }).from(sessions).where(eq(sessions.circleId, circleId))) {
    if (r.venueId) playedAt.add(r.venueId);
  }

  const byName = (a: Venue, b: Venue) => a.name.localeCompare(b.name);
  const home = allVenues.filter((v) => v.id === homeVenueId);
  const played = allVenues.filter((v) => v.id !== homeVenueId && playedAt.has(v.id)).sort(byName);
  const rest = allVenues.filter((v) => v.id !== homeVenueId && !playedAt.has(v.id)).sort(byName);

  return [...home, ...played, ...rest].map((v) => ({ id: v.id, name: v.name, areaHint: venueAreaHint(v.address) }));
}

export type VenueMatchInput = { name?: string | null; address?: string | null };

/**
 * Find an existing venue that a free-text submission is really the same as,
 * so a duplicate row is never created. Confident match when EITHER both
 * carry the same extracted UK postcode (checked first — a postcode pins a
 * place, while two clubs can share a name across cities) OR the normalised
 * names are equal. Null when nothing matches (a genuinely new court).
 */
export async function matchVenue(db: CuatroDb, input: VenueMatchInput): Promise<Venue | null> {
  const targetName = normaliseVenueName(input.name);
  const targetPostcode = extractUkPostcode(input.address);
  if (!targetName && !targetPostcode) return null;

  const all = await db.select().from(venues);
  if (targetPostcode) {
    for (const v of all) {
      if (extractUkPostcode(v.address) === targetPostcode) return v;
    }
  }
  if (targetName) {
    for (const v of all) {
      if (normaliseVenueName(v.name) === targetName) return v;
    }
  }
  return null;
}

export type SubmittedVenue = { venueId?: string | null; name?: string | null; address?: string | null };

/**
 * What a venue submission resolves to, ready to hand to createStandingGame /
 * updateStandingGame's venue fields:
 *  - "picked":  organiser chose a known venue from the dropdown.
 *  - "matched": free-form text de-duped onto an existing venue (venueAddress
 *               set only when backfilling a previously-address-less row).
 *  - "created": a genuinely new court — pass name (+ address) through to be
 *               inserted as today.
 *  - "none":    nothing usable submitted (leave the venue untouched).
 */
export type VenueResolution = {
  outcome: "picked" | "matched" | "created" | "none";
  venueId?: string;
  venueName?: string;
  venueAddress?: string;
  matchedName?: string;
};

/**
 * Decide how a venue submission (a picked id, or free-form name + address)
 * resolves, applying the dedupe match. Pure decision — it reads to find a
 * match but writes nothing itself; the caller passes the result into
 * create/update (which own the insert/address write) and then geocodes.
 */
export async function resolveSubmittedVenue(db: CuatroDb, input: SubmittedVenue): Promise<VenueResolution> {
  const venueId = input.venueId?.trim() || null;
  const name = input.name?.trim() || null;
  const address = input.address?.trim() || null;

  if (venueId) return { outcome: "picked", venueId };
  if (!name) return { outcome: "none" };

  const match = await matchVenue(db, { name, address });
  if (match) {
    const resolution: VenueResolution = { outcome: "matched", venueId: match.id, matchedName: match.name };
    // Only fill an address we don't already have — never overwrite a good one.
    if (!match.address && address) resolution.venueAddress = address;
    return resolution;
  }
  return { outcome: "created", venueName: name, venueAddress: address ?? undefined };
}
