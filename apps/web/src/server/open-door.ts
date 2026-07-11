/**
 * Open Door — the venue-anchored directory of Circles that welcome new
 * players, plus the knock lifecycle (a player asks their way in; the
 * organiser decides). Composes the shared geo layer (lib/geo.ts +
 * server/patch.ts + the geo contract) — it never reimplements distance,
 * banding, or patch logic, and never adds geo columns.
 *
 * A CIRCLE'S ANCHOR (the design choice this wave had to make): a Circle is a
 * persistent group that can play across several venues, so for a directory it
 * needs ONE canonical location — unlike The Board, which anchors each Circle
 * to whichever of its venues is nearest the *viewer*. Open Door anchors a
 * Circle to its MOST-USED pinned venue: the pinned venue that appears most
 * across its Standing Games and its sessions (ties broken by venue id, for
 * determinism). That reads as the Circle's home club, which is what a player
 * choosing a group to join actually cares about — "where do these people
 * usually play?", not "which of their courts is closest to me today". A
 * Circle whose venues are all unpinned has no anchor and never surfaces.
 *
 * WHAT A KNOCKER MAY SEE (privacy): the directory card and its preview expose
 * only public, group-level facts — emblem, name, one vibe line, the anchor
 * venue's *name* (never its coordinates), a coarse distance bucket, the member
 * Glass range (with unrated members counted honestly, never invented), the
 * member count, and the Standing Game cadence ("Tuesdays 20:00"). It never
 * exposes the member list, chat, the Feed, the Tab, exact locations, or any
 * individual's rating. Nothing else is shared until a knock is accepted.
 *
 * Transaction rules follow the repo conventions: knock accept/decline run in a
 * single synchronous better-sqlite3 transaction (membership + notification
 * written together via insertNotification), and realtime/push fire after the
 * commit — insertNotification's own deferred emit is the "existing pattern"
 * here, delivering the knock_received / knock_accepted / knock_declined
 * notification to the affected user's channel.
 */
import { and, eq, gte, inArray, isNotNull, lte, or } from "drizzle-orm";
import {
  circleMembers,
  circles,
  knocks,
  sessions,
  standingGames,
  users,
  venues,
  type CuatroDb,
} from "@cuatro/db";
import { boundingBox, coarseDistanceLabel, DEFAULT_RADIUS_KM, haversineKm, withinRadius } from "@/lib/geo";
import { resolvePatch } from "@/server/patch";
import { boardGames, type BoardConfirmedPlayer } from "@/server/discovery";
import { insertNotification } from "@/server/notify";
import { CircleFullError, NotMemberError, NotOrganiserError, insertCircleMembership, isUniqueConstraintError } from "@/server/circles";
import { emitCircleEvent } from "@/lib/realtime/broadcast";

/** A Circle's canonical location for the directory: its most-used pinned venue. */
export interface CircleAnchor {
  venueId: string;
  venueName: string;
  lat: number;
  lng: number;
}

/**
 * A Circle's visibility tier in the directory (see file header + the three-tier
 * model). "open" = takes circle-knocks; "invite_only" = listed but joining is by
 * invite link, its open games still take session-asks. A private Circle (door
 * shut AND Board off) has no tier because it never surfaces here.
 */
export type CircleTier = "open" | "invite_only";

/**
 * One of an invite-only Circle's open games, ready to render with the existing
 * session-ask affordance. Mirrors the public, aggregate-only facts The Board
 * already exposes for the same session (composed from server/discovery.ts's
 * boardGames — never a fresh scrape of a Circle's schedule). `startsAtMs` is a
 * UTC epoch so the client formats the local "when" label itself.
 */
export interface NearbyCircleOpenGame {
  sessionId: string;
  venueName: string | null;
  startsAtMs: number;
  distanceLabel: string;
  levelLine: string;
  slotsOpen: number;
  /** Who's already confirmed — so a viewer can see who they'd be playing with before asking. Same public facts The Board exposes. */
  confirmed: BoardConfirmedPlayer[];
  /** The viewer already has an open ask on this session (card shows "Asked"). */
  viewerHasPendingKnock: boolean;
}

