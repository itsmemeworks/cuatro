/**
 * THE ATLAS marker read model — courts, open seats, and Circles on a map.
 *
 * The map is a PROJECTION OF DISCOVER, not a new data surface: it composes the
 * shipped read models (server/discovery.ts boardGames, server/open-door.ts
 * circleAnchor) and the shared geo layer (lib/geo.ts + server/patch.ts). It
 * invents NO new privacy rules. In particular:
 *
 *  - Never GPS: everything is anchored to the viewer's PATCH (home court →
 *    explicit area → inferred), never a device position. A viewer with no
 *    resolvable patch (or no viewer at all) gets the country view: area
 *    clusters with VENUE COUNTS ONLY, never people, never markers.
 *  - Private Circles never appear, anywhere. Circle counts include only
 *    Circles discoverable in Discover's own universe — non-private (openDoor
 *    OR boardEnabled) AND not ones the viewer already belongs to — exactly the
 *    set nearbyCircles surfaces, grouped per venue instead of per card.
 *  - Open seats are the Board's universe (boardGames): open slots in upcoming
 *    games near the viewer, from board-enabled Circles the viewer is NOT in,
 *    RSVP window open. In-band vs off-band uses the viewer's Glass band.
 *  - People appear only as aggregate counts at venues ("home court to N
 *    players"), never as pins or positions.
 *  - Guests and venues without lat/lng are excluded throughout.
 *
 * Read-only. Other surfaces import getAtlasView + the AtlasView/AtlasMarker
 * types; the signature is frozen (see below).
 */
import { and, eq, gte, inArray, isNotNull, lte, or } from "drizzle-orm";
import {
  circleMembers,
  circles,
  sessions,
  users,
  venues,
  type CuatroDb,
  type IndoorOutdoor,
  type Venue,
} from "@cuatro/db";
import { boundingBox, glassBandFor, haversineKm, type GlassBand, type PatchSize } from "@/lib/geo";
import { resolvePatch, type PatchSource } from "@/server/patch";
import { boardGames } from "@/server/discovery";
import { circleAnchor } from "@/server/open-door";
import { venueAreaHint } from "@/server/venues";
import { extractUkPostcode } from "@/server/geocode";

/** Community-filled court facts as the map/sheet render them. */
export interface VenueFacts {
  indoorOutdoor: IndoorOutdoor | null;
  courtCount: number | null;
}

/** The soonest open seat at a venue — the dashed-marker sub-line ("1 seat · Sun 10:00"). */
export interface AtlasSoonestSeat {
  sessionId: string;
  startsAtMs: number;
  /** In the viewer's Glass band → eligible for the single dashed-CORAL marker; else dashed-bone. */
  inBand: boolean;
}

/** One venue marker on the map. */
export interface AtlasMarker {
  venueId: string;
  slug: string | null;
  name: string;
  lat: number;
  lng: number;
  /** The venue's IANA timezone — format `soonestOpenSeat.startsAtMs` in THIS zone (world-ready law; runtime is UTC). */
  timezone: string;
  facts: VenueFacts;
  /** Total open slots across this venue's board games near the viewer (0 = no open seat). */
  openSeatCount: number;
  /** The soonest of those open-seat games (for the dashed marker), or null when none. */
  soonestOpenSeat: AtlasSoonestSeat | null;
  /** Open + invite-only Circles anchored here that the viewer can discover (never private, never the viewer's own). */
  circleCount: number;
  /** Findable, non-guest players whose home court is this venue ("home court to N players"). */
  homeToCount: number;
  /** This is the viewer's own home court. */
  isViewerHome: boolean;
  /** No CUATRO activity here at all (no discoverable Circles, no games ever, no home players). */
  quiet: boolean;
}

/** A country-view cluster: an area's venue count only. Never carries people. */
export interface AtlasCluster {
  /** Coarse area key (UK postcode area letters, else the address locality, else country code). */
  area: string;
  venueCount: number;
  /** Centroid of the area's venues, so the cluster can be placed on the map. */
  lat: number;
  lng: number;
}

/** The viewer's resolved patch as the map needs it (camera home + reach). */
export interface AtlasPatch {
  lat: number;
  lng: number;
  size: PatchSize;
  radiusKm: number;
  source: PatchSource;
  /** A coarse name for the patch's area (the home venue's postcode district / locality), for copy like the sparse-town card; null unless the patch anchors on a home venue with an address. */
  areaLabel: string | null;
}

/** The whole Atlas view for one viewer (or the anonymous country view). */
export interface AtlasView {
  /** Null → no resolvable patch → country view (clusters only, no markers). */
  patch: AtlasPatch | null;
  /** The viewer's Glass band, for the in-band/off-band marker split; null when unrated or no viewer. */
  band: GlassBand | null;
  /** Venue markers within the patch (empty in the country view). */
  markers: AtlasMarker[];
  /** Country-view aggregate — venue counts by area, viewer-independent, never people. */
  clusters: AtlasCluster[];
}

