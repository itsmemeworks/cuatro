/**
 * Patch resolution — "where on the map is this player?" for venue-anchored
 * discovery. There is NO device GPS anywhere in CUATRO; a player's patch is
 * derived, in strict priority order:
 *
 *   1. home_venue — their chosen home club's pin (users.homeVenueId → a
 *      venue with lat/lng). If the home venue exists but isn't geocoded yet,
 *      there's no pin, so we fall through.
 *   2. explicit   — an area they picked themselves (users.patchLat/patchLng).
 *   3. inferred   — the pinned venue they most often play at / RSVP to.
 *   4. null       — nothing to place them by (yet).
 *
 * Discovery being on-by-default (users.findable) only becomes *active* once a
 * patch resolves: a findable player whose patch is null is simply not on the
 * map. `resolvePatch` deliberately does NOT check `findable` — that gate
 * belongs to the discovery queries, which combine `findable = 1` with a
 * resolved patch. Guests are excluded by those queries too, not here.
 */
import { eq, inArray, or } from 'drizzle-orm'
import { matches, rsvps, sessions, users, venues } from '@cuatro/db'
import type { CuatroDb } from '@cuatro/db'
import { patchRadiusKm, type PatchSize } from '@/lib/geo'

export type PatchSource = 'home_venue' | 'explicit' | 'inferred'
/**
 * A resolved patch carries the anchor point AND the viewer's chosen patch size
 * (THE ATLAS) with its resolved radius. `size`/`radiusKm` are additive: existing
 * consumers read only lat/lng/source and are unaffected; the Atlas map uses
 * `radiusKm` as its "near you" reach instead of the board's fixed DEFAULT_RADIUS_KM.
 */
export type ResolvedPatch =
  | { lat: number; lng: number; source: PatchSource; size: PatchSize; radiusKm: number }
  | null

/**
 * Resolve a user's discovery patch (see file header for the priority order).
 * Returns null when no anchor is available. Read-only; safe to call from any
 * server context with the shared db.
 */
export async function resolvePatch(db: CuatroDb, userId: string): Promise<ResolvedPatch> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) return null

  // The viewer's patch size travels with every resolved patch (see ResolvedPatch).
  const size = user.patchSize as PatchSize
  const radiusKm = patchRadiusKm(size)

  // 1. Home venue pin.
  if (user.homeVenueId) {
    const [home] = await db.select().from(venues).where(eq(venues.id, user.homeVenueId)).limit(1)
    if (home && home.lat != null && home.lng != null) {
      return { lat: home.lat, lng: home.lng, source: 'home_venue', size, radiusKm }
    }
  }

  // 2. Explicit chosen area.
  if (user.patchLat != null && user.patchLng != null) {
    return { lat: user.patchLat, lng: user.patchLng, source: 'explicit', size, radiusKm }
  }

  // 3. Inferred from where they actually play. Gather venue ids from every
  // session they RSVP'd to and every match they played in, tally, and take
  // the most frequent PINNED venue (ties broken by venue id for determinism).
  const rsvpRows = await db
    .select({ venueId: sessions.venueId })
    .from(rsvps)
    .innerJoin(sessions, eq(rsvps.sessionId, sessions.id))
    .where(eq(rsvps.userId, userId))

  const matchRows = await db
    .select({ venueId: sessions.venueId })
    .from(matches)
    .innerJoin(sessions, eq(matches.sessionId, sessions.id))
    .where(
      or(
        eq(matches.teamAPlayer1Id, userId),
        eq(matches.teamAPlayer2Id, userId),
        eq(matches.teamBPlayer1Id, userId),
        eq(matches.teamBPlayer2Id, userId),
      ),
    )

  const counts = new Map<string, number>()
  for (const row of [...rsvpRows, ...matchRows]) {
    if (!row.venueId) continue
    counts.set(row.venueId, (counts.get(row.venueId) ?? 0) + 1)
  }
  if (counts.size === 0) return null

  const candidateIds = [...counts.keys()]
  const pinned = await db.select().from(venues).where(inArray(venues.id, candidateIds))
  let best: { lat: number; lng: number; count: number; id: string } | null = null
  for (const venue of pinned) {
    if (venue.lat == null || venue.lng == null) continue
    const count = counts.get(venue.id) ?? 0
    if (
      !best ||
      count > best.count ||
      (count === best.count && venue.id < best.id)
    ) {
      best = { lat: venue.lat, lng: venue.lng, count, id: venue.id }
    }
  }
  if (best) return { lat: best.lat, lng: best.lng, source: 'inferred', size, radiusKm }

  return null
}