/**
 * A member as exposed in a Circle's public preview / directory card (Circle v2,
 * Pete's deliberate privacy-model change: level fit is why people browse, so
 * the member roster is now visible pre-join). Carries ONLY the same public
 * values any members tab already shows — avatar, display name, Glass rating,
 * role. No email, no reliability, no chat/Tab/history. GUESTS ARE EXCLUDED.
 * `avatarUrl` matches what components/circles/member-list.tsx renders.
 */
export interface CirclePreviewMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /** Public Glass rating; null while unrated (still being placed). */
  rating: number | null;
  role: "organiser" | "member";
}

/** One card in the "Circles near you" directory. */
export interface NearbyCircle {
  circleId: string;
  name: string;
  emblem: string | null;
  colour: string | null;
  vibeLine: string | null;
  /** Organiser's explicit curated-header key; null = deterministic auto-assign (headerFor). */
  headerImage: string | null;
  /** open = knockable; invite_only = visible + games take asks, joining is by invite link. */
  tier: CircleTier;
  /** The anchor venue's NAME only — never coordinates. The "venue area" a knocker sees. */
  venueArea: string | null;
  /** Coarse, privacy-preserving distance from the viewer's patch to the anchor. */
  distanceLabel: string;
  /** e.g. "Tuesdays 20:00" — the Circle's Standing Game cadence, or null. */
  cadence: string | null;
  /** Non-guest members only. */
  memberCount: number;
  /** Glass range across rated, non-guest members (the aggregate the UI shows prominently); null when nobody is rated yet. */
  level: { min: number; max: number } | null;
  /** Members still being placed (unrated) — surfaced honestly rather than folded into the range. */
  unratedCount: number;
  /** Non-guest member roster (avatar/name/Glass/role), organiser-first then rating desc. Circle v2 exposes this pre-join. */
  members: CirclePreviewMember[];
  /** The viewer already has an open knock on this Circle (card shows the waiting state). */
  hasPendingKnock: boolean;
  /**
   * This Circle's upcoming open-slot games the viewer can ask into. Populated
   * for invite_only cards (their only way in besides an invite link); an open
   * card's primary affordance is the circle-knock, so it ignores this list.
   */
  openGames: NearbyCircleOpenGame[];
}

/** A pending knock as the organiser sees it in the Members-tab panel. */
export interface CircleKnockView {
  knockId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  rating: number | null;
  /** Rating certainty 0..1 — the wide join-request row's "conf 63%" fact (design Circle · Settings). Only meaningful alongside a non-null rating. */
  confidence: number;
  /** Show-up rate (showUpCount / rsvpInCount); null = no RSVP history yet. */
  reliability: number | null;
  /** Coarse distance from the Circle's anchor to the knocker's patch; null when unplaceable. */
  distanceLabel: string | null;
  message: string | null;
  createdAt: Date;
}

/** The public preview a knocker can expand before knocking — group facts only. */
export interface CirclePreview {
  circleId: string;
  name: string;
  emblem: string | null;
  colour: string | null;
  vibeLine: string | null;
  /** Organiser's explicit curated-header key; null = deterministic auto-assign (headerFor). */
  headerImage: string | null;
  /** The anchor venue's NAME only — never coordinates. */
  venueArea: string | null;
  distanceLabel: string | null;
  memberCount: number;
  /** Glass range across rated, non-guest members (shown prominently); null when nobody is rated yet. */
  level: { min: number; max: number } | null;
  unratedCount: number;
  /** Non-guest member roster (avatar/name/Glass/role), organiser-first then rating desc. Circle v2 exposes this pre-join. */
  members: CirclePreviewMember[];
  /** e.g. "Tuesdays 20:00" — the soonest/active Standing Game cadence, or null. */
  cadence: string | null;
  hasPendingKnock: boolean;
}

