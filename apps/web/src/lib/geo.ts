/**
 * Pure geo helpers for CUATRO's venue-anchored discovery. NO device GPS,
 * NO dependencies — every function here is deterministic and unit-testable.
 *
 * The distance model is deliberately coarse. Discovery is anchored to a
 * player's *venue* (their home club, chosen patch, or where they actually
 * play — see server/patch.ts), never to a live device position, and the
 * labels we surface round hard so we never imply we know exactly where
 * someone is. Two-step querying is the intended pattern: pre-filter rows
 * with the cheap SQL bounding box (`boundingBox`), then refine the survivors
 * in JS with the exact great-circle test (`withinRadius`). SQLite has no
 * trig without an extension, so distance never belongs in the WHERE clause.
 */

/** Default discovery radius. A player with no explicit radius is matched within this. */
export const DEFAULT_RADIUS_KM = 10

/**
 * THE ATLAS patch sizes — the coarse, human "how far is near me?" control on
 * the map (never surfaced as kilometres). Three fixed radii in km; the UI
 * renders them as tight / local / wide with copy, never numbers. Stored per
 * user as `users.patchSize`; resolve to a radius with `patchRadiusKm`.
 */
export const PATCH_SIZES = { tight: 1.2, local: 2.5, wide: 5 } as const
export type PatchSize = keyof typeof PATCH_SIZES

/** The discovery radius (km) for a patch size. Falls back to 'local' for anything unrecognised. */
export function patchRadiusKm(size: PatchSize | string | null | undefined): number {
  if (size != null && size in PATCH_SIZES) return PATCH_SIZES[size as PatchSize]
  return PATCH_SIZES.local
}

/**
 * GLASS band half-width. Two rated players are "a fair match" when their
 * Glass numbers are within ±GLASS_BAND of each other. The Glass scale is
 * 1.00–7.00, so 0.75 is roughly one skill tier.
 */
export const GLASS_BAND = 0.75

const EARTH_RADIUS_KM = 6371

const toRad = (deg: number) => (deg * Math.PI) / 180

/** Great-circle distance between two lat/lng points, in kilometres. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** True when two points are within `radiusKm` of each other (inclusive). */
export function withinRadius(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  radiusKm: number = DEFAULT_RADIUS_KM,
): boolean {
  return haversineKm(lat1, lng1, lat2, lng2) <= radiusKm
}

export type BoundingBox = { minLat: number; maxLat: number; minLng: number; maxLng: number }

/**
 * A lat/lng bounding box that fully contains the `radiusKm` circle around a
 * point — the cheap, index-friendly SQL pre-filter before the exact
 * `withinRadius` refine. Over-selects (a box is bigger than its circle); the
 * JS refine trims the corners. Longitude degrees shrink with latitude, so we
 * widen the longitude span by 1/cos(lat). Clamped so it stays valid near the
 * poles; longitude is NOT wrapped across the antimeridian (irrelevant for a
 * UK launch, and a wrapped box can't be expressed as a single BETWEEN).
 */
export function boundingBox(lat: number, lng: number, radiusKm: number = DEFAULT_RADIUS_KM): BoundingBox {
  const latDelta = (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI)
  const cosLat = Math.max(0.0001, Math.cos(toRad(lat)))
  const lngDelta = latDelta / cosLat
  return {
    minLat: Math.max(-90, lat - latDelta),
    maxLat: Math.min(90, lat + latDelta),
    minLng: Math.max(-180, lng - lngDelta),
    maxLng: Math.min(180, lng + lngDelta),
  }
}

/**
 * Coarse, privacy-preserving distance bucket in km. Rounds up to the nearest
 * whole km, so "0.3 km" and "0.9 km" both read as ~1. Anything beyond 25 km
 * saturates at 25 (callers render it as "25+ km"). This is the number a UI
 * layer formats; use `coarseDistanceLabel` for the default en-GB string.
 */
export function coarseDistanceKm(km: number): number {
  if (km <= 0) return 0
  if (km >= 25) return 25
  return Math.max(1, Math.ceil(km))
}

/**
 * Default en-GB rendering of a coarse distance, e.g. "~3 km away". Kept
 * simple and separable: the leading "~" and trailing "away" are the only
 * copy here, and `coarseDistanceKm` holds the (i18n-independent) bucketing
 * so other locales can format the number themselves.
 */
export function coarseDistanceLabel(km: number): string {
  const bucket = coarseDistanceKm(km)
  if (bucket === 0) return 'here'
  if (bucket >= 25) return '25+ km away'
  return `~${bucket} km away`
}

export type GlassBand = { min: number; max: number }

/**
 * The Glass rating window a rated player fairly matches into, [rating −
 * GLASS_BAND, rating + GLASS_BAND]. Returns `null` for an unrated player
 * (rating === null): the unrated are not *excluded* from discovery, they
 * match ANY band — so a null here means "apply no band filter". Use this to
 * build the SQL range around a viewer's own rating; use `withinGlassBand`
 * for a pairwise predicate.
 */
export function glassBandFor(rating: number | null): GlassBand | null {
  if (rating == null) return null
  return { min: rating - GLASS_BAND, max: rating + GLASS_BAND }
}

/**
 * Pairwise band test. True if EITHER player is unrated (null matches
 * anyone — unrated is "we don't know yet", not "exclude") or their Glass
 * numbers are within GLASS_BAND of each other.
 */
export function withinGlassBand(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return true
  return Math.abs(a - b) <= GLASS_BAND
}
