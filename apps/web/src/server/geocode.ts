/**
 * Venue geocoding — turns a venue's free-text address into a lat/lng pin so
 * it can anchor discovery. UK-only source: postcodes.io (free, no API key,
 * https://api.postcodes.io). We extract a UK postcode from the address and
 * look it up; venues without a resolvable postcode simply stay unpinned, and
 * discovery queries skip unpinned venues (they can never appear on the map,
 * but nothing breaks).
 *
 * SERVER-SIDE ONLY, and never on a user-facing hot path: geocoding hits the
 * network with a short timeout, so it runs at venue create/update time
 * (fire-and-forget) and via the backfill below (`npx tsx src/server/geocode.ts`).
 * The pin is cached on the venue row itself (venues.lat/lng), so we geocode
 * a given postcode at most once per venue.
 *
 * Deliberately dependency-free of the app's `@/*` alias so the backfill can
 * run under a bare `tsx` invocation.
 */
import { eq } from 'drizzle-orm'
import { createClient, venues } from '@cuatro/db'
import type { CuatroClient } from '@cuatro/db'

/**
 * UK postcode matcher. Handles the full outward+inward form (e.g. "EC2A 3AR",
 * "E1 6AN", "SW1A 1AA") with or without the internal space, case-insensitive.
 * Anchored loosely so it can pluck a postcode out of a longer address string.
 * Based on the standard UK government pattern, relaxed on the optional space.
 */
const UK_POSTCODE_RE =
  /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i

/** Pulls the first UK postcode out of a free-text address, normalised to "OUT IN" upper-case. Null if none. */
export function extractUkPostcode(address: string | null | undefined): string | null {
  if (!address) return null
  const m = address.match(UK_POSTCODE_RE)
  if (!m) return null
  return `${m[1]} ${m[2]}`.toUpperCase()
}

export type GeoPoint = { lat: number; lng: number }

const POSTCODES_IO_BASE = 'https://api.postcodes.io/postcodes/'
const GEOCODE_TIMEOUT_MS = 4000

/**
 * Look up a single UK postcode's lat/lng via postcodes.io. Returns null on
 * any failure (bad postcode, network, timeout, unexpected shape) — callers
 * treat null as "leave this venue unpinned", never as an error to surface.
 */
export async function geocodePostcode(postcode: string): Promise<GeoPoint | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS)
  try {
    const res = await fetch(POSTCODES_IO_BASE + encodeURIComponent(postcode.trim()), {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return null
    const body = (await res.json()) as { result?: { latitude?: number; longitude?: number } }
    const lat = body.result?.latitude
    const lng = body.result?.longitude
    if (typeof lat !== 'number' || typeof lng !== 'number') return null
    return { lat, lng }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Convenience: extract a postcode from a free-text address and geocode it. Null if no postcode or lookup fails. */
export async function geocodeAddress(address: string | null | undefined): Promise<GeoPoint | null> {
  const postcode = extractUkPostcode(address)
  if (!postcode) return null
  return geocodePostcode(postcode)
}

/**
 * Geocode one venue by id and, on success, write lat/lng back onto its row
 * (the cache). No-op if the venue is missing, already pinned, or has no
 * resolvable postcode. Returns the pin written, or null. Safe to call
 * fire-and-forget from a venue create/update action — it never throws.
 */
export async function geocodeVenueById(client: CuatroClient, venueId: string): Promise<GeoPoint | null> {
  try {
    const [venue] = await client.db.select().from(venues).where(eq(venues.id, venueId)).limit(1)
    if (!venue) return null
    if (venue.lat != null && venue.lng != null) return { lat: venue.lat, lng: venue.lng }
    const point = await geocodeAddress(venue.address)
    if (!point) return null
    await client.db.update(venues).set({ lat: point.lat, lng: point.lng }).where(eq(venues.id, venueId))
    return point
  } catch {
    return null
  }
}

export type BackfillResult = { total: number; alreadyPinned: number; pinned: number; unresolved: number }

/**
 * Geocode every venue that has an address but no lat/lng yet, writing pins
 * back onto the rows. Sequential (postcodes.io is a shared free service — no
 * hammering) with a small delay between calls. Idempotent: already-pinned
 * venues are skipped, so it's safe to re-run.
 */
export async function backfillVenueGeocodes(client: CuatroClient): Promise<BackfillResult> {
  const rows = await client.db.select().from(venues)
  const result: BackfillResult = { total: rows.length, alreadyPinned: 0, pinned: 0, unresolved: 0 }
  for (const venue of rows) {
    if (venue.lat != null && venue.lng != null) {
      result.alreadyPinned++
      continue
    }
    const point = await geocodeAddress(venue.address)
    if (!point) {
      result.unresolved++
      continue
    }
    await client.db.update(venues).set({ lat: point.lat, lng: point.lng }).where(eq(venues.id, venue.id))
    result.pinned++
    await new Promise((r) => setTimeout(r, 120))
  }
  return result
}

async function main() {
  const client = createClient()
  const result = await backfillVenueGeocodes(client)
  console.log(`[@cuatro/geocode] backfill: ${JSON.stringify(result)}`)
  client.close()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