export type KnockResult =
  | { ok: true; knockId: string }
  | { ok: false; error: "circle_not_found" | "door_closed" | "already_member" | "already_knocked" | "is_guest" };

export type DecideResult =
  | { ok: true }
  | { ok: false; error: "knock_not_found" | "not_organiser" | "already_decided" | "circle_full" };

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** "Tuesdays 20:00" from a Standing Game's weekday + start time. */
function formatCadence(weekday: number, startTime: string): string {
  return `${WEEKDAY_NAMES[weekday]}s ${startTime}`;
}

/**
 * A Circle's anchor for the directory. Priority (Circle v2):
 *  1. the EXPLICIT home venue (circles.homeVenueId) when it is set AND pinned —
 *     the organiser's stated home club is the truth when they've named one;
 *  2. otherwise the DERIVED anchor: the pinned venue appearing most across the
 *     Circle's Standing Games and sessions, ties broken by venue id.
 * Null when neither yields a pinned venue (the Circle can't surface). An
 * explicit home venue that is UNPINNED (not geocoded) does not win — it falls
 * through to the derived anchor, exactly like an unpinned home venue in
 * resolvePatch. See file header.
 */
export async function circleAnchor(db: CuatroDb, circleId: string): Promise<CircleAnchor | null> {
  // 1. Explicit home venue, if set and pinned.
  const [circle] = await db.select({ homeVenueId: circles.homeVenueId }).from(circles).where(eq(circles.id, circleId));
  if (circle?.homeVenueId) {
    const [home] = await db.select().from(venues).where(eq(venues.id, circle.homeVenueId));
    if (home && home.lat != null && home.lng != null) {
      return { venueId: home.id, venueName: home.name, lat: home.lat, lng: home.lng };
    }
  }

  // 2. Derived: most-used pinned venue across standing games + sessions.
  const sgRows = await db
    .select({ venueId: standingGames.venueId })
    .from(standingGames)
    .where(eq(standingGames.circleId, circleId));
  const sessRows = await db
    .select({ venueId: sessions.venueId })
    .from(sessions)
    .where(eq(sessions.circleId, circleId));

  const counts = new Map<string, number>();
  for (const row of [...sgRows, ...sessRows]) {
    if (!row.venueId) continue;
    counts.set(row.venueId, (counts.get(row.venueId) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  const rows = await db.select().from(venues).where(inArray(venues.id, [...counts.keys()]));
  let best: { venue: (typeof rows)[number]; count: number } | null = null;
  for (const venue of rows) {
    if (venue.lat == null || venue.lng == null) continue;
    const count = counts.get(venue.id) ?? 0;
    if (!best || count > best.count || (count === best.count && venue.id < best.venue.id)) {
      best = { venue, count };
    }
  }
  if (!best) return null;
  return { venueId: best.venue.id, venueName: best.venue.name, lat: best.venue.lat!, lng: best.venue.lng! };
}

/** Member Glass range (rated, non-guest) + count of members still being placed. */
function levelContext(ratings: (number | null)[]): { level: { min: number; max: number } | null; unratedCount: number } {
  const rated = ratings.filter((r): r is number => r != null);
  const unratedCount = ratings.length - rated.length;
  if (rated.length === 0) return { level: null, unratedCount };
  return { level: { min: Math.min(...rated), max: Math.max(...rated) }, unratedCount };
}

/**
 * Order preview members organiser-first, then by Glass rating descending, with
 * unrated (null) members last and display name as the stable final tie-break.
 * Deterministic so previews and cards render members identically.
 */
function comparePreviewMembers(a: CirclePreviewMember, b: CirclePreviewMember): number {
  const roleRank = (m: CirclePreviewMember) => (m.role === "organiser" ? 0 : 1);
  if (roleRank(a) !== roleRank(b)) return roleRank(a) - roleRank(b);
  if (a.rating == null && b.rating == null) return a.displayName.localeCompare(b.displayName);
  if (a.rating == null) return 1;
  if (b.rating == null) return -1;
  if (b.rating !== a.rating) return b.rating - a.rating;
  return a.displayName.localeCompare(b.displayName);
}

/**
 * The "Circles near you" directory: Circles anchored near the viewer's patch
 * that the viewer isn't already in, across BOTH visibility tiers —
 *  - OPEN (`openDoor = 1`): takes circle-knocks, as before.
 *  - INVITE-ONLY (`openDoor = 0` AND `boardEnabled = 1`): listed but NOT
 *    circle-knockable — joining is by invite link. Its open games already
 *    appear on The Board under its name, so hiding the whole Circle would be
 *    security theatre; instead the card marks it "Invite only" and carries its
 *    open games so a viewer can still ask into a GAME (session-ask).
 * A PRIVATE Circle (both flags off) never surfaces here.
 *
 * Two-step geo per the contract: SQL bounding-box pre-filter, then exact
 * `withinRadius` refine in JS against each Circle's anchor.
 *
 * Circles the viewer already has a *pending* knock on are INCLUDED (flagged
 * `hasPendingKnock`) rather than hidden — the card flips to a "waiting on the
 * organiser" state in place, so a returning knocker sees their ask stuck to
 * the Circle and can withdraw it, instead of the Circle vanishing after they
 * knock. (This deviates from the contract §6(c) sketch, which excluded them;
 * the wave's UX requirement — show the pending state, keep withdraw reachable
 * — takes precedence.)
 *
 * Ordering: OPEN Circles first, then invite-only; within each tier nearest
 * first (exact km), ties broken alphabetically for stability.
 */
export async function nearbyCircles(
  db: CuatroDb,
  viewerId: string,
  opts: { radiusKm?: number; now?: Date } = {},
): Promise<NearbyCircle[]> {
  const patch = await resolvePatch(db, viewerId);
  if (!patch) return [];
  const radiusKm = opts.radiusKm ?? DEFAULT_RADIUS_KM;
  const box = boundingBox(patch.lat, patch.lng, radiusKm);

  const inBox = and(
    isNotNull(venues.lat),
    isNotNull(venues.lng),
    gte(venues.lat, box.minLat),
    lte(venues.lat, box.maxLat),
    gte(venues.lng, box.minLng),
    lte(venues.lng, box.maxLng),
  );

  // A Circle surfaces in the directory if it is discoverable in EITHER tier:
  // the door is open, or (door shut) it still posts its games to The Board.
  // The private case — both flags off — falls through this OR and never lists.
  const isVisible = or(eq(circles.openDoor, true), eq(circles.boardEnabled, true));

  // Candidate Circle ids: visible, with at least one pinned venue in the box
  // (reached via a Standing Game OR a session — a Circle can be pinnable
  // through either). Two cheap queries unioned in JS.
  const sgCircles = await db
    .select({ id: circles.id })
    .from(circles)
    .innerJoin(standingGames, eq(standingGames.circleId, circles.id))
    .innerJoin(venues, eq(venues.id, standingGames.venueId))
    .where(and(isVisible, inBox));
  const sessCircles = await db
    .select({ id: circles.id })
    .from(circles)
    .innerJoin(sessions, eq(sessions.circleId, circles.id))
    .innerJoin(venues, eq(venues.id, sessions.venueId))
    .where(and(isVisible, inBox));

  const candidateIds = new Set<string>([...sgCircles, ...sessCircles].map((r) => r.id));
  if (candidateIds.size === 0) return [];

  // Drop Circles the viewer already belongs to.
  const memberRows = await db
    .select({ circleId: circleMembers.circleId })
    .from(circleMembers)
    .where(eq(circleMembers.userId, viewerId));
  const memberIds = new Set(memberRows.map((r) => r.circleId));
  for (const id of memberIds) candidateIds.delete(id);
  if (candidateIds.size === 0) return [];

  // Which of the candidates the viewer has an open knock on.
  const pendingRows = await db
    .select({ targetId: knocks.targetId })
    .from(knocks)
    .where(and(eq(knocks.userId, viewerId), eq(knocks.kind, "circle"), eq(knocks.status, "pending")));
  const pendingIds = new Set(pendingRows.map((r) => r.targetId));

  // Refine each candidate on its true anchor.
  const anchored: { id: string; anchor: CircleAnchor }[] = [];
  for (const id of candidateIds) {
    const anchor = await circleAnchor(db, id);
    if (anchor && withinRadius(patch.lat, patch.lng, anchor.lat, anchor.lng, radiusKm)) {
      anchored.push({ id, anchor });
    }
  }
  if (anchored.length === 0) return [];

  const ids = anchored.map((a) => a.id);
  const baseRows = await db
    .select({
      id: circles.id,
      name: circles.name,
      emblem: circles.emblem,
      colour: circles.colour,
      vibeLine: circles.vibeLine,
      headerImage: circles.headerImage,
      openDoor: circles.openDoor,
    })
    .from(circles)
    .where(inArray(circles.id, ids));
  const baseById = new Map(baseRows.map((r) => [r.id, r]));

  // Open games per Circle, for the invite-only cards' session-ask affordance.
  // Composed from The Board's own read model (server/discovery.ts) so the geo
  // gate, RSVP-window rule, open-slot check, and privacy labels stay
  // single-sourced — never a second scrape of a Circle's schedule. boardGames
  // already scopes to board-enabled Circles the viewer isn't in, near them.
  const board = await boardGames(db, viewerId, { radiusKm, now: opts.now });
  const openGamesByCircle = new Map<string, NearbyCircleOpenGame[]>();
  for (const g of board) {
    const list = openGamesByCircle.get(g.circleId) ?? [];
    list.push({
      sessionId: g.sessionId,
      venueName: g.venueName,
      startsAtMs: g.startsAt.getTime(),
      distanceLabel: g.distanceLabel,
      levelLine: g.levelLine,
      slotsOpen: g.slotsOpen,
      confirmed: g.confirmed,
      viewerHasPendingKnock: g.viewerHasPendingKnock,
    });
    openGamesByCircle.set(g.circleId, list);
  }

  // Member roster per Circle, non-guests only — Circle v2 exposes the roster
  // (avatar/name/Glass/role) on the card, not just the aggregate range.
  const rosterRows = await db
    .select({
      circleId: circleMembers.circleId,
      userId: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      rating: users.rating,
      role: circleMembers.role,
    })
    .from(circleMembers)
    .innerJoin(users, eq(users.id, circleMembers.userId))
    .where(and(inArray(circleMembers.circleId, ids), eq(users.isGuest, false)));
  const membersByCircle = new Map<string, CirclePreviewMember[]>();
  for (const row of rosterRows) {
    const list = membersByCircle.get(row.circleId) ?? [];
    list.push({
      userId: row.userId,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      rating: row.rating,
      role: row.role,
    });
    membersByCircle.set(row.circleId, list);
  }

  // Cadence per Circle: its soonest-weekday active Standing Game, one batched query.
  const sgRows = await db
    .select({ circleId: standingGames.circleId, weekday: standingGames.weekday, startTime: standingGames.startTime })
    .from(standingGames)
    .where(and(inArray(standingGames.circleId, ids), eq(standingGames.active, true)));
  const cadenceByCircle = new Map<string, { weekday: number; startTime: string }>();
  for (const row of sgRows) {
    const cur = cadenceByCircle.get(row.circleId);
    if (!cur || row.weekday < cur.weekday) cadenceByCircle.set(row.circleId, { weekday: row.weekday, startTime: row.startTime });
  }

  const result: (NearbyCircle & { km: number })[] = anchored.map(({ id, anchor }) => {
    const base = baseById.get(id)!;
    const members = (membersByCircle.get(id) ?? []).slice().sort(comparePreviewMembers);
    const { level, unratedCount } = levelContext(members.map((m) => m.rating));
    const cad = cadenceByCircle.get(id);
    const km = distanceFrom(patch, anchor);
    return {
      circleId: id,
      name: base.name,
      emblem: base.emblem,
      colour: base.colour,
      vibeLine: base.vibeLine,
      headerImage: base.headerImage,
      tier: base.openDoor ? "open" : "invite_only",
      venueArea: anchor.venueName,
      distanceLabel: coarseDistanceLabel(km),
      cadence: cad ? formatCadence(cad.weekday, cad.startTime) : null,
      memberCount: members.length,
      level,
      unratedCount,
      members,
      hasPendingKnock: pendingIds.has(id),
      openGames: openGamesByCircle.get(id) ?? [],
      km,
    };
  });

  // Open Circles first, then invite-only; within a tier, nearest first, ties
  // broken alphabetically for a stable order.
  const tierRank: Record<CircleTier, number> = { open: 0, invite_only: 1 };
  result.sort(
    (a, b) => tierRank[a.tier] - tierRank[b.tier] || a.km - b.km || a.name.localeCompare(b.name),
  );
  return result.map(({ km: _km, ...circle }) => circle);
}

function distanceFrom(patch: { lat: number; lng: number }, anchor: CircleAnchor): number {
  return haversineKm(patch.lat, patch.lng, anchor.lat, anchor.lng);
}

/**
 * Pending knocks on a Circle, for the organiser panel. Throws NotMemberError
 * if the requester isn't in the Circle and NotOrganiserError if they're a
 * plain member — a knock inbox is organiser-only.
 */
export async function circleKnocks(db: CuatroDb, circleId: string, requestingUserId: string): Promise<CircleKnockView[]> {
  const [membership] = await db
    .select({ role: circleMembers.role })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, requestingUserId)));
  if (!membership) throw new NotMemberError();
  if (membership.role !== "organiser") throw new NotOrganiserError();

  const rows = await db
    .select({
      knockId: knocks.id,
      userId: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      rating: users.rating,
      confidence: users.confidence,
      rsvpInCount: users.rsvpInCount,
      showUpCount: users.showUpCount,
      message: knocks.message,
      createdAt: knocks.createdAt,
    })
    .from(knocks)
    .innerJoin(users, eq(users.id, knocks.userId))
    .where(and(eq(knocks.kind, "circle"), eq(knocks.targetId, circleId), eq(knocks.status, "pending")))
    .orderBy(knocks.createdAt, knocks.id);

  const anchor = await circleAnchor(db, circleId);

  const views: CircleKnockView[] = [];
  for (const row of rows) {
    let distanceLabel: string | null = null;
    if (anchor) {
      const knockerPatch = await resolvePatch(db, row.userId);
      if (knockerPatch) {
        distanceLabel = coarseDistanceLabel(distanceFrom(knockerPatch, anchor));
      }
    }
    views.push({
      knockId: row.knockId,
      userId: row.userId,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      rating: row.rating,
      confidence: row.confidence,
      reliability: row.rsvpInCount > 0 ? Math.min(1, row.showUpCount / row.rsvpInCount) : null,
      distanceLabel,
      message: row.message,
      createdAt: new Date(row.createdAt),
    });
  }
  return views;
}

