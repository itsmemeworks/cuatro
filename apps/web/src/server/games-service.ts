/**
 * Standing Games + RSVP core: lazy session instantiation, RSVP/reserve/
 * auto-promotion mechanics, reliability counters, and the Fourth Call
 * level-1 (T-48h) trigger.
 *
 * Concurrency: every mutating function below runs its critical section
 * inside a single `db.transaction((tx) => { ... })` using ONLY synchronous
 * drizzle calls (`.get()/.all()/.run()`, never `await`). better-sqlite3's
 * `Database#transaction()` wrapper requires a fully synchronous callback —
 * if it were async, better-sqlite3 throws. That constraint is what buys us
 * safety: given the single shared connection from games-db.ts, a
 * transaction body runs start-to-finish with no opportunity for another
 * call into this module to interleave (there's no `await` point for the
 * event loop to preempt), so "confirmed player cancels while another
 * cancels at the same moment" can never double-promote the same reserve.
 * This relies on all games-server code sharing one connection/process
 * (getGamesClient()'s singleton) — see games-db.ts.
 */
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  circleMembers,
  circles,
  notifications,
  rsvps,
  sessions,
  standingGames,
  users,
  venues,
  type CuatroDb,
  type Rsvp,
  type Session,
  type StandingGame,
  type Venue,
} from "@cuatro/db";
import { computeNextOccurrence } from "./tz";
import { resolveVenue, isOrganiser } from "./standing-games-service";

const DAY_MS = 24 * 60 * 60 * 1000;

// `sessions` has no `slots` column of its own (only standing_games does) —
// a one-off session (no standingGameId) has nowhere in the current schema
// to record a custom slot count, so it defaults to 4 (the game the whole
// product exists to assemble). Documented limitation: a future
// `sessions.slots` override column would remove this default for one-offs.
export const DEFAULT_SESSION_SLOTS = 4;

// Likewise, the RSVP window is a standing_games column; one-off sessions
// fall back to the product default (6 days) rather than being configurable.
export const DEFAULT_RSVP_WINDOW_DAYS = 6;

export const FOURTH_CALL_WINDOW_MS = 48 * 60 * 60 * 1000;
const LATE_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;

export function slotsForSession(standingGame: StandingGame | null): number {
  return standingGame?.slots ?? DEFAULT_SESSION_SLOTS;
}

function rsvpWindowDaysFor(standingGame: StandingGame | null): number {
  return standingGame?.rsvpWindowDays ?? DEFAULT_RSVP_WINDOW_DAYS;
}

function effectiveTimezone(venue: Venue | null, circle: { timezone: string }): string {
  return venue?.timezone ?? circle.timezone;
}

// ---------------------------------------------------------------------------
// Session instantiation (lazy, idempotent)
// ---------------------------------------------------------------------------

/**
 * Ensures the next upcoming session for a standing game exists, computing
 * its start time fresh from `now` every call. Idempotent: because the next
 * occurrence is a pure function of (weekday, startTime, timezone, now), a
 * repeat call while that occurrence is still in the future recomputes the
 * same UTC instant and finds the existing row instead of inserting a
 * duplicate. Once that occurrence's start time has passed, the next call
 * naturally advances to the following week's occurrence — no cron needed.
 */
export function ensureUpcomingSessionForStandingGame(
  db: CuatroDb,
  standingGameId: string,
  now: Date = new Date(),
): Session {
  return db.transaction((tx) => {
    const sg = tx.select().from(standingGames).where(eq(standingGames.id, standingGameId)).get();
    if (!sg) throw new Error(`ensureUpcomingSessionForStandingGame: no such standing game ${standingGameId}`);

    const circle = tx.select().from(circles).where(eq(circles.id, sg.circleId)).get();
    if (!circle) throw new Error(`ensureUpcomingSessionForStandingGame: no such circle ${sg.circleId}`);
    const venue = sg.venueId ? (tx.select().from(venues).where(eq(venues.id, sg.venueId)).get() ?? null) : null;

    const tz = effectiveTimezone(venue, circle);
    const nextStart = computeNextOccurrence(sg.weekday, sg.startTime, tz, now);

    const existing = tx
      .select()
      .from(sessions)
      .where(and(eq(sessions.standingGameId, sg.id), eq(sessions.startsAt, nextStart)))
      .get();
    if (existing) return existing;

    return tx
      .insert(sessions)
      .values({
        standingGameId: sg.id,
        circleId: sg.circleId,
        venueId: sg.venueId,
        startsAt: nextStart,
        status: "upcoming",
      })
      .returning()
      .get();
  });
}