/**
 * Coarse area key for country-view clustering. Prefers the UK postcode AREA
 * (the leading letters of the outward code, e.g. "E", "EC", "SW") which groups
 * roughly by post town; falls back to the address locality, then the country
 * code. World-ready: no UK is assumed, the postcode branch simply doesn't fire
 * for a non-UK address and the locality/country fallback carries it.
 */
function areaKeyFor(venue: Venue): string {
  const pc = extractUkPostcode(venue.address);
  if (pc) {
    const letters = pc.split(" ")[0]?.match(/^[A-Za-z]+/)?.[0];
    if (letters) return letters.toUpperCase();
  }
  const hint = venueAreaHint(venue.address);
  if (hint) return hint;
  return venue.countryCode;
}

/** Build the viewer-independent country-view clusters over every pinned venue. */
async function buildClusters(db: CuatroDb): Promise<AtlasCluster[]> {
  const pinned = await db
    .select()
    .from(venues)
    .where(and(isNotNull(venues.lat), isNotNull(venues.lng)));

  const acc = new Map<string, { count: number; sumLat: number; sumLng: number }>();
  for (const v of pinned) {
    if (v.lat == null || v.lng == null) continue;
    const key = areaKeyFor(v);
    const cur = acc.get(key) ?? { count: 0, sumLat: 0, sumLng: 0 };
    cur.count += 1;
    cur.sumLat += v.lat;
    cur.sumLng += v.lng;
    acc.set(key, cur);
  }

  return [...acc.entries()]
    .map(([area, { count, sumLat, sumLng }]) => ({
      area,
      venueCount: count,
      lat: sumLat / count,
      lng: sumLng / count,
    }))
    .sort((a, b) => b.venueCount - a.venueCount || a.area.localeCompare(b.area));
}

/** Does a board game's confirmed-player level overlap the viewer's Glass band? Unknown (unrated) matches, per the geo contract. */
function gameInBand(ratings: (number | null)[], band: GlassBand | null): boolean {
  if (!band) return true; // unrated viewer → no band filter (matches withinGlassBand)
  const rated = ratings.filter((r): r is number => r != null);
  if (rated.length === 0) return true; // levels still forming → don't exclude
  const min = Math.min(...rated);
  const max = Math.max(...rated);
  return min <= band.max && max >= band.min;
}

/**
 * The Atlas view for a viewer (or the anonymous country view when `viewerId`
 * is null or has no resolvable patch).
 *
 * SIGNATURE FROZEN: `getAtlasView(db, viewerId: string | null): Promise<AtlasView>`.
 * `opts.now` is an additive test seam only — callers import and call it with
 * two arguments.
 */