/** The public preview a knocker expands before deciding to knock. Group facts only. */
export async function circlePreview(db: CuatroDb, circleId: string, viewerId: string): Promise<CirclePreview | null> {
  const [circle] = await db
    .select({ id: circles.id, name: circles.name, emblem: circles.emblem, colour: circles.colour, vibeLine: circles.vibeLine, headerImage: circles.headerImage, openDoor: circles.openDoor })
    .from(circles)
    .where(eq(circles.id, circleId));
  if (!circle) return null;

  const anchor = await circleAnchor(db, circleId);

  const memberRows = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      rating: users.rating,
      role: circleMembers.role,
    })
    .from(circleMembers)
    .innerJoin(users, eq(users.id, circleMembers.userId))
    .where(and(eq(circleMembers.circleId, circleId), eq(users.isGuest, false)));
  const members: CirclePreviewMember[] = memberRows
    .map((r) => ({ userId: r.userId, displayName: r.displayName, avatarUrl: r.avatarUrl, rating: r.rating, role: r.role }))
    .sort(comparePreviewMembers);
  const { level, unratedCount } = levelContext(members.map((m) => m.rating));

  // Cadence from the soonest active Standing Game (weekday + start time).
  const [sg] = await db
    .select({ weekday: standingGames.weekday, startTime: standingGames.startTime })
    .from(standingGames)
    .where(and(eq(standingGames.circleId, circleId), eq(standingGames.active, true)))
    .orderBy(standingGames.weekday, standingGames.id)
    .limit(1);
  const cadence = sg ? formatCadence(sg.weekday, sg.startTime) : null;

  let distanceLabel: string | null = null;
  if (anchor) {
    const patch = await resolvePatch(db, viewerId);
    if (patch) distanceLabel = coarseDistanceLabel(distanceFrom(patch, anchor));
  }

  const [pending] = await db
    .select({ id: knocks.id })
    .from(knocks)
    .where(and(eq(knocks.userId, viewerId), eq(knocks.kind, "circle"), eq(knocks.targetId, circleId), eq(knocks.status, "pending")));

  return {
    circleId: circle.id,
    name: circle.name,
    emblem: circle.emblem,
    colour: circle.colour,
    vibeLine: circle.vibeLine,
    headerImage: circle.headerImage,
    venueArea: anchor?.venueName ?? null,
    distanceLabel,
    memberCount: members.length,
    level,
    unratedCount,
    members,
    cadence,
    hasPendingKnock: Boolean(pending),
  };
}