/** Ensures every active standing game in a circle has its next session generated. */
export function ensureUpcomingSessionsForCircle(db: CuatroDb, circleId: string, now: Date = new Date()): Session[] {
  const active = db
    .select()
    .from(standingGames)
    .where(and(eq(standingGames.circleId, circleId), eq(standingGames.active, true)))
    .all();
  return active.map((sg) => ensureUpcomingSessionForStandingGame(db, sg.id, now));
}

export type OneOffSessionInput = {
  circleId: string;
  startsAt: Date;
  venueId?: string | null;
  venueName?: string | null;
};

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** A one-off session has no standing_game_id — organiser-created, single occurrence. */
export function createOneOffSession(db: CuatroDb, userId: string, input: OneOffSessionInput): ServiceResult<Session> {
  if (!isOrganiser(db, input.circleId, userId)) return { ok: false, error: "not_an_organiser" };

  const venueId = resolveVenue(db, input.circleId, input.venueId, input.venueName);
  const created = db
    .insert(sessions)
    .values({
      circleId: input.circleId,
      venueId,
      startsAt: input.startsAt,
      status: "upcoming",
    })
    .returning()
    .get();

  return { ok: true, value: created };
}

// ---------------------------------------------------------------------------
// RSVP mechanics
// ---------------------------------------------------------------------------

export type RsvpOutcome =
  | { ok: true; status: "in" | "reserve" | "out"; promotedUserId?: string }
  | {
      ok: false;
      error: "session_not_found" | "not_a_circle_member" | "window_not_open" | "session_started";
    };

function loadSessionContext(
  tx: CuatroDb,
  sessionId: string,
): { session: Session; standingGame: StandingGame | null } | null {
  const session = tx.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!session) return null;
  const standingGame = session.standingGameId
    ? (tx.select().from(standingGames).where(eq(standingGames.id, session.standingGameId)).get() ?? null)
    : null;
  return { session, standingGame };
}

function isCircleMember(tx: CuatroDb, circleId: string, userId: string): boolean {
  const row = tx
    .select({ userId: circleMembers.userId })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)))
    .get();
  return !!row;
}

function circleOrganiserIds(tx: CuatroDb, circleId: string): string[] {
  return tx
    .select({ userId: circleMembers.userId })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.role, "organiser")))
    .all()
    .map((r) => r.userId);
}

function countConfirmed(tx: CuatroDb, sessionId: string): number {
  return (
    tx
      .select({ n: sql<number>`count(*)` })
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "in")))
      .get()?.n ?? 0
  );
}

/**
 * Tap IN. First `slots` INs (for the session) hold a slot; anyone after
 * that queues as a reserve, ordered by arrival. Idempotent if already
 * 'in' or 'reserve'. Rejected outside the RSVP window (before it opens, or
 * once the session has started).
 */
