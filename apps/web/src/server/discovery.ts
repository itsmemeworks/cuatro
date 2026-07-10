/**
 * The Board + session knocks — the games-side of venue-anchored discovery.
 *
 * The Board surfaces *open slots in upcoming games near a player*, drawn only
 * from Circles that opted in (`circles.boardEnabled`) and gated on the shared
 * geo layer (see lib/geo.ts + server/patch.ts): a viewer with no resolvable
 * patch sees nothing, distances are always coarse, guests never appear (they
 * have no (app) access and are excluded from queries anyway). A player who
 * likes what they see "knocks" — an ask-to-join recorded in the `knocks`
 * table — and the game's organiser accepts or declines.
 *
 * MEMBERSHIP DECISION (v1): an accepted knocker joins as a **session
 * participant only**, never silently a Circle member. We reuse the exact
 * mechanism ring-3 Fourth Call claimants use today (server/fourth-call.ts's
 * claimFourthCallSlot): a plain `rsvps` row with `source: 'fourth_call'` — the
 * `rsvps` table has no circle_members FK, so being "in" a session says nothing
 * about Circle membership. Migration 0008 didn't add a 'knock' rsvp source, so
 * 'fourth_call' is the honest "non-member playing this one game" flag; the
 * alternative (adding them to circle_members) is a heavier social act the
 * organiser didn't consent to. If they want the person in the Circle proper,
 * that's a separate invite.
 *
 * Concurrency & realtime follow the same hard rules as games-service.ts:
 * every mutation runs one fully-synchronous better-sqlite3 transaction (no
 * `await` inside), notifications go through notify.ts's insertNotification
 * (which defers its push + realtime broadcast to setImmediate, after commit),
 * and any additional realtime signal fires AFTER the transaction returns via
 * the REST broadcast helpers. Realtime signals reuse the existing "rsvp"
 * event type (a Board/session "something changed, refetch" signal) rather than
 * inventing a new channel event — clients always refetch through the authed
 * API, so the signal carries no entity data.
 */
import { and, asc, eq, gt, gte, isNotNull, lte, sql } from "drizzle-orm";
import {
  circleMembers,
  circles,
  knocks,
  rsvps,
  sessions,
  standingGames,
  users,
  venues,
  type CuatroDb,
  type Knock,
  type StandingGame,
} from "@cuatro/db";
import {
  boundingBox,
  coarseDistanceLabel,
  haversineKm,
  DEFAULT_RADIUS_KM,
} from "@/lib/geo";
import { resolvePatch } from "./patch";
import { slotsForSession, DEFAULT_RSVP_WINDOW_DAYS } from "./games-service";
import { insertNotification } from "./notify";
import { emitCircleEvent, emitSessionEvent } from "@/lib/realtime/broadcast";

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// The Board — read model
// ---------------------------------------------------------------------------

/** A confirmed slot-holder as a Board card shows them — the same public facts every other surface uses; guests included but flagged so the UI leaves them unlinked. */
export interface BoardConfirmedPlayer {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  rating: number | null;
  isGuest: boolean;
}

export interface BoardGame {
  sessionId: string;
  circleId: string;
  circleName: string;
  /** The Circle's explicitly-chosen colour (palette hex) / emblem; null when unset (UI falls back to the deterministic seed colour + name initials). */
  circleColour: string | null;
  circleEmblem: string | null;
  venueName: string | null;
  startsAt: Date;
  slots: number;
  slotsOpen: number;
  confirmedCount: number;
  /** Who's already in — so a viewer deciding whether to ask can see who they'd be playing with. Ordered by RSVP arrival. */
  confirmed: BoardConfirmedPlayer[];
  /** Coarse, privacy-preserving distance label (never a raw km/coord). */
  distanceLabel: string;
  /** One warm line about who's already in — a Glass range, "mixed", or "levels still forming". */
  levelLine: string;
  /** True when the viewer already has a pending knock on this session — so the UI shows "Asked" rather than a fresh ask. */
  viewerHasPendingKnock: boolean;
}

export interface BoardOptions {
  radiusKm?: number;
  now?: Date;
}

/** "who's already in" summarised into one line from their Glass ratings (nulls = unrated). */
function levelLineFor(ratings: (number | null)[]): string {
  const rated = ratings.filter((r): r is number => r != null);
  if (ratings.length === 0) return "Levels still forming";
  if (rated.length === 0) return "New group, still unrated";
  const min = Math.min(...rated);
  const max = Math.max(...rated);
  const range = min === max ? `Glass ${min.toFixed(2)}` : `Glass ${min.toFixed(2)}–${max.toFixed(2)}`;
  // Some confirmed players are still unrated alongside rated ones.
  return rated.length < ratings.length ? `${range} · mixed` : range;
}

