/**
 * THE LOCAL RING — Fourth Call ring 2's real engine.
 *
 * When a Circle can't fill a game (ring 1 goes quiet), the Fourth Call widens
 * to nearby, level-matched, findable players: "the game finds the player, not
 * the other way round." This module answers only one question — *who are those
 * players?* — as a pure, read-only candidate query. The escalation itself
 * (inserting the invites, the never-nag-twice gate, realtime) lives in
 * games-service.ts's checkFourthCallLocalRing, which consumes this.
 *
 * It is the geo contract's §6(b) Local Ring, ANCHORED AT THE SESSION'S VENUE
 * PIN (the game's location) rather than a single viewer — a Fourth Call has no
 * one viewer. Rules that are law (see lib/geo.ts + server/patch.ts):
 *   - venue-anchored, never device GPS; an unpinned venue can't host a ring.
 *   - two-step distance: cheap SQL bounding-box pre-filter, then exact
 *     haversine refine in JS (SQLite has no trig).
 *   - Glass band around the game's level context (the confirmed players'
 *     average rating); an unrated candidate matches any band.
 *   - findable = 1 AND a resolvable patch; guests and the session's own
 *     participants excluded; distances never leak (caller labels them coarse).
 *
 * ASYNC BY NECESSITY: resolvePatch (inferred-only candidates) and the geo
 * queries are async, so this runs OUTSIDE any better-sqlite3 transaction — the
 * caller does the synchronous insert once it has the list. That's why this is
 * a separate function from the escalation, not folded into its transaction.
 */
