/**
 * getHomeFeed — the cross-Circle living feed behind /home (Pete, 2026-07-12:
 * "home should be a feed, not just the calendar"). One read-only aggregate
 * composing, across EVERY Circle the viewer belongs to:
 *
 *   1. opportunities to play — open slots in the viewer's OWN circles'
 *      upcoming games they haven't answered ("Sunday Lot is one short,
 *      Thu 8pm"), soonest first, capped; then Board games near the viewer's
 *      patch (server/discovery.ts's boardGames verbatim — suppressed entirely
 *      when no patch resolves), capped at HOME_FEED_BOARD_CAP;
 *   2. recent activity — each circle's canonical Feed (server/feed.ts's
 *      listCircleFeed: verified result posts ∪ placement reveals), merged
 *      newest-first across circles. Every activity item carries its circle's
 *      name/colour/emblem because home is the one cross-circle surface.
 *
 * Opportunities lead (they're actionable and expire), activity follows;
 * the whole list is capped at HOME_FEED_LIMIT. Needs-attention cards
 * (pending confirmations, incoming Fourth Calls, the placement nudge) are
 * NOT re-derived here — they already live at the top of /home and stay there.
 *
 * READ-ONLY by contract, same posture as server/week.ts: it renders on every
 * /home hit alongside listUpcomingSessionsForUser (which does the write-side
 * materialisation in the same request), so this never writes.
 *
 * QUERY COST PROFILE (per /home render, all legs Promise.all'd):
 *   1 (viewer's circles)
 *   + C × ~7 (listCircleFeed per circle: matches, users, rating events,
 *     reactions, standing game, comment counts, reveals — reused, not
 *     reimplemented; C = the viewer's circle count, realistically 1–4)
 *   + 2 (window sessions + their rsvps, batched across all circles)
 *   + boardGames' own cost UNLESS the caller passes its already-fetched
 *     board list (the /home page fetches the Board for the phone "Near you"
 *     section anyway — pass it in, never pay twice).
 * The per-circle leg is the ceiling; it is inherent to reusing the circle
 * feed's read model rather than forking its logic. Keep C small before
 * worrying — do NOT add per-item queries here.
 */
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import {
  circles,
  circleMembers,
  rsvps,
  sessions,
  standingGames,
  venues,
  type CuatroDb,
} from "@cuatro/db";
import { listCircleFeed, type FeedItem, type PlacementRevealView, type ResultPostView } from "./feed";
import { boardGames, type BoardGame } from "./discovery";
import { DEFAULT_RSVP_WINDOW_DAYS, DEFAULT_SESSION_SLOTS } from "./games-service";
import { getDb } from "./db";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Overall item cap — home is a glance, not an archive. */
export const HOME_FEED_LIMIT = 20;
/** Most items any ONE circle can contribute to the activity half (also the circle feed's own default page size) — keeps a chatty circle from drowning the quiet ones. */
export const HOME_FEED_PER_CIRCLE = 10;
/** Board (near-you) opportunities shown at most. */
export const HOME_FEED_BOARD_CAP = 3;
/** Own-circle open-slot opportunities shown at most. */
export const HOME_FEED_OPEN_SLOT_CAP = 4;
/** Opportunities further out than this are next week's problem. */
const OPEN_SLOT_WINDOW_MS = 7 * DAY_MS;

/** The owning circle, carried on every activity item — home is cross-circle, so a bare result post would be unattributable. */
export interface HomeFeedCircleRef {
  circleId: string;
  circleName: string;
  circleColour: string | null;
  circleEmblem: string | null;
}

/** An open slot in one of the viewer's OWN circles' games they haven't answered — the "one short" opportunity. */
export interface OpenSlotView {
  sessionId: string;
  circleId: string;
  circleName: string;
  circleColour: string | null;
  circleEmblem: string | null;
  venueName: string | null;
  /** Kickoff, UTC epoch-ms. */
  startsAt: number;
  /** The session's effective timezone (venue's, else the circle's) for local time rendering. */
  timezone: string;
  slots: number;
  slotsOpen: number;
}