function loadStandingGame(db: CuatroDb, standingGameId: string | null): StandingGame | null {
  if (!standingGameId) return null;
  return db.select().from(standingGames).where(eq(standingGames.id, standingGameId)).get() ?? null;
}

function rsvpWindowDaysFor(standingGame: StandingGame | null): number {
  return standingGame?.rsvpWindowDays ?? DEFAULT_RSVP_WINDOW_DAYS;
}

/**
 * Upcoming games with open slots near the viewer's patch, from board-enabled
 * Circles the viewer is NOT a member of, RSVP window open. Two-step geo per
 * the contract: SQL bounding-box pre-filter, exact `haversineKm` refine in JS.
 * Returns [] when the viewer has no resolvable patch (not placeable → not on
 * the map). Sorted nearest-first, ties broken by soonest kickoff.
 */
export async function boardGames(db: CuatroDb, viewerId: string, options: BoardOptions = {}): Promise<BoardGame[]> {
  const radiusKm = options.radiusKm ?? DEFAULT_RADIUS_KM;
  const now = options.now ?? new Date();

  const patch = await resolvePatch(db, viewerId);
  if (!patch) return [];

  const box = boundingBox(patch.lat, patch.lng, radiusKm);

  const memberCircleIds = new Set(
    db
      .select({ circleId: circleMembers.circleId })
      .from(circleMembers)
      .where(eq(circleMembers.userId, viewerId))
      .all()
      .map((r) => r.circleId),
  );

  const pendingKnockTargets = new Set(
    db
      .select({ targetId: knocks.targetId })
      .from(knocks)
      .where(and(eq(knocks.userId, viewerId), eq(knocks.kind, "session"), eq(knocks.status, "pending")))
      .all()
      .map((r) => r.targetId),
  );

  const rows = db
    .select({
      sessionId: sessions.id,
      circleId: sessions.circleId,
      circleName: circles.name,
      circleColour: circles.colour,
      circleEmblem: circles.emblem,
      startsAt: sessions.startsAt,
      standingGameId: sessions.standingGameId,
      venueName: venues.name,
      lat: venues.lat,
      lng: venues.lng,
    })
    .from(sessions)
    .innerJoin(circles, eq(circles.id, sessions.circleId))
    .innerJoin(venues, eq(venues.id, sessions.venueId))
    .where(
      and(
        eq(sessions.status, "upcoming"),
        gt(sessions.startsAt, now),
        eq(circles.boardEnabled, true),
        isNotNull(venues.lat),
        isNotNull(venues.lng),
        gte(venues.lat, box.minLat),
        lte(venues.lat, box.maxLat),
        gte(venues.lng, box.minLng),
        lte(venues.lng, box.maxLng),
      ),
    )
    .all();

  const scored: (BoardGame & { km: number })[] = [];
  for (const row of rows) {
    if (memberCircleIds.has(row.circleId)) continue;
    if (row.lat == null || row.lng == null) continue;

    const km = haversineKm(patch.lat, patch.lng, row.lat, row.lng);
    if (km > radiusKm) continue; // refine the box's corners

    const standingGame = loadStandingGame(db, row.standingGameId);
    const windowOpensAt = row.startsAt.getTime() - rsvpWindowDaysFor(standingGame) * DAY_MS;
    if (now.getTime() < windowOpensAt) continue; // RSVP window not open yet

    const confirmed = db
      .select({
        userId: users.id,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        rating: users.rating,
        isGuest: users.isGuest,
        respondedAt: rsvps.respondedAt,
      })
      .from(rsvps)
      .innerJoin(users, eq(users.id, rsvps.userId))
      .where(and(eq(rsvps.sessionId, row.sessionId), eq(rsvps.status, "in")))
      .all();
    // Slots fill (and display) in RSVP arrival order — same sort getSessionSummary uses.
    const confirmedPlayers: BoardConfirmedPlayer[] = confirmed
      .slice()
      .sort((a, b) => (a.respondedAt?.getTime() ?? 0) - (b.respondedAt?.getTime() ?? 0))
      .map((c) => ({
        userId: c.userId,
        displayName: c.displayName,
        avatarUrl: c.avatarUrl,
        rating: c.rating,
        isGuest: c.isGuest,
      }));
    const slots = slotsForSession(standingGame);
    const slotsOpen = slots - confirmed.length;
    if (slotsOpen <= 0) continue; // full — nothing to ask for

    scored.push({
      sessionId: row.sessionId,
      circleId: row.circleId,
      circleName: row.circleName,
      circleColour: row.circleColour,
      circleEmblem: row.circleEmblem,
      venueName: row.venueName,
      startsAt: row.startsAt,
      slots,
      slotsOpen,
      confirmedCount: confirmed.length,
      confirmed: confirmedPlayers,
      distanceLabel: coarseDistanceLabel(km),
      levelLine: levelLineFor(confirmed.map((c) => c.rating)),
      viewerHasPendingKnock: pendingKnockTargets.has(row.sessionId),
      km,
    });
  }

  scored.sort((a, b) => a.km - b.km || a.startsAt.getTime() - b.startsAt.getTime());
  return scored.map(({ km: _km, ...game }) => game);
}