/**
 * Knock on a Circle. Rejected if the Circle is gone, has its door closed, the
 * viewer is already a member, the viewer is a guest, or the viewer already has
 * an open knock (the DB's partial unique index is the last line of defence and
 * is caught here into a human-mapped code). On success, notifies every
 * organiser (knock_received) after the write commits.
 */
export async function createCircleKnock(
  db: CuatroDb,
  input: { circleId: string; userId: string; message?: string | null },
): Promise<KnockResult> {
  const { circleId, userId } = input;

  const [viewer] = await db.select({ isGuest: users.isGuest }).from(users).where(eq(users.id, userId));
  if (!viewer) return { ok: false, error: "circle_not_found" };
  if (viewer.isGuest) return { ok: false, error: "is_guest" };

  const [circle] = await db.select({ id: circles.id, openDoor: circles.openDoor }).from(circles).where(eq(circles.id, circleId));
  if (!circle) return { ok: false, error: "circle_not_found" };
  if (!circle.openDoor) return { ok: false, error: "door_closed" };

  const [member] = await db
    .select({ userId: circleMembers.userId })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)));
  if (member) return { ok: false, error: "already_member" };

  const message = input.message?.trim() ? input.message.trim().slice(0, 280) : null;

  let knockId: string;
  try {
    knockId = await db.transaction(async (tx) => {
      const [knock] = await tx
        .insert(knocks)
        .values({ kind: "circle", targetId: circleId, userId, message })
        .returning();

      const organisers = await tx
        .select({ userId: circleMembers.userId })
        .from(circleMembers)
        .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.role, "organiser")));
      for (const org of organisers) {
        await insertNotification(tx, {
          userId: org.userId,
          type: "knock_received",
          payload: { knockId: knock.id, kind: "circle", targetId: circleId, userId },
        });
      }
      return knock.id;
    });
  } catch (err) {
    // The partial unique index rejects a second OPEN knock on the same target.
    if (isUniqueConstraintError(err)) {
      return { ok: false, error: "already_knocked" };
    }
    throw err;
  }

  // Realtime after commit: the organisers' notification broadcasts fire from
  // insertNotification's own deferred emit; a circle-scoped ping lets an open
  // organiser panel refetch its pending list live.
  emitCircleEvent(circleId, "notification", { reason: "knock" });
  return { ok: true, knockId };
}