export function rsvpIn(db: CuatroDb, sessionId: string, userId: string, now: Date = new Date()): RsvpOutcome {
  return db.transaction((tx) => {
    const ctx = loadSessionContext(tx, sessionId);
    if (!ctx) return { ok: false, error: "session_not_found" };
    const { session, standingGame } = ctx;

    if (!isCircleMember(tx, session.circleId, userId)) return { ok: false, error: "not_a_circle_member" };
    if (now.getTime() >= session.startsAt.getTime()) return { ok: false, error: "session_started" };

    const windowOpensAt = session.startsAt.getTime() - rsvpWindowDaysFor(standingGame) * DAY_MS;
    if (now.getTime() < windowOpensAt) return { ok: false, error: "window_not_open" };

    const existing = tx
      .select()
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.userId, userId)))
      .get();
    if (existing && existing.status !== "out") {
      return { ok: true, status: existing.status };
    }

    const slots = slotsForSession(standingGame);
    const confirmedCount = countConfirmed(tx, sessionId);

    let newStatus: "in" | "reserve";
    let position: number | null = null;
    if (confirmedCount < slots) {
      newStatus = "in";
    } else {
      newStatus = "reserve";
      const maxPos =
        tx
          .select({ n: sql<number>`coalesce(max(${rsvps.position}), 0)` })
          .from(rsvps)
          .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "reserve")))
          .get()?.n ?? 0;
      position = maxPos + 1;
    }

    if (existing) {
      tx.update(rsvps)
        .set({ status: newStatus, position, respondedAt: now, cancelledAt: null, promotedAt: null })
        .where(eq(rsvps.id, existing.id))
        .run();
    } else {
      tx.insert(rsvps).values({ sessionId, userId, status: newStatus, position, respondedAt: now }).run();
    }

    if (newStatus === "in") {
      tx.update(users)
        .set({ rsvpInCount: sql`${users.rsvpInCount} + 1` })
        .where(eq(users.id, userId))
        .run();

      if (confirmedCount + 1 === slots) {
        const confirmedIds = tx
          .select({ userId: rsvps.userId })
          .from(rsvps)
          .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "in")))
          .all()
          .map((r) => r.userId);
        for (const uid of confirmedIds) {
          tx.insert(notifications).values({ userId: uid, type: "game_filled", payload: { sessionId } }).run();
        }
      }
    }

    return { ok: true, status: newStatus };
  });
}

/**
 * Tap OUT. Dropping a held ('in') slot auto-promotes reserve #1
 * transactionally and reindexes the remaining queue; dropping out of the
 * reserve queue just closes the gap behind you. Reliability: a confirmed
 * player cancelling inside 24h of start counts as a late cancel; earlier
 * cancels don't. Every state change that affects someone else writes a
 * notification (promotion, or — if there's no reserve to promote —
 * a dropout notice to the circle's organisers so they know a slot is open).
 */
export function rsvpOut(db: CuatroDb, sessionId: string, userId: string, now: Date = new Date()): RsvpOutcome {
  return db.transaction((tx) => {
    const ctx = loadSessionContext(tx, sessionId);
    if (!ctx) return { ok: false, error: "session_not_found" };
    const { session } = ctx;

    if (!isCircleMember(tx, session.circleId, userId)) return { ok: false, error: "not_a_circle_member" };
    if (now.getTime() >= session.startsAt.getTime()) return { ok: false, error: "session_started" };

    const existing = tx
      .select()
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.userId, userId)))
      .get();
    if (!existing || existing.status === "out") {
      return { ok: true, status: "out" };
    }

    if (existing.status === "reserve") {
      tx.update(rsvps)
        .set({ status: "out", position: null, cancelledAt: now })
        .where(eq(rsvps.id, existing.id))
        .run();
      closeReserveGap(tx, sessionId, existing.position ?? 0);
      return { ok: true, status: "out" };
    }

    // existing.status === "in": a confirmed dropout.
    const msToStart = session.startsAt.getTime() - now.getTime();
    if (msToStart < LATE_CANCEL_WINDOW_MS) {
      tx.update(users)
        .set({ lateCancelCount: sql`${users.lateCancelCount} + 1` })
        .where(eq(users.id, userId))
        .run();
    }
    tx.update(rsvps).set({ status: "out", position: null, cancelledAt: now }).where(eq(rsvps.id, existing.id)).run();

    const nextReserve: Rsvp | undefined = tx
      .select()
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "reserve")))
      .orderBy(asc(rsvps.position))
      .limit(1)
      .get();

    if (nextReserve) {
      tx.update(rsvps)
        .set({ status: "in", position: null, promotedAt: now })
        .where(eq(rsvps.id, nextReserve.id))
        .run();
      tx.update(users)
        .set({ rsvpInCount: sql`${users.rsvpInCount} + 1` })
        .where(eq(users.id, nextReserve.userId))
        .run();
      closeReserveGap(tx, sessionId, nextReserve.position ?? 0);
      tx.insert(notifications)
        .values({ userId: nextReserve.userId, type: "slot_promoted", payload: { sessionId } })
        .run();
      return { ok: true, status: "out", promotedUserId: nextReserve.userId };
    }

    // No reserve to promote — the slot goes empty. Let the organiser(s) know
    // (this is the signal that a Fourth Call may be needed before T-48h).
    for (const organiserId of circleOrganiserIds(tx, session.circleId)) {
      tx.insert(notifications).values({ userId: organiserId, type: "dropout", payload: { sessionId, userId } }).run();
    }
    return { ok: true, status: "out" };
  });
}