// ---------------------------------------------------------------------------
// Organiser inbox — pending session knocks
// ---------------------------------------------------------------------------

export interface SessionKnockView {
  knockId: string;
  message: string | null;
  createdAt: Date;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  rating: number | null;
  /** show-up % (showUp/rsvpIn), null before their first RSVP — same formula as ProfileGlassView. */
  reliabilityPct: number | null;
  lateCancelCount: number;
  /** coarse distance from the game's venue to the knocker's patch, or null if either can't be placed. */
  distanceLabel: string | null;
}

/** Pending knocks on a session, oldest first, with the knocker's Glass/Reliability/coarse-distance for the organiser panel. */
export async function sessionKnocks(db: CuatroDb, sessionId: string): Promise<SessionKnockView[]> {
  const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  const venue =
    session?.venueId != null ? (db.select().from(venues).where(eq(venues.id, session.venueId)).get() ?? null) : null;

  const rows = db
    .select({
      knockId: knocks.id,
      message: knocks.message,
      createdAt: knocks.createdAt,
      userId: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      rating: users.rating,
      rsvpInCount: users.rsvpInCount,
      showUpCount: users.showUpCount,
      lateCancelCount: users.lateCancelCount,
    })
    .from(knocks)
    .innerJoin(users, eq(users.id, knocks.userId))
    .where(and(eq(knocks.kind, "session"), eq(knocks.targetId, sessionId), eq(knocks.status, "pending")))
    .orderBy(asc(knocks.createdAt))
    .all();

  const out: SessionKnockView[] = [];
  for (const r of rows) {
    let distanceLabel: string | null = null;
    if (venue?.lat != null && venue?.lng != null) {
      const p = await resolvePatch(db, r.userId);
      if (p) distanceLabel = coarseDistanceLabel(haversineKm(p.lat, p.lng, venue.lat, venue.lng));
    }
    out.push({
      knockId: r.knockId,
      message: r.message,
      createdAt: r.createdAt,
      userId: r.userId,
      displayName: r.displayName,
      avatarUrl: r.avatarUrl,
      rating: r.rating,
      reliabilityPct: r.rsvpInCount > 0 ? Math.min(100, Math.round((r.showUpCount / r.rsvpInCount) * 100)) : null,
      lateCancelCount: r.lateCancelCount,
      distanceLabel,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Knock mutations — create / withdraw / decide
// ---------------------------------------------------------------------------

function countConfirmed(tx: CuatroDb, sessionId: string): number {
  return (
    tx
      .select({ n: sql<number>`count(*)` })
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "in")))
      .get()?.n ?? 0
  );
}

function confirmedParticipantIds(tx: CuatroDb, sessionId: string): string[] {
  return tx
    .select({ userId: rsvps.userId })
    .from(rsvps)
    .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "in")))
    .all()
    .map((r) => r.userId);
}

function organiserIdsFor(tx: CuatroDb, circleId: string): string[] {
  return tx
    .select({ userId: circleMembers.userId })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.role, "organiser")))
    .all()
    .map((r) => r.userId);
}

function isCircleMember(tx: CuatroDb, circleId: string, userId: string): boolean {
  return !!tx
    .select({ userId: circleMembers.userId })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)))
    .get();
}

export type CreateSessionKnockError =
  | "knock_not_allowed"
  | "session_not_found"
  | "session_started"
  | "window_not_open"
  | "already_full"
  | "already_member"
  | "already_in"
  | "already_knocked";

export type CreateSessionKnockResult = { ok: true; knock: Knock } | { ok: false; error: CreateSessionKnockError };

