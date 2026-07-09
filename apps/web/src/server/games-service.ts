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
import { insertNotification } from "./notify";
import { computeEqualSplit } from "./tab";
import { localRingCandidates, LOCAL_RING_FANOUT_CAP } from "./local-ring";
import { emitCircleEvent, emitSessionEvent } from "@/lib/realtime/broadcast";

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

// Same story again for the played-transition sweep below: standing_games has
// durationMinutes (default 90), a one-off session has no column to hold its
// own, so it uses this product default — matching standingGames' own default.
export const DEFAULT_SESSION_DURATION_MINUTES = 90;

export const FOURTH_CALL_WINDOW_MS = 48 * 60 * 60 * 1000;
const LATE_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;

// Ring 2 (the Local Ring) opens this long after ring 1's first-refusal window
// went out, unless the organiser escalates by hand — the same 20-minute grace
// the Circle got before the call widens to nearby players.
export const FOURTH_CALL_LOCAL_RING_DELAY_MS = 20 * 60 * 1000;

export function slotsForSession(standingGame: StandingGame | null): number {
  return standingGame?.slots ?? DEFAULT_SESSION_SLOTS;
}

function rsvpWindowDaysFor(standingGame: StandingGame | null): number {
  return standingGame?.rsvpWindowDays ?? DEFAULT_RSVP_WINDOW_DAYS;
}