/**
 * Withdraw the viewer's own open knock on a Circle. Idempotent-ish: returns ok
 * even if there was nothing pending (the door already moved on). No organiser
 * notification — a withdrawn ask shouldn't nag anyone.
 */
export async function withdrawCircleKnock(
  db: CuatroDb,
  input: { circleId: string; userId: string },
): Promise<{ ok: true }> {
  const { circleId, userId } = input;
  const updated = await db
    .update(knocks)
    .set({ status: "withdrawn", decidedAt: Date.now(), decidedBy: userId })
    .where(
      and(eq(knocks.userId, userId), eq(knocks.kind, "circle"), eq(knocks.targetId, circleId), eq(knocks.status, "pending")),
    )
    .returning();
  if (updated.length > 0) emitCircleEvent(circleId, "notification", { reason: "knock" });
  return { ok: true };
}

/**
 * Organiser decides a pending knock. ACCEPT is one synchronous transaction:
 * the knock is resolved AND a real circle_members row is inserted via the
 * shared insertCircleMembership path (the same insert joinCircle uses) AND the
 * knocker's knock_accepted notification is written — all together, so a
 * committed accept always means a real membership. DECLINE resolves the knock
 * and writes knock_declined. Both notify the knocker after commit (via
 * insertNotification's deferred emit).
 */