import { and, eq, gte, isNotNull, isNull, lte, notInArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { rsvps, sessions, users, venues, type CuatroDb } from "@cuatro/db";
import {
  boundingBox,
  DEFAULT_RADIUS_KM,
  glassBandFor,
  haversineKm,
  withinGlassBand,
  withinRadius,
} from "@/lib/geo";
import { resolvePatch } from "./patch";

/** Never notify a whole city: one escalation reaches at most this many nearby players. */
export const LOCAL_RING_FANOUT_CAP = 8;

export interface LocalRingCandidate {
  userId: string;
  rating: number | null;
  /** Exact great-circle km from the session venue — for ordering only; never surface it raw (use coarseDistanceLabel). */
  distanceKm: number;
  /** Show-up rate as a fraction 0..1, or null when the player has no RSVP history yet. */
  reliability: number | null;
}

export interface LocalRingOptions {
  radiusKm?: number;
  limit?: number;
  /** Players to leave out entirely — the escalation passes everyone already invited/declined for this session (never nag twice). */
  excludeUserIds?: string[];
}

type CandidateRow = {
  id: string;
  rating: number | null;
  showUpCount: number;
  rsvpInCount: number;
  lat: number | null;
  lng: number | null;
};

function reliabilityOf(row: { showUpCount: number; rsvpInCount: number }): number | null {
  return row.rsvpInCount > 0 ? Math.min(1, row.showUpCount / row.rsvpInCount) : null;
}

/**
 * Nearby, level-matched, findable players for a session short of a four,
 * ordered by Reliability (attendance) then proximity, capped at `limit`
 * (default {@link LOCAL_RING_FANOUT_CAP}). Returns [] when the session has no
 * pinned venue to anchor on — an unpinned venue is simply not on the map.
 *
 * "The game's level context" is the mean of the confirmed slot-holders'
 * ratings (unrated participants don't contribute one). Candidates are matched
 * within ±GLASS_BAND of it; if no confirmed player is rated yet there's no
 * band to apply and everyone nearby qualifies. Unrated candidates always pass
 * the band (per the geo contract: unrated is "we don't know yet", not
 * "exclude").
 */
export async function localRingCandidates(
  db: CuatroDb,
  sessionId: string,
  options: LocalRingOptions = {},
): Promise<LocalRingCandidate[]> {
  const radiusKm = options.radiusKm ?? DEFAULT_RADIUS_KM;
  const limit = options.limit ?? LOCAL_RING_FANOUT_CAP;

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!session || !session.venueId) return [];

  const [venue] = await db.select().from(venues).where(eq(venues.id, session.venueId)).limit(1);
  if (!venue || venue.lat == null || venue.lng == null) return []; // unpinned venue → no ring

  const anchorLat = venue.lat;
  const anchorLng = venue.lng;

  // Level context + self-exclusion: the confirmed slot-holders.
  const confirmed = await db
    .select({ userId: rsvps.userId, rating: users.rating })
    .from(rsvps)
    .innerJoin(users, eq(users.id, rsvps.userId))
    .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "in")));

  const confirmedRatings = confirmed.map((c) => c.rating).filter((r): r is number => r != null);
  const bandCenter =
    confirmedRatings.length > 0 ? confirmedRatings.reduce((a, b) => a + b, 0) / confirmedRatings.length : null;
  const band = glassBandFor(bandCenter);

  const excluded = new Set<string>([...confirmed.map((c) => c.userId), ...(options.excludeUserIds ?? [])]);
  const excludedIds = [...excluded];

  const box = boundingBox(anchorLat, anchorLng, radiusKm);

  // A rated candidate must sit inside the band; an unrated one (rating IS
  // NULL) always passes. `undefined` drops the clause entirely when the game
  // has no rated slot-holder to anchor a band on.
  const bandClause = band
    ? or(isNull(users.rating), and(gte(users.rating, band.min), lte(users.rating, band.max)))
    : undefined;
  const notExcluded = excludedIds.length ? notInArray(users.id, excludedIds) : undefined;

  // (1) Home-venue-pinned candidates — the home venue IS their pin (only when
  // it's geocoded), matching resolvePatch's first priority. Bounding-box on
  // the venue's lat/lng; JS refines below.
  const homeRows: CandidateRow[] = await db
    .select({
      id: users.id,
      rating: users.rating,
      showUpCount: users.showUpCount,
      rsvpInCount: users.rsvpInCount,
      lat: venues.lat,
      lng: venues.lng,
    })
    .from(users)
    .innerJoin(venues, eq(venues.id, users.homeVenueId))
    .where(
      and(
        eq(users.findable, true),
        eq(users.isGuest, false),
        isNotNull(venues.lat),
        isNotNull(venues.lng),
        gte(venues.lat, box.minLat),
        lte(venues.lat, box.maxLat),
        gte(venues.lng, box.minLng),
        lte(venues.lng, box.maxLng),
        bandClause,
        notExcluded,
      ),
    );

  // (2) Explicit-patch candidates — only when there is NO pinned home venue
  // (resolvePatch prefers a pinned home over an explicit patch). Left-join the
  // home venue and require it be absent/unpinned so home-pinned players (whose
  // true anchor is their venue, handled above) don't leak in via a patch that
  // happens to fall in the box.
  const homeVenue = alias(venues, "home_venue");
  const explicitRows: CandidateRow[] = await db
    .select({
      id: users.id,
      rating: users.rating,
      showUpCount: users.showUpCount,
      rsvpInCount: users.rsvpInCount,
      lat: users.patchLat,
      lng: users.patchLng,
    })
    .from(users)
    .leftJoin(homeVenue, eq(homeVenue.id, users.homeVenueId))
    .where(
      and(
        eq(users.findable, true),
        eq(users.isGuest, false),
        isNull(homeVenue.lat), // no home venue, or its venue isn't pinned
        isNotNull(users.patchLat),
        isNotNull(users.patchLng),
        gte(users.patchLat, box.minLat),
        lte(users.patchLat, box.maxLat),
        gte(users.patchLng, box.minLng),
        lte(users.patchLng, box.maxLng),
        bandClause,
        notExcluded,
      ),
    );

  // (3) Inferred-only candidates — no pinned home, no explicit patch. Their
  // anchor is the pinned venue they most often play at, which only resolvePatch
  // can derive, so we can't box-filter them in SQL. Narrow to the still-eligible
  // pool (findable, non-guest, in-band, not excluded, genuinely pin-less) first,
  // then resolve + radius-check each. Bounded by the band + fan-out at this
  // scale; a larger deployment would materialise patches instead.
  const inferredPool = await db
    .select({
      id: users.id,
      rating: users.rating,
      showUpCount: users.showUpCount,
      rsvpInCount: users.rsvpInCount,
    })
    .from(users)
    .leftJoin(homeVenue, eq(homeVenue.id, users.homeVenueId))
    .where(
      and(
        eq(users.findable, true),
        eq(users.isGuest, false),
        isNull(homeVenue.lat),
        isNull(users.patchLat),
        isNull(users.patchLng),
        bandClause,
        notExcluded,
      ),
    );

  const inferredRows: CandidateRow[] = [];
  for (const u of inferredPool) {
    const patch = await resolvePatch(db, u.id);
    if (!patch) continue;
    inferredRows.push({ ...u, lat: patch.lat, lng: patch.lng });
  }

  // Home / explicit / inferred are mutually exclusive by construction, so no
  // dedupe is needed. Refine every row against the exact circle + band (belt
  // and braces — the SQL box over-selects and can't express the band for the
  // unrated), then order by Reliability, then proximity.
  const refined = [...homeRows, ...explicitRows, ...inferredRows]
    .filter((r) => r.lat != null && r.lng != null)
    .filter((r) => withinRadius(anchorLat, anchorLng, r.lat!, r.lng!, radiusKm))
    .filter((r) => withinGlassBand(bandCenter, r.rating))
    .map((r) => ({
      userId: r.id,
      rating: r.rating,
      distanceKm: haversineKm(anchorLat, anchorLng, r.lat!, r.lng!),
      reliability: reliabilityOf(r),
    }));

  refined.sort((a, b) => {
    // Reliability first (higher shows-up-rate wins); a player with no history
    // yet (null) sorts after any player with a track record. Ties break by
    // proximity, nearest first.
    const ra = a.reliability;
    const rb = b.reliability;
    if (ra != null && rb != null && ra !== rb) return rb - ra;
    if (ra == null && rb != null) return 1;
    if (ra != null && rb == null) return -1;
    return a.distanceKm - b.distanceKm;
  });

  return refined.slice(0, limit);
}