export type HomeFeedItem =
  | { kind: "result"; circle: HomeFeedCircleRef; post: ResultPostView }
  | { kind: "placement_reveal"; circle: HomeFeedCircleRef; reveal: PlacementRevealView }
  | { kind: "open_slot"; slot: OpenSlotView }
  | { kind: "board_game"; game: BoardGame };

export interface HomeFeed {
  items: HomeFeedItem[];
  /** True when the viewer belongs to no Circle — the page keeps its existing first-run empty state and renders no feed at all. */
  hasNoCircles: boolean;
}

export interface HomeFeedOptions {
  now?: Date;
  limit?: number;
  /**
   * An already-fetched Board list (server/discovery.ts's boardGames) — the
   * /home page fetches it for the phone "Near you" section in the same
   * request, so passing it here avoids paying discovery's queries twice.
   * Omitted = this module fetches (and patch-gates) it itself.
   */
  board?: BoardGame[];
}

export async function getHomeFeed(userId: string, options: HomeFeedOptions = {}): Promise<HomeFeed> {
  const { db } = await getDb();
  return buildHomeFeed(db, userId, options);
}

/** db-taking core so tests drive it against an isolated PGlite fixture (same split as server/week.ts). */
export async function buildHomeFeed(db: CuatroDb, userId: string, options: HomeFeedOptions = {}): Promise<HomeFeed> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? HOME_FEED_LIMIT;

  const circleRows = await db
    .select({
      id: circles.id,
      name: circles.name,
      colour: circles.colour,
      emblem: circles.emblem,
      timezone: circles.timezone,
    })
    .from(circleMembers)
    .innerJoin(circles, eq(circleMembers.circleId, circles.id))
    .where(eq(circleMembers.userId, userId));

  if (circleRows.length === 0) return { items: [], hasNoCircles: true };

  const refByCircle = new Map<string, HomeFeedCircleRef>(
    circleRows.map((c) => [c.id, { circleId: c.id, circleName: c.name, circleColour: c.colour, circleEmblem: c.emblem }]),
  );

  const [feeds, openSlots, board] = await Promise.all([
    Promise.all(circleRows.map((c) => listCircleFeed(db, c.id, userId, HOME_FEED_PER_CIRCLE))),
    loadOpenSlots(db, userId, circleRows, now),
    options.board !== undefined ? Promise.resolve(options.board) : boardGames(db, userId, { now }),
  ]);

  // Activity: merge every circle's already-sorted feed, newest first, with the
  // same deterministic id tiebreak listCircleFeed itself uses.
  const activity: HomeFeedItem[] = [];
  circleRows.forEach((c, i) => {
    const circle = refByCircle.get(c.id)!;
    for (const item of feeds[i].items) {
      activity.push(
        item.kind === "result" ? { kind: "result", circle, post: item.post } : { kind: "placement_reveal", circle, reveal: item.reveal },
      );
    }
  });
  activity.sort((a, b) => {
    const byTime = activityTime(b) - activityTime(a);
    if (byTime !== 0) return byTime;
    const aId = activityId(a);
    const bId = activityId(b);
    return aId < bId ? 1 : aId > bId ? -1 : 0;
  });

  const items: HomeFeedItem[] = [
    ...openSlots.slice(0, HOME_FEED_OPEN_SLOT_CAP).map((slot): HomeFeedItem => ({ kind: "open_slot", slot })),
    ...board.slice(0, HOME_FEED_BOARD_CAP).map((game): HomeFeedItem => ({ kind: "board_game", game })),
    ...activity,
  ].slice(0, limit);

  return { items, hasNoCircles: false };
}

function activityTime(item: HomeFeedItem): number {
  if (item.kind === "result") return item.post.playedAt.getTime();
  if (item.kind === "placement_reveal") return item.reveal.playedAt.getTime();
  return 0;
}