export async function getAtlasView(
  db: CuatroDb,
  viewerId: string | null,
  opts: { now?: Date } = {},
): Promise<AtlasView> {
  const now = opts.now ?? new Date();

  // Country-view clusters are viewer-independent and always computed (they also
  // power zoom-out); markers layer on top only when a patch resolves.
  const clusters = await buildClusters(db);

  const patch = viewerId ? await resolvePatch(db, viewerId) : null;
  if (!viewerId || !patch) {
    return { patch: null, band: null, markers: [], clusters };
  }

  const [viewer] = await db
    .select({ rating: users.rating, homeVenueId: users.homeVenueId })
    .from(users)
    .where(eq(users.id, viewerId));
  const band = glassBandFor(viewer?.rating ?? null);
  const viewerHomeVenueId = viewer?.homeVenueId ?? null;

  // Name the patch's area from the home venue's address (postcode district /
  // locality) for copy like the sparse-town card. Only the home-venue anchor
  // has a single canonical venue to name; explicit/inferred patches → null.
  let areaLabel: string | null = null;
  if (patch.source === "home_venue" && viewerHomeVenueId) {
    const [hv] = await db.select({ address: venues.address }).from(venues).where(eq(venues.id, viewerHomeVenueId));
    areaLabel = venueAreaHint(hv?.address ?? null);
  }

  const resolvedPatch: AtlasPatch = {
    lat: patch.lat,
    lng: patch.lng,
    size: patch.size,
    radiusKm: patch.radiusKm,
    source: patch.source,
    areaLabel,
  };

  // Candidate venues: pinned, inside the patch box, refined by exact haversine.
  const box = boundingBox(patch.lat, patch.lng, patch.radiusKm);
  const boxed = await db
    .select()
    .from(venues)
    .where(
      and(
        isNotNull(venues.lat),
        isNotNull(venues.lng),
        gte(venues.lat, box.minLat),
        lte(venues.lat, box.maxLat),
        gte(venues.lng, box.minLng),
        lte(venues.lng, box.maxLng),
      ),
    );
  const near = boxed.filter(
    (v) => v.lat != null && v.lng != null && haversineKm(patch.lat, patch.lng, v.lat, v.lng) <= patch.radiusKm,
  );
  if (near.length === 0) {
    return { patch: resolvedPatch, band, markers: [], clusters };
  }
  const nearIds = near.map((v) => v.id);
  const nearIdSet = new Set(nearIds);

  // --- Open seats per venue (compose The Board) ---------------------------
  // boardGames already applies every gate (patch, board-enabled Circles the
  // viewer isn't in, RSVP window, open-slot, coarse distance). It exposes the
  // sessionId but not the venue id, so map session → venue with one query.
  const board = await boardGames(db, viewerId, { radiusKm: patch.radiusKm, now });
  const sessionVenue = new Map<string, string | null>();
  if (board.length > 0) {
    const rows = await db
      .select({ id: sessions.id, venueId: sessions.venueId })
      .from(sessions)
      .where(inArray(sessions.id, board.map((g) => g.sessionId)));
    for (const r of rows) sessionVenue.set(r.id, r.venueId);
  }
  const openByVenue = new Map<string, { openSeatCount: number; soonest: AtlasSoonestSeat | null }>();
  for (const g of board) {
    const venueId = sessionVenue.get(g.sessionId);
    if (!venueId || !nearIdSet.has(venueId)) continue;
    const cur = openByVenue.get(venueId) ?? { openSeatCount: 0, soonest: null };
    cur.openSeatCount += g.slotsOpen;
    const startsAtMs = g.startsAt.getTime();
    if (!cur.soonest || startsAtMs < cur.soonest.startsAtMs) {
      cur.soonest = { sessionId: g.sessionId, startsAtMs, inBand: gameInBand(g.confirmed.map((c) => c.rating), band) };
    }
    openByVenue.set(venueId, cur);
  }

  // --- Circle counts per venue (Discover's universe, grouped per venue) ----
  // Non-private Circles (openDoor OR boardEnabled) the viewer is NOT in, keyed
  // by their canonical anchor venue (the same circleAnchor Open Door uses).
  const memberRows = await db
    .select({ circleId: circleMembers.circleId })
    .from(circleMembers)
    .where(eq(circleMembers.userId, viewerId));
  const memberCircleIds = new Set(memberRows.map((r) => r.circleId));
  const visibleCircles = await db
    .select({ id: circles.id })
    .from(circles)
    .where(or(eq(circles.openDoor, true), eq(circles.boardEnabled, true)));
  const circleCountByVenue = new Map<string, number>();
  for (const c of visibleCircles) {
    if (memberCircleIds.has(c.id)) continue;
    const anchor = await circleAnchor(db, c.id);
    if (anchor && nearIdSet.has(anchor.venueId)) {
      circleCountByVenue.set(anchor.venueId, (circleCountByVenue.get(anchor.venueId) ?? 0) + 1);
    }
  }

  // --- "home court to N players" (findable, non-guest) ---------------------
  const homeRows = await db
    .select({ homeVenueId: users.homeVenueId })
    .from(users)
    .where(and(inArray(users.homeVenueId, nearIds), eq(users.findable, true), eq(users.isGuest, false)));
  const homeToByVenue = new Map<string, number>();
  for (const r of homeRows) {
    if (!r.homeVenueId) continue;
    homeToByVenue.set(r.homeVenueId, (homeToByVenue.get(r.homeVenueId) ?? 0) + 1);
  }

  // --- Any session ever (so a venue with history isn't "quiet") ------------
  const sessionVenues = await db
    .select({ venueId: sessions.venueId })
    .from(sessions)
    .where(inArray(sessions.venueId, nearIds));
  const hasSessions = new Set(sessionVenues.map((r) => r.venueId).filter((v): v is string => !!v));

  const markers: AtlasMarker[] = near.map((v) => {
    const open = openByVenue.get(v.id);
    const circleCount = circleCountByVenue.get(v.id) ?? 0;
    const homeToCount = homeToByVenue.get(v.id) ?? 0;
    const isViewerHome = viewerHomeVenueId != null && v.id === viewerHomeVenueId;
    const openSeatCount = open?.openSeatCount ?? 0;
    const hasActivity = circleCount > 0 || openSeatCount > 0 || homeToCount > 0 || hasSessions.has(v.id);
    return {
      venueId: v.id,
      slug: v.slug,
      name: v.name,
      lat: v.lat!,
      lng: v.lng!,
      timezone: v.timezone,
      facts: { indoorOutdoor: v.indoorOutdoor ?? null, courtCount: v.courtCount ?? null },
      openSeatCount,
      soonestOpenSeat: open?.soonest ?? null,
      circleCount,
      homeToCount,
      isViewerHome,
      quiet: !hasActivity && !isViewerHome,
    };
  });

  // Stable, useful order: open seats first, then busier venues, then nearest.
  markers.sort(
    (a, b) =>
      Number(b.openSeatCount > 0) - Number(a.openSeatCount > 0) ||
      b.circleCount - a.circleCount ||
      b.homeToCount - a.homeToCount ||
      haversineKm(patch.lat, patch.lng, a.lat, a.lng) - haversineKm(patch.lat, patch.lng, b.lat, b.lng),
  );

  return { patch: resolvedPatch, band, markers, clusters };
}