function durationMinutesFor(standingGame: StandingGame | null): number {
  return standingGame?.durationMinutes ?? DEFAULT_SESSION_DURATION_MINUTES;
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
  // Captured inside the transaction below so the realtime emit after it
  // (see this function's end) can fire outside the transaction — never
  // from inside `db.transaction(...)`, per lib/realtime/broadcast.ts's
  // contract — while still knowing which circle to notify.
  let circleId: string | undefined;

  const outcome = db.transaction((tx): RsvpOutcome => {
    const ctx = loadSessionContext(tx, sessionId);
    if (!ctx) return { ok: false, error: "session_not_found" };
    const { session, standingGame } = ctx;
    circleId = session.circleId;

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
      // Explicit `source: "rsvp"` (not just the schema default) so a plain
      // RSVP tap always overwrites a stale "claimed via fourth_call" flag
      // from an earlier claim on this same row (see fourth-call.ts's
      // findFourthCallClaimant) — once someone RSVPs the ordinary way,
      // that's the accurate story for how the slot is filled now.
      tx.update(rsvps)
        .set({ status: newStatus, position, respondedAt: now, cancelledAt: null, promotedAt: null, source: "rsvp" })
        .where(eq(rsvps.id, existing.id))
        .run();
    } else {
      tx.insert(rsvps).values({ sessionId, userId, status: newStatus, position, respondedAt: now, source: "rsvp" }).run();
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
          insertNotification(tx, { userId: uid, type: "game_filled", payload: { sessionId } });
        }
      }
    }

    return { ok: true, status: newStatus };
  });

  if (outcome.ok && circleId) {
    emitSessionEvent(sessionId, "rsvp", { circleId });
    emitCircleEvent(circleId, "rsvp", { sessionId });
  }
  return outcome;
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
  let circleId: string | undefined;

  const outcome = db.transaction((tx): RsvpOutcome => {
    const ctx = loadSessionContext(tx, sessionId);
    if (!ctx) return { ok: false, error: "session_not_found" };
    const { session } = ctx;
    circleId = session.circleId;

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
      insertNotification(tx, { userId: nextReserve.userId, type: "slot_promoted", payload: { sessionId } });
      return { ok: true, status: "out", promotedUserId: nextReserve.userId };
    }

    // No reserve to promote — the slot goes empty. Let the organiser(s) know
    // (this is the signal that a Fourth Call may be needed before T-48h).
    for (const organiserId of circleOrganiserIds(tx, session.circleId)) {
      insertNotification(tx, { userId: organiserId, type: "dropout", payload: { sessionId, userId } });
    }
    return { ok: true, status: "out" };
  });

  if (outcome.ok && circleId) {
    emitSessionEvent(sessionId, "rsvp", { circleId });
    emitCircleEvent(circleId, "rsvp", { sessionId });
  }
  return outcome;
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
  let circleId: string | undefined;

  const result = db.transaction((tx): FourthCallCheckResult => {
    const session = tx.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!session || session.status !== "upcoming") return { fired: false, reason: "session_not_upcoming" };
    circleId = session.circleId;

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
      insertNotification(tx, { userId, type: "fourth_call", payload: { sessionId, level: 1 } });
    }

    return { fired: true, notifiedUserIds: targets };
  });

  if (result.fired && circleId) {
    emitSessionEvent(sessionId, "fourth_call", { circleId, level: 1 });
    emitCircleEvent(circleId, "fourth_call", { sessionId, level: 1 });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Fourth Call — level 2 (THE LOCAL RING): nearby, level-matched, findable
// players. Ring 1 reached the Circle; ring 2 reaches out to the map. The
// "who's nearby" query is server/local-ring.ts; this is the escalation around
// it — the same lazy-on-view + notification-as-invite + never-nag-twice shape
// as checkFourthCallLevel1 above. A level-2 invitee need not be a circle
// member, so they claim through fourth-call.ts's claimFourthCallSlot (gated on
// holding a fourth_call notification), not rsvpIn.
// ---------------------------------------------------------------------------

export type FourthCallLocalRingResult =
  | {
      fired: false;
      reason: "not_yet" | "already_full" | "already_notified" | "session_not_upcoming" | "no_candidates";
    }
  | { fired: true; notifiedUserIds: string[] };

export interface FourthCallLocalRingOptions {
  /** Organiser tapped "Reach nearby players" — skips the 20-minutes-after-ring-1 wait. */
  forceEscalate?: boolean;
}

/** When did ring 1's first fourth_call notification for this session go out? Null if it never has. */
function fourthCallLevel1FiredAt(db: CuatroDb, sessionId: string): Date | null {
  const row = db
    .select({ createdAt: notifications.createdAt })
    .from(notifications)
    .where(
      and(
        eq(notifications.type, "fourth_call"),
        sql`json_extract(${notifications.payload}, '$.sessionId') = ${sessionId}`,
        sql`json_extract(${notifications.payload}, '$.level') = 1`,
      ),
    )
    .orderBy(asc(notifications.createdAt))
    .limit(1)
    .get();
  return row?.createdAt ?? null;
}

/** Has ring 2 (level 2) already fired for this session? Its notification is the idempotency marker. */
function fourthCallLevel2AlreadyFired(db: CuatroDb, sessionId: string): boolean {
  return !!db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.type, "fourth_call"),
        sql`json_extract(${notifications.payload}, '$.sessionId') = ${sessionId}`,
        sql`json_extract(${notifications.payload}, '$.level') = 2`,
      ),
    )
    .get();
}

/** Everyone already sent a fourth_call notification (any level) for this session — the never-nag-twice set. */
function fourthCallNotifiedUserIds(db: CuatroDb, sessionId: string): Set<string> {
  const rows = db
    .select({ userId: notifications.userId })
    .from(notifications)
    .where(
      and(
        eq(notifications.type, "fourth_call"),
        sql`json_extract(${notifications.payload}, '$.sessionId') = ${sessionId}`,
      ),
    )
    .all();
  return new Set(rows.map((r) => r.userId));
}

/**
 * Escalate a short game to the Local Ring — nearby, level-matched, findable
 * players get a level-2 fourth_call notification (which is both the nudge and
 * the claim grant — see fourth-call.ts's hasFourthCallInvite/claimFourthCallSlot).
 *
 * Fires lazily on view (no cron in v0) once ring 1's 20-minute first-refusal
 * window has elapsed, or immediately when the organiser taps escalate
 * (`forceEscalate`). Idempotent per session: a level-2 notification already
 * existing is the fired marker, so repeat views / a second tap are no-ops, and
 * anyone already invited (any level) is filtered out — nobody is nagged twice.
 *
 * ASYNC, unlike checkFourthCallLevel1: the candidate query (server/local-ring.ts)
 * resolves patches and does geo maths, which better-sqlite3 can't do inside a
 * synchronous transaction. So this computes the candidate list first (outside
 * any transaction), then mirrors ring 1's shape exactly for the write — one
 * synchronous transaction re-validates and inserts, and realtime emits only
 * after it commits.
 */