function activityId(item: HomeFeedItem): string {
  if (item.kind === "result") return item.post.matchId;
  if (item.kind === "placement_reveal") return item.reveal.ratingEventId;
  return "";
}

/**
 * Open slots the viewer could fill in their OWN circles: upcoming within 7
 * days, RSVP window open, at least one slot free, and the viewer hasn't
 * answered at all (an 'out' said no, a reserve is queued, 'available' already
 * declared — none get nagged again). Rotation games pre-lock are EXCLUDED:
 * rotation is available-not-grab, so an unlocked rotation game has no "slot"
 * to offer (post-lock drops become Fourth Calls, which needs-attention owns).
 * Two batched queries regardless of circle count.
 */
async function loadOpenSlots(
  db: CuatroDb,
  userId: string,
  circleRows: Array<{ id: string; name: string; colour: string | null; emblem: string | null; timezone: string }>,
  now: Date,
): Promise<OpenSlotView[]> {
  const nowMs = now.getTime();
  const circleIds = circleRows.map((c) => c.id);

  const sessionRows = await db
    .select({
      sessionId: sessions.id,
      circleId: sessions.circleId,
      startsAt: sessions.startsAt,
      rotationLockedAt: sessions.rotationLockedAt,
      slots: standingGames.slots,
      rsvpWindowDays: standingGames.rsvpWindowDays,
      rotationEnabled: standingGames.rotationEnabled,
      venueName: venues.name,
      venueTimezone: venues.timezone,
    })
    .from(sessions)
    .leftJoin(standingGames, eq(sessions.standingGameId, standingGames.id))
    .leftJoin(venues, eq(sessions.venueId, venues.id))
    .where(
      and(
        inArray(sessions.circleId, circleIds),
        eq(sessions.status, "upcoming"),
        gt(sessions.startsAt, nowMs),
        lt(sessions.startsAt, nowMs + OPEN_SLOT_WINDOW_MS),
      ),
    );
  if (sessionRows.length === 0) return [];

  const rsvpRows = await db
    .select({ sessionId: rsvps.sessionId, userId: rsvps.userId, status: rsvps.status })
    .from(rsvps)
    .where(inArray(rsvps.sessionId, sessionRows.map((s) => s.sessionId)));

  const inCountBySession = new Map<string, number>();
  const viewerAnswered = new Set<string>();
  for (const r of rsvpRows) {
    if (r.status === "in") inCountBySession.set(r.sessionId, (inCountBySession.get(r.sessionId) ?? 0) + 1);
    if (r.userId === userId) viewerAnswered.add(r.sessionId);
  }

  const circleById = new Map(circleRows.map((c) => [c.id, c]));
  const slots: OpenSlotView[] = [];
  for (const row of sessionRows) {
    if (row.rotationEnabled === true && row.rotationLockedAt == null) continue; // available-not-grab
    if (viewerAnswered.has(row.sessionId)) continue;
    const windowOpensAt = row.startsAt - (row.rsvpWindowDays ?? DEFAULT_RSVP_WINDOW_DAYS) * DAY_MS;
    if (nowMs < windowOpensAt) continue;
    const slotCount = row.slots ?? DEFAULT_SESSION_SLOTS;
    const open = slotCount - (inCountBySession.get(row.sessionId) ?? 0);
    if (open <= 0) continue;

    const circle = circleById.get(row.circleId)!;
    slots.push({
      sessionId: row.sessionId,
      circleId: row.circleId,
      circleName: circle.name,
      circleColour: circle.colour,
      circleEmblem: circle.emblem,
      venueName: row.venueName ?? null,
      startsAt: row.startsAt,
      timezone: row.venueTimezone ?? circle.timezone,
      slots: slotCount,
      slotsOpen: open,
    });
  }

  slots.sort((a, b) => a.startsAt - b.startsAt || (a.sessionId < b.sessionId ? -1 : 1));
  return slots;
}