/**
 * A player asks their way into a game they found on the Board. Rejected when
 * the session is gone/started, the RSVP window hasn't opened, the game is
 * already full, the asker is already a Circle member (members RSVP directly)
 * or already holds a slot, or they already have an open knock (one-open-knock,
 * enforced here *and* by the `knocks_open_unique` partial index at the DB).
 * Fires a `knock_received` notification to every organiser.
 */
export function createSessionKnock(
  db: CuatroDb,
  sessionId: string,
  userId: string,
  message: string | null = null,
  now: Date = new Date(),
): CreateSessionKnockResult {
  let circleId: string | undefined;

  const outcome = db.transaction((tx): CreateSessionKnockResult => {
    // Guests can't reach this route today (no cuatro_session ever resolves
    // for a guest), but the gate belongs here too, matching createCircleKnock:
    // discovery is for account holders (geo contract §5).
    const knocker = tx.select({ isGuest: users.isGuest }).from(users).where(eq(users.id, userId)).get();
    if (!knocker || knocker.isGuest) return { ok: false, error: "knock_not_allowed" };

    const session = tx.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!session) return { ok: false, error: "session_not_found" };
    circleId = session.circleId;

    if (session.status !== "upcoming" || now.getTime() >= session.startsAt.getTime()) {
      return { ok: false, error: "session_started" };
    }
    if (isCircleMember(tx, session.circleId, userId)) return { ok: false, error: "already_member" };

    const existingRsvp = tx
      .select()
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.userId, userId)))
      .get();
    if (existingRsvp?.status === "in") return { ok: false, error: "already_in" };

    const standingGame = session.standingGameId ? loadStandingGame(tx, session.standingGameId) : null;
    if (now.getTime() < session.startsAt.getTime() - rsvpWindowDaysFor(standingGame) * DAY_MS) {
      return { ok: false, error: "window_not_open" };
    }
    if (countConfirmed(tx, sessionId) >= slotsForSession(standingGame)) return { ok: false, error: "already_full" };

    // Single shared connection (server/db.ts) ⇒ no concurrent transaction can
    // interleave, so this pre-check is authoritative; the partial unique index
    // is the belt-and-braces DB guarantee against any future concurrency.
    const openKnock = tx
      .select({ id: knocks.id })
      .from(knocks)
      .where(
        and(
          eq(knocks.kind, "session"),
          eq(knocks.targetId, sessionId),
          eq(knocks.userId, userId),
          eq(knocks.status, "pending"),
        ),
      )
      .get();
    if (openKnock) return { ok: false, error: "already_knocked" };

    const knock = tx
      .insert(knocks)
      .values({ kind: "session", targetId: sessionId, userId, message: message ?? null })
      .returning()
      .get();

    for (const organiserId of organiserIdsFor(tx, session.circleId)) {
      insertNotification(tx, {
        userId: organiserId,
        type: "knock_received",
        payload: { knockId: knock.id, kind: "session", targetId: sessionId, userId },
      });
    }

    return { ok: true, knock };
  });

  if (outcome.ok && circleId) {
    emitSessionEvent(sessionId, "rsvp", { circleId });
    emitCircleEvent(circleId, "rsvp", { sessionId });
  }
  return outcome;
}

export type WithdrawSessionKnockResult = { ok: true } | { ok: false; error: "no_open_knock" };

/** The asker withdraws their own pending knock. */
export function withdrawSessionKnock(
  db: CuatroDb,
  sessionId: string,
  userId: string,
  now: Date = new Date(),
): WithdrawSessionKnockResult {
  let circleId: string | undefined;

  const outcome = db.transaction((tx): WithdrawSessionKnockResult => {
    const open = tx
      .select()
      .from(knocks)
      .where(
        and(
          eq(knocks.kind, "session"),
          eq(knocks.targetId, sessionId),
          eq(knocks.userId, userId),
          eq(knocks.status, "pending"),
        ),
      )
      .get();
    if (!open) return { ok: false, error: "no_open_knock" };

    tx.update(knocks)
      .set({ status: "withdrawn", decidedAt: now, decidedBy: userId })
      .where(eq(knocks.id, open.id))
      .run();

    const session = tx.select({ circleId: sessions.circleId }).from(sessions).where(eq(sessions.id, sessionId)).get();
    circleId = session?.circleId;
    return { ok: true };
  });

  if (outcome.ok && circleId) {
    emitSessionEvent(sessionId, "rsvp", { circleId });
    emitCircleEvent(circleId, "rsvp", { sessionId });
  }
  return outcome;
}