export async function decideCircleKnock(
  db: CuatroDb,
  input: { knockId: string; organiserId: string; action: "accept" | "decline" },
): Promise<DecideResult> {
  const { knockId, organiserId, action } = input;

  const [knock] = await db.select().from(knocks).where(eq(knocks.id, knockId));
  if (!knock || knock.kind !== "circle") return { ok: false, error: "knock_not_found" };
  if (knock.status !== "pending") return { ok: false, error: "already_decided" };

  const circleId = knock.targetId;
  const [membership] = await db
    .select({ role: circleMembers.role })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, organiserId)));
  if (!membership || membership.role !== "organiser") return { ok: false, error: "not_organiser" };

  const now = Date.now();
  let committed: boolean;
  try {
    committed = await db.transaction(async (tx) => {
      // Guard again inside the transaction against a concurrent decide, taking
      // a row lock so two organisers can't both resolve the same pending knock.
      const [fresh] = await tx.select({ status: knocks.status }).from(knocks).where(eq(knocks.id, knockId)).for("update");
      if (!fresh || fresh.status !== "pending") return false;

      await tx.update(knocks)
        .set({ status: action === "accept" ? "accepted" : "declined", decidedAt: now, decidedBy: organiserId })
        .where(eq(knocks.id, knockId));

      if (action === "accept") {
        // Capacity is enforced here, inside the accept transaction: a full
        // capped Circle throws CircleFullError, rolling back the knock
        // resolution AND the membership together (caught below → circle_full).
        await insertCircleMembership(tx, circleId, knock.userId);
        await insertNotification(tx, {
          userId: knock.userId,
          type: "knock_accepted",
          payload: { knockId, kind: "circle", targetId: circleId },
        });
      } else {
        await insertNotification(tx, {
          userId: knock.userId,
          type: "knock_declined",
          payload: { knockId, kind: "circle", targetId: circleId },
        });
      }
      return true;
    });
  } catch (err) {
    if (err instanceof CircleFullError) return { ok: false, error: "circle_full" };
    throw err;
  }

  if (!committed) return { ok: false, error: "already_decided" };
  emitCircleEvent(circleId, "notification", { reason: "knock" });
  return { ok: true };
}