/** Shifts every reserve position greater than `vacatedPosition` down by one, closing the gap. */
function closeReserveGap(tx: CuatroDb, sessionId: string, vacatedPosition: number): void {
  tx.update(rsvps)
    .set({ position: sql`${rsvps.position} - 1` })
    .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "reserve"), gt(rsvps.position, vacatedPosition)))
    .run();
}

// ---------------------------------------------------------------------------
// Fourth Call — level 1 (Circle only; extended network is v0-out-of-scope)
// ---------------------------------------------------------------------------

export type FourthCallCheckResult =
  | { fired: false; reason: "not_yet" | "already_full" | "already_notified" | "session_not_upcoming" }
  | { fired: true; notifiedUserIds: string[] };

/**
 * Lazily checked on view (no cron in v0 — documented limitation: a session
 * nobody looks at between T-48h and kickoff never gets its Fourth Call).
 * Idempotent: uses the presence of an existing `fourth_call` notification
 * for this session (via json_extract on the payload) as the "already
 * fired" marker, so repeat views don't spam duplicate notifications.
 */
export function checkFourthCallLevel1(
  db: CuatroDb,
  sessionId: string,
  now: Date = new Date(),
): FourthCallCheckResult {
  return db.transaction((tx) => {
    const session = tx.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!session || session.status !== "upcoming") return { fired: false, reason: "session_not_upcoming" };

    const msToStart = session.startsAt.getTime() - now.getTime();
    if (msToStart < 0) return { fired: false, reason: "session_not_upcoming" };
    if (msToStart > FOURTH_CALL_WINDOW_MS) return { fired: false, reason: "not_yet" };

    const standingGame = session.standingGameId
      ? (tx.select().from(standingGames).where(eq(standingGames.id, session.standingGameId)).get() ?? null)
      : null;
    if (countConfirmed(tx, sessionId) >= slotsForSession(standingGame)) {
      return { fired: false, reason: "already_full" };
    }

    const alreadyFired = tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.type, "fourth_call"),
          sql`json_extract(${notifications.payload}, '$.sessionId') = ${sessionId}`,
        ),
      )
      .get();
    if (alreadyFired) return { fired: false, reason: "already_notified" };

    const members = tx
      .select({ userId: circleMembers.userId })
      .from(circleMembers)
      .where(eq(circleMembers.circleId, session.circleId))
      .all();
    const responded = new Set(
      tx
        .select({ userId: rsvps.userId })
        .from(rsvps)
        .where(eq(rsvps.sessionId, sessionId))
        .all()
        .map((r) => r.userId),
    );
    const targets = members.map((m) => m.userId).filter((id) => !responded.has(id));

    for (const userId of targets) {
      tx.insert(notifications).values({ userId, type: "fourth_call", payload: { sessionId, level: 1 } }).run();
    }

    return { fired: true, notifiedUserIds: targets };
  });
}

// ---------------------------------------------------------------------------
// Read models for the UI
// ---------------------------------------------------------------------------

export type PlayerRef = { userId: string; displayName: string; avatarUrl: string | null };

export type SessionSummary = {
  session: Session;
  standingGame: StandingGame | null;
  venue: Venue | null;
  circleId: string;
  circleName: string;
  slots: number;
  confirmed: PlayerRef[];
  reserves: PlayerRef[]; // ordered by position
  viewerStatus: "in" | "reserve" | "out" | null;
  rsvpWindowOpensAt: Date;
};