export type DecideSessionKnockError =
  | "knock_not_found"
  | "not_pending"
  | "not_an_organiser"
  | "session_not_found"
  | "session_started"
  | "already_full";

export type DecideSessionKnockResult =
  | { ok: true; decision: "accepted" | "declined"; knockerId: string; filled: boolean }
  | { ok: false; error: DecideSessionKnockError };

/**
 * Organiser accepts or declines a pending session knock. ACCEPT, in one
 * synchronous transaction: mark the knock accepted AND RSVP the knocker in as
 * a session participant (source 'fourth_call' — see this file's MEMBERSHIP
 * DECISION), incrementing their rsvpInCount and firing game_filled if this
 * fills the four. DECLINE: mark declined. Either way the asker gets the
 * matching knock_accepted / knock_declined notification. Organiser-only.
 */
export function decideSessionKnock(
  db: CuatroDb,
  knockId: string,
  deciderId: string,
  decision: "accept" | "decline",
  now: Date = new Date(),
): DecideSessionKnockResult {
  let circleId: string | undefined;
  let sessionId: string | undefined;

  const outcome = db.transaction((tx): DecideSessionKnockResult => {
    const knock = tx.select().from(knocks).where(eq(knocks.id, knockId)).get();
    if (!knock || knock.kind !== "session") return { ok: false, error: "knock_not_found" };
    if (knock.status !== "pending") return { ok: false, error: "not_pending" };

    sessionId = knock.targetId;
    const session = tx.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!session) return { ok: false, error: "session_not_found" };
    circleId = session.circleId;

    const isOrganiser = !!tx
      .select({ userId: circleMembers.userId })
      .from(circleMembers)
      .where(
        and(
          eq(circleMembers.circleId, session.circleId),
          eq(circleMembers.userId, deciderId),
          eq(circleMembers.role, "organiser"),
        ),
      )
      .get();
    if (!isOrganiser) return { ok: false, error: "not_an_organiser" };

    if (decision === "decline") {
      tx.update(knocks)
        .set({ status: "declined", decidedAt: now, decidedBy: deciderId })
        .where(eq(knocks.id, knockId))
        .run();
      insertNotification(tx, {
        userId: knock.userId,
        type: "knock_declined",
        payload: { knockId, kind: "session", targetId: sessionId },
      });
      return { ok: true, decision: "declined", knockerId: knock.userId, filled: false };
    }

    // ACCEPT
    if (session.status !== "upcoming" || now.getTime() >= session.startsAt.getTime()) {
      return { ok: false, error: "session_started" };
    }
    const standingGame = session.standingGameId ? loadStandingGame(tx, session.standingGameId) : null;
    const slots = slotsForSession(standingGame);
    const confirmed = countConfirmed(tx, sessionId);
    if (confirmed >= slots) return { ok: false, error: "already_full" };

    tx.update(knocks)
      .set({ status: "accepted", decidedAt: now, decidedBy: deciderId })
      .where(eq(knocks.id, knockId))
      .run();

    // Non-member session participant — same write claimFourthCallSlot makes.
    const existing = tx
      .select()
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.userId, knock.userId)))
      .get();
    if (existing) {
      tx.update(rsvps)
        .set({ status: "in", position: null, respondedAt: now, cancelledAt: null, promotedAt: null, source: "fourth_call" })
        .where(eq(rsvps.id, existing.id))
        .run();
    } else {
      tx.insert(rsvps)
        .values({ sessionId, userId: knock.userId, status: "in", respondedAt: now, source: "fourth_call" })
        .run();
    }
    tx.update(users)
      .set({ rsvpInCount: sql`${users.rsvpInCount} + 1` })
      .where(eq(users.id, knock.userId))
      .run();

    const filled = confirmed + 1 >= slots;
    if (confirmed + 1 === slots) {
      for (const uid of confirmedParticipantIds(tx, sessionId)) {
        insertNotification(tx, { userId: uid, type: "game_filled", payload: { sessionId } });
      }
    }

    insertNotification(tx, {
      userId: knock.userId,
      type: "knock_accepted",
      payload: { knockId, kind: "session", targetId: sessionId },
    });

    return { ok: true, decision: "accepted", knockerId: knock.userId, filled };
  });

  if (outcome.ok && circleId && sessionId) {
    emitSessionEvent(sessionId, "rsvp", { circleId });
    emitCircleEvent(circleId, "rsvp", { sessionId });
  }
  return outcome;
}