export async function checkFourthCallLocalRing(
  db: CuatroDb,
  sessionId: string,
  now: Date = new Date(),
  options: FourthCallLocalRingOptions = {},
): Promise<FourthCallLocalRingResult> {
  // --- Phase A: async gates + candidate computation (no transaction) --------
  const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!session || session.status !== "upcoming" || now.getTime() >= session.startsAt.getTime()) {
    return { fired: false, reason: "session_not_upcoming" };
  }

  const standingGame = session.standingGameId
    ? (db.select().from(standingGames).where(eq(standingGames.id, session.standingGameId)).get() ?? null)
    : null;
  if (countConfirmed(db, sessionId) >= slotsForSession(standingGame)) {
    return { fired: false, reason: "already_full" };
  }

  if (fourthCallLevel2AlreadyFired(db, sessionId)) {
    return { fired: false, reason: "already_notified" };
  }

  if (!options.forceEscalate) {
    const firedAt = fourthCallLevel1FiredAt(db, sessionId);
    if (!firedAt || now.getTime() - firedAt.getTime() < FOURTH_CALL_LOCAL_RING_DELAY_MS) {
      return { fired: false, reason: "not_yet" };
    }
  }

  const alreadyNotified = fourthCallNotifiedUserIds(db, sessionId);
  const candidates = await localRingCandidates(db, sessionId, {
    limit: LOCAL_RING_FANOUT_CAP,
    excludeUserIds: [...alreadyNotified],
  });
  if (candidates.length === 0) return { fired: false, reason: "no_candidates" };

  // --- Phase B: synchronous transaction — re-validate + write invites -------
  let circleId: string | undefined;
  const result = db.transaction((tx): FourthCallLocalRingResult => {
    const s = tx.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!s || s.status !== "upcoming" || now.getTime() >= s.startsAt.getTime()) {
      return { fired: false, reason: "session_not_upcoming" };
    }
    circleId = s.circleId;

    const sg = s.standingGameId
      ? (tx.select().from(standingGames).where(eq(standingGames.id, s.standingGameId)).get() ?? null)
      : null;
    if (countConfirmed(tx, sessionId) >= slotsForSession(sg)) {
      return { fired: false, reason: "already_full" };
    }
    if (fourthCallLevel2AlreadyFired(tx, sessionId)) {
      return { fired: false, reason: "already_notified" };
    }

    // Re-read the notified set inside the transaction so a concurrent
    // escalation can't cause a double-invite (never nag twice).
    const notifiedNow = fourthCallNotifiedUserIds(tx, sessionId);
    const chosen = candidates.filter((c) => !notifiedNow.has(c.userId));
    if (chosen.length === 0) return { fired: false, reason: "no_candidates" };

    for (const c of chosen) {
      insertNotification(tx, { userId: c.userId, type: "fourth_call", payload: { sessionId, level: 2 } });
    }
    return { fired: true, notifiedUserIds: chosen.map((c) => c.userId) };
  });

  // --- Phase C: realtime AFTER commit (never inside the transaction) --------
  if (result.fired && circleId) {
    emitSessionEvent(sessionId, "fourth_call", { circleId, level: 2 });
    emitCircleEvent(circleId, "fourth_call", { sessionId, level: 2 });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Played transition — lazy, same "no cron in v0" pattern as Fourth Call
// ---------------------------------------------------------------------------

/**
 * Lazily flips a session from "upcoming" to "played" once its scheduled end
 * (startsAt + duration) has passed. No cron in v0 (see this file's header),
 * so this runs wherever a session is loaded for view — getSessionSummary
 * below calls it first, which covers the session detail page, the games
 * list, the home page, and the circle page in one place. Idempotent: a
 * session that isn't "upcoming" (already "played", or "cancelled") is
 * returned untouched.
 */
export function ensureSessionPlayedTransition(db: CuatroDb, sessionId: string, now: Date = new Date()): Session | null {
  return db.transaction((tx) => {
    const session = tx.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!session || session.status !== "upcoming") return session ?? null;

    const standingGame = session.standingGameId
      ? (tx.select().from(standingGames).where(eq(standingGames.id, session.standingGameId)).get() ?? null)
      : null;
    const endsAt = session.startsAt.getTime() + durationMinutesFor(standingGame) * 60_000;
    if (now.getTime() < endsAt) return session;

    return tx.update(sessions).set({ status: "played" }).where(eq(sessions.id, sessionId)).returning().get();
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
  /** null when the standing game's organiser hasn't set a court cost yet (design/DESIGN-AUDIT.md F4) — a one-off session (no standing game) never has one, matching the schema (cost lives on standing_games only). */
  costMinor: number | null;
  costCurrency: string;
  /** floor(cost / slots), remainder absorbed by whoever ends up paying — same rule as server/tab.ts's computeEqualSplit, reused here for display before any Tab split exists. */
  costPerHeadMinor: number | null;
};

/** "£32 court, 4 slots" -> £8 each, floor + payer-absorbs-remainder, reusing tab.ts's computeEqualSplit (design/DESIGN-AUDIT.md F4). Null when there's no cost, or fewer than 2 slots (nothing to split). */
export function computeSessionCostPerHead(costMinor: number | null, slots: number): number | null {
  if (costMinor == null || slots < 2) return null;
  return computeEqualSplit(costMinor, slots - 1).shareMinor;
}

export function getSessionSummary(
  db: CuatroDb,
  sessionId: string,
  viewerUserId: string,
  now: Date = new Date(),
): SessionSummary | null {
  const session = ensureSessionPlayedTransition(db, sessionId, now);
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
      respondedAt: rsvps.respondedAt,
      userId: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(rsvps)
    .innerJoin(users, eq(rsvps.userId, users.id))
    .where(eq(rsvps.sessionId, sessionId))
    .all();

  // Confirmed slots fill (and must keep displaying) in RSVP order — see
  // design/HANDOFF.md's "slots fill in order" — but rsvpIn() never assigns
  // an "in" row a `position` (only the reserve queue tracks one), so this
  // must sort by `respondedAt` rather than rely on the row's DB order.
  const confirmed = rows
    .filter((r) => r.status === "in")
    .sort((a, b) => (a.respondedAt?.getTime() ?? 0) - (b.respondedAt?.getTime() ?? 0))
    .map(toPlayerRef);
  const reserves = rows
    .filter((r) => r.status === "reserve")
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(toPlayerRef);
  const viewerRow = rows.find((r) => r.userId === viewerUserId);
  const slots = slotsForSession(standingGame);
  const costMinor = standingGame?.costMinor ?? null;

  return {
    session,
    standingGame,
    venue,
    circleId: session.circleId,
    circleName: circle?.name ?? "",
    slots,
    confirmed,
    reserves,
    viewerStatus: (viewerRow?.status as "in" | "reserve" | "out" | undefined) ?? null,
    rsvpWindowOpensAt: new Date(session.startsAt.getTime() - rsvpWindowDaysFor(standingGame) * DAY_MS),
    costMinor,
    costCurrency: standingGame?.costCurrency ?? "GBP",
    costPerHeadMinor: computeSessionCostPerHead(costMinor, slots),
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
    .map((s) => getSessionSummary(db, s.id, viewerUserId, now))
    .filter((s): s is SessionSummary => s !== null);

  for (const summary of summaries) {
    checkFourthCallLevel1(db, summary.session.id, now);
  }

  return summaries;
}