export function getSessionSummary(db: CuatroDb, sessionId: string, viewerUserId: string): SessionSummary | null {
  const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!session) return null;

  const standingGame = session.standingGameId
    ? (db.select().from(standingGames).where(eq(standingGames.id, session.standingGameId)).get() ?? null)
    : null;
  const venue = session.venueId ? (db.select().from(venues).where(eq(venues.id, session.venueId)).get() ?? null) : null;
  const circle = db.select().from(circles).where(eq(circles.id, session.circleId)).get();

  const rows = db
    .select({
      status: rsvps.status,
      position: rsvps.position,
      userId: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(rsvps)
    .innerJoin(users, eq(rsvps.userId, users.id))
    .where(eq(rsvps.sessionId, sessionId))
    .all();

  const confirmed = rows.filter((r) => r.status === "in").map(toPlayerRef);
  const reserves = rows
    .filter((r) => r.status === "reserve")
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(toPlayerRef);
  const viewerRow = rows.find((r) => r.userId === viewerUserId);

  return {
    session,
    standingGame,
    venue,
    circleId: session.circleId,
    circleName: circle?.name ?? "",
    slots: slotsForSession(standingGame),
    confirmed,
    reserves,
    viewerStatus: (viewerRow?.status as "in" | "reserve" | "out" | undefined) ?? null,
    rsvpWindowOpensAt: new Date(session.startsAt.getTime() - rsvpWindowDaysFor(standingGame) * DAY_MS),
  };
}

function toPlayerRef(row: { userId: string; displayName: string; avatarUrl: string | null }): PlayerRef {
  return { userId: row.userId, displayName: row.displayName, avatarUrl: row.avatarUrl };
}

/** Live view condition for the "Fourth Call" banner — independent of whether the notification has fired. */
export function isFourthCallActive(
  summary: Pick<SessionSummary, "session" | "slots" | "confirmed">,
  now: Date = new Date(),
): boolean {
  const msToStart = summary.session.startsAt.getTime() - now.getTime();
  return (
    summary.session.status === "upcoming" &&
    msToStart >= 0 &&
    msToStart <= FOURTH_CALL_WINDOW_MS &&
    summary.confirmed.length < summary.slots
  );
}

/**
 * Upcoming sessions across every circle the user belongs to — the /games
 * page's data source. Ensures lazy generation and the Fourth Call check
 * happen on this view, per the "no cron in v0" design.
 */
export function listUpcomingSessionsForUser(db: CuatroDb, userId: string, now: Date = new Date()): SessionSummary[] {
  const memberCircleIds = db
    .select({ circleId: circleMembers.circleId })
    .from(circleMembers)
    .where(eq(circleMembers.userId, userId))
    .all()
    .map((r) => r.circleId);
  if (memberCircleIds.length === 0) return [];

  return listUpcomingSessionsForCircles(db, memberCircleIds, userId, now);
}

/**
 * Upcoming sessions for one circle — the circle detail page's data source
 * (shares the same lazy-generation + Fourth Call semantics as
 * listUpcomingSessionsForUser, just scoped to a single circle instead of
 * every circle a user belongs to).
 */
export function listUpcomingSessionsForCircle(
  db: CuatroDb,
  circleId: string,
  viewerUserId: string,
  now: Date = new Date(),
): SessionSummary[] {
  return listUpcomingSessionsForCircles(db, [circleId], viewerUserId, now);
}

function listUpcomingSessionsForCircles(
  db: CuatroDb,
  circleIds: string[],
  viewerUserId: string,
  now: Date,
): SessionSummary[] {
  for (const circleId of circleIds) {
    ensureUpcomingSessionsForCircle(db, circleId, now);
  }

  const upcoming = db
    .select()
    .from(sessions)
    .where(and(inArray(sessions.circleId, circleIds), eq(sessions.status, "upcoming"), gt(sessions.startsAt, now)))
    .orderBy(asc(sessions.startsAt))
    .all();

  const summaries = upcoming
    .map((s) => getSessionSummary(db, s.id, viewerUserId))
    .filter((s): s is SessionSummary => s !== null);

  for (const summary of summaries) {
    checkFourthCallLevel1(db, summary.session.id, now);
  }

  return summaries;
}
