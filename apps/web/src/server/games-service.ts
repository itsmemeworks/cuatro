/**
 * Standing Games + RSVP core: lazy session instantiation, RSVP/reserve/
 * auto-promotion mechanics, reliability counters, and the Fourth Call
 * level-1 (T-48h) trigger.
 *
 * Concurrency: every mutating function below runs its critical section
 * inside an ASYNC `await db.transaction(async (tx) => { ... })` (Postgres via
 * postgres-js). Postgres MVCC does NOT serialize writers the way better-sqlite3
 * did, so each read-decide-write transaction takes an explicit row lock on its
 * anchoring row FIRST — the session row (`.for('update')`) for RSVP / rotation
 * / Fourth Call paths, or the standing_games row for session materialisation /
 * reschedule. That lock is what now guarantees "confirmed player cancels while
 * another cancels at the same moment" can't double-promote the same reserve:
 * the second transaction blocks on the FOR UPDATE until the first commits, then
 * re-reads the post-commit state. Realtime emits STILL fire only AFTER the
 * transaction commits, never inside it (see lib/realtime/broadcast.ts).
 */
import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import {
  circleMembers,
  circles,
  matches,
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
  type GameType,
} from "@cuatro/db";
import { computeNextOccurrence } from "./tz";
import { DEFAULT_TZ } from "@/lib/time";
import { InvalidVenueError, resolveVenue, isOrganiser } from "./standing-games-service";
import { insertNotification } from "./notify";
import {
  computeRotation,
  ROTATION_RECENT_WINDOW,
  type RotationCandidate,
  type RotationPastSession,
  type RotationReason,
} from "./rotation";
import { notifyRotationSelected, notifyRotationSittingOut } from "./rotation-notify";
import { computeEqualSplit } from "./tab";
import { localRingCandidates, LOCAL_RING_FANOUT_CAP } from "./local-ring";
import { playedWithCandidates, PLAYED_WITH_FANOUT_CAP } from "./played-with";
import { emitCircleEvent, emitSessionEvent, emitUserEvent } from "@/lib/realtime/broadcast";
import { BOOKING_PLATFORM_IDS, resolveMoneyOptIn, type MoneyOptIn } from "@/lib/booking";
import { normalizeBookingUrl } from "./standing-games-service";
import { captureEvent } from "@/lib/analytics";

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

// THE ROTATION's default cutoff: how long before kickoff a LIMITED-mode game
// locks its four when the organiser hasn't set their own. Kept inside the
// Fourth Call's T-48h window so a short rotation game still has time to fill.
// The actual cutoff is per-Standing-Game (standing_games.rotation_cutoff_hours).
export const ROTATION_DEFAULT_CUTOFF_HOURS = 24;
export const ROTATION_LOCK_LEAD_MS = ROTATION_DEFAULT_CUTOFF_HOURS * 60 * 60 * 1000;

/** The configured cutoff lead (ms before kickoff) for this game's rotation lock. */
function rotationCutoffMs(standingGame: StandingGame | null): number {
  return (standingGame?.rotationCutoffHours ?? ROTATION_DEFAULT_CUTOFF_HOURS) * 60 * 60 * 1000;
}

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
export async function ensureUpcomingSessionForStandingGame(
  db: CuatroDb,
  standingGameId: string,
  now: Date = new Date(),
): Promise<Session> {
  // Set when the transaction actually inserts a NEW session (vs. finding an
  // existing one), so the §9 session_materialized event fires AFTER commit and
  // only on a genuine materialisation — not on every idempotent re-check.
  let materialised: Session | undefined;

  const session = await db.transaction(async (tx) => {
    // Lock the standing_games row FIRST: materialisation is a read-decide-insert
    // (is there already a session on this occurrence? if not, insert one) with
    // no unique constraint on (standing_game_id, starts_at), so two concurrent
    // views/boots could otherwise both miss the existing row and insert a
    // duplicate. FOR UPDATE on the parent serialises them.
    const [sg] = await tx.select().from(standingGames).where(eq(standingGames.id, standingGameId)).for("update");
    if (!sg) throw new Error(`ensureUpcomingSessionForStandingGame: no such standing game ${standingGameId}`);

    const [circle] = await tx.select().from(circles).where(eq(circles.id, sg.circleId));
    if (!circle) throw new Error(`ensureUpcomingSessionForStandingGame: no such circle ${sg.circleId}`);
    const venue = sg.venueId ? ((await tx.select().from(venues).where(eq(venues.id, sg.venueId)))[0] ?? null) : null;

    const tz = effectiveTimezone(venue, circle);
    const nextStart = computeNextOccurrence(sg.weekday, sg.startTime, tz, now).getTime();

    const [existing] = await tx
      .select()
      .from(sessions)
      .where(and(eq(sessions.standingGameId, sg.id), eq(sessions.startsAt, nextStart)));
    if (existing) return existing;

    const [created] = await tx
      .insert(sessions)
      .values({
        standingGameId: sg.id,
        circleId: sg.circleId,
        venueId: sg.venueId,
        startsAt: nextStart,
        status: "upcoming",
        gameType: sg.gameType,
      })
      .returning();
    materialised = created;
    return created;
  });

  // §9 metric 1: session_materialized — a scheduler-driven, no-acting-user
  // event (SYSTEM_DISTINCT_ID). METRICS.md §5 depends on these arriving as the
  // scheduler-heartbeat health signal, so a silent gap reads as an ops fault,
  // not churn.
  if (materialised) {
    captureEvent("session_materialized", {
      circleId: materialised.circleId,
      sessionId: materialised.id,
      timestamp: materialised.createdAt,
      properties: {
        standing_game_id: materialised.standingGameId,
        scheduled_for: materialised.startsAt,
        game_type: materialised.gameType,
        created_at: materialised.createdAt,
      },
    });
  }
  return session;
}

/** Ensures every active standing game in a circle has its next session generated. */
export async function ensureUpcomingSessionsForCircle(db: CuatroDb, circleId: string, now: Date = new Date()): Promise<Session[]> {
  const active = await db
    .select()
    .from(standingGames)
    .where(and(eq(standingGames.circleId, circleId), eq(standingGames.active, true)));
  const result: Session[] = [];
  for (const sg of active) result.push(await ensureUpcomingSessionForStandingGame(db, sg.id, now));
  return result;
}

export type RescheduleResult = {
  circleId: string | null;
  /** Sessions whose slot (start time) and/or venue moved. */
  movedSessionIds: string[];
  /** Every RSVP'd player (in or reserve) told once, across all moved sessions. */
  notifiedUserIds: string[];
};

/**
 * Move this standing game's future upcoming session(s) onto the game's
 * CURRENT slot after an organiser edits its day/time (or venue), and tell
 * every RSVP'd player once (v1 audit, journeys finding 5).
 *
 * Why this exists: the next-occurrence instant is a pure function of
 * (weekday, startTime, timezone), so a slot change leaves the already-
 * materialised session sitting on its old date. A plain re-read would just
 * mint a SECOND session at the new slot (ensureUpcomingSessionForStandingGame
 * matches by exact startsAt) and orphan the old one — the organiser sees "I
 * moved it and nothing happened". Instead we move the existing row so its
 * RSVPs ride along on the same session id.
 *
 * Honest semantics: past/played sessions never move (filtered to
 * status=upcoming AND startsAt strictly in the future). No-op when nothing
 * changed — a cost-only edit finds the session already on the right slot and
 * with the right venue, so it moves nothing and notifies no one. Only the
 * soonest future session is re-slotted (generation makes one at a time); any
 * extra future rows only follow a venue change, never collapse onto one
 * instant.
 *
 * Returns what moved + who was told so the caller can fire realtime signals
 * AFTER the transaction commits — never inside it (see lib/realtime/broadcast.ts).
 */
export async function rescheduleUpcomingSessionsForStandingGame(
  db: CuatroDb,
  standingGameId: string,
  now: Date = new Date(),
): Promise<RescheduleResult> {
  return db.transaction(async (tx): Promise<RescheduleResult> => {
    // Lock the standing_games row: we re-slot its future session(s) based on a
    // read of the game's current weekday/time/venue, so serialise against a
    // concurrent materialisation/edit on the same game.
    const [sg] = await tx.select().from(standingGames).where(eq(standingGames.id, standingGameId)).for("update");
    if (!sg) return { circleId: null, movedSessionIds: [], notifiedUserIds: [] };
    const [circle] = await tx.select().from(circles).where(eq(circles.id, sg.circleId));
    if (!circle) return { circleId: null, movedSessionIds: [], notifiedUserIds: [] };
    const venue = sg.venueId ? ((await tx.select().from(venues).where(eq(venues.id, sg.venueId)))[0] ?? null) : null;

    const tz = effectiveTimezone(venue, circle);
    const target = computeNextOccurrence(sg.weekday, sg.startTime, tz, now).getTime();

    const future = await tx
      .select()
      .from(sessions)
      .where(and(eq(sessions.standingGameId, sg.id), eq(sessions.status, "upcoming"), gt(sessions.startsAt, now.getTime())))
      .orderBy(asc(sessions.startsAt));

    const movedSessionIds: string[] = [];
    const notifiedUserIds: string[] = [];

    for (let i = 0; i < future.length; i++) {
      const session = future[i];
      // Re-slot only the soonest future session to the recomputed occurrence;
      // any others (not normally present) keep their date and just follow the
      // venue, so two rows never land on the same instant.
      const newStartsAt = i === 0 ? target : session.startsAt;
      const startChanged = newStartsAt !== session.startsAt;
      const venueChanged = (session.venueId ?? null) !== (sg.venueId ?? null);
      if (!startChanged && !venueChanged) continue;

      await tx.update(sessions)
        .set({ startsAt: newStartsAt, venueId: sg.venueId })
        .where(eq(sessions.id, session.id));
      movedSessionIds.push(session.id);

      // One notification per RSVP'd player (held slot or reserve).
      const attendees = await tx
        .select({ userId: rsvps.userId })
        .from(rsvps)
        .where(and(eq(rsvps.sessionId, session.id), inArray(rsvps.status, ["in", "reserve"])));
      for (const a of attendees) {
        await insertNotification(tx, { userId: a.userId, type: "session_rescheduled", payload: { sessionId: session.id } });
        notifiedUserIds.push(a.userId);
      }
    }

    return { circleId: sg.circleId, movedSessionIds, notifiedUserIds };
  });
}

export type OneOffSessionInput = {
  circleId: string;
  startsAt: Date;
  venueId?: string | null;
  venueName?: string | null;
  /** FRIENDLIES classification. Omit to inherit the circle's default_game_type. */
  gameType?: GameType;
  /** "Booked on" signpost (issue #21). A one-off has no standing game to inherit from, so it sets the signpost directly on the session row. Sessions carry no cost column, so there's no cost XOR here. */
  bookingPlatform?: string | null;
  /** Optional pasted booking URL (http/https); only stored alongside a platform. */
  bookingUrl?: string | null;
};

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** A one-off session has no standing_game_id — organiser-created, single occurrence. */
export async function createOneOffSession(db: CuatroDb, userId: string, input: OneOffSessionInput): Promise<ServiceResult<Session>> {
  if (!(await isOrganiser(db, input.circleId, userId))) return { ok: false, error: "not_an_organiser" };

  // "Booked on" (issue #21): validated here the same way the standing-game
  // service does — unknown platform ids and non-http(s) URLs bounce.
  const bookingPlatform = (input.bookingPlatform ?? null) as Session["bookingPlatform"];
  if (bookingPlatform != null && !(BOOKING_PLATFORM_IDS as readonly string[]).includes(bookingPlatform)) {
    return { ok: false, error: "invalid_booking_platform" };
  }
  const bookingUrlResult = normalizeBookingUrl(input.bookingUrl);
  if (!bookingUrlResult.ok) return { ok: false, error: "invalid_booking_url" };
  const bookingUrl = bookingPlatform ? bookingUrlResult.url : null;

  let venueId: string | null;
  try {
    venueId = await resolveVenue(db, input.circleId, input.venueId, input.venueName);
  } catch (err) {
    if (err instanceof InvalidVenueError) return { ok: false, error: "invalid_venue" };
    throw err;
  }
  const [circleRow] = await db
    .select({ defaultGameType: circles.defaultGameType })
    .from(circles)
    .where(eq(circles.id, input.circleId));
  const gameType = input.gameType ?? circleRow?.defaultGameType ?? "competitive";
  const [created] = await db
    .insert(sessions)
    .values({
      circleId: input.circleId,
      venueId,
      startsAt: input.startsAt.getTime(),
      status: "upcoming",
      gameType,
      bookingPlatform,
      bookingUrl,
    })
    .returning();

  return { ok: true, value: created };
}

// ---------------------------------------------------------------------------
// RSVP mechanics
// ---------------------------------------------------------------------------

export type RsvpOutcome =
  | { ok: true; status: "in" | "reserve" | "out"; promotedUserId?: string }
  | {
      ok: false;
      error: "session_not_found" | "not_a_circle_member" | "window_not_open" | "session_started" | "rotation_not_locked";
    };

/**
 * Loads the session (+ its standing game). Pass `{ lock: true }` from inside a
 * transaction that will read-decide-write on this session to take a
 * `SELECT ... FOR UPDATE` row lock on the session row FIRST — every concurrent
 * writer then serialises behind it. Read-only callers omit it (and MUST NOT
 * lock outside a transaction).
 */
async function loadSessionContext(
  tx: CuatroDb,
  sessionId: string,
  opts: { lock?: boolean } = {},
): Promise<{ session: Session; standingGame: StandingGame | null } | null> {
  const base = tx.select().from(sessions).where(eq(sessions.id, sessionId));
  const [session] = await (opts.lock ? base.for("update") : base);
  if (!session) return null;
  const standingGame = session.standingGameId
    ? ((await tx.select().from(standingGames).where(eq(standingGames.id, session.standingGameId)))[0] ?? null)
    : null;
  return { session, standingGame };
}

async function isCircleMember(tx: CuatroDb, circleId: string, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ userId: circleMembers.userId })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)));
  return !!row;
}

async function circleOrganiserIds(tx: CuatroDb, circleId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: circleMembers.userId })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.role, "organiser")));
  return rows.map((r) => r.userId);
}

async function countConfirmed(tx: CuatroDb, sessionId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)` })
    .from(rsvps)
    .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "in")));
  return Number(row?.n ?? 0);
}

/**
 * Tap IN. First `slots` INs (for the session) hold a slot; anyone after
 * that queues as a reserve, ordered by arrival. Idempotent if already
 * 'in' or 'reserve'. Rejected outside the RSVP window (before it opens, or
 * once the session has started).
 */
export async function rsvpIn(db: CuatroDb, sessionId: string, userId: string, now: Date = new Date()): Promise<RsvpOutcome> {
  // Captured inside the transaction below so the realtime emit after it
  // (see this function's end) can fire outside the transaction — never
  // from inside `db.transaction(...)`, per lib/realtime/broadcast.ts's
  // contract — while still knowing which circle to notify.
  let circleId: string | undefined;

  const outcome = await db.transaction(async (tx): Promise<RsvpOutcome> => {
    // Lock the session row: the capacity check (confirmedCount < slots) then the
    // slot/reserve write is a classic read-decide-write that Postgres MVCC would
    // otherwise let two tappers run against the same pre-write count, oversubscribing
    // the last slot. FOR UPDATE serialises them so the second sees the first's commit.
    const ctx = await loadSessionContext(tx, sessionId, { lock: true });
    if (!ctx) return { ok: false, error: "session_not_found" };
    const { session, standingGame } = ctx;
    circleId = session.circleId;

    if (!(await isCircleMember(tx, session.circleId, userId))) return { ok: false, error: "not_a_circle_member" };
    if (now.getTime() >= session.startsAt) return { ok: false, error: "session_started" };

    const windowOpensAt = session.startsAt - rsvpWindowDaysFor(standingGame) * DAY_MS;
    if (now.getTime() < windowOpensAt) return { ok: false, error: "window_not_open" };

    // A GATHERING limited-rotation game has no slots to grab — the four come
    // from 'available' rows only. Reject the bare slot-grab structurally so no
    // UI (present or future) can recreate QA8's "You're in beside four open
    // slots" contradiction; callers surface the rotation affordance
    // (declareRotationAvailability) instead. Locked rotation falls through:
    // post-lock joins are the deliberate late-fill path.
    if (standingGame?.rotationEnabled && standingGame.rotationMode === "limited" && !session.rotationLockedAt) {
      return { ok: false, error: "rotation_not_locked" };
    }

    const [existing] = await tx
      .select()
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.userId, userId)));
    // Already holding a slot or queued — idempotent no-op. ('available' is a
    // rotation-only state; in the plain first-come path it's treated as not-yet
    // committed and falls through to a normal slot/reserve assignment.)
    if (existing && (existing.status === "in" || existing.status === "reserve")) {
      return { ok: true, status: existing.status };
    }

    const slots = slotsForSession(standingGame);
    const confirmedCount = await countConfirmed(tx, sessionId);

    let newStatus: "in" | "reserve";
    let position: number | null = null;
    if (confirmedCount < slots) {
      newStatus = "in";
    } else {
      newStatus = "reserve";
      const [maxRow] = await tx
        .select({ n: sql<number>`coalesce(max(${rsvps.position}), 0)` })
        .from(rsvps)
        .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "reserve")));
      position = Number(maxRow?.n ?? 0) + 1;
    }

    if (existing) {
      // Explicit `source: "rsvp"` (not just the schema default) so a plain
      // RSVP tap always overwrites a stale "claimed via fourth_call" flag
      // from an earlier claim on this same row (see fourth-call.ts's
      // findFourthCallClaimant) — once someone RSVPs the ordinary way,
      // that's the accurate story for how the slot is filled now.
      await tx.update(rsvps)
        .set({ status: newStatus, position, respondedAt: now.getTime(), cancelledAt: null, promotedAt: null, source: "rsvp" })
        .where(eq(rsvps.id, existing.id));
    } else {
      await tx.insert(rsvps).values({ sessionId, userId, status: newStatus, position, respondedAt: now.getTime(), source: "rsvp" });
    }

    if (newStatus === "in") {
      await tx.update(users)
        .set({ rsvpInCount: sql`${users.rsvpInCount} + 1` })
        .where(eq(users.id, userId));

      if (confirmedCount + 1 === slots) {
        const confirmedRows = await tx
          .select({ userId: rsvps.userId })
          .from(rsvps)
          .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "in")));
        for (const { userId: uid } of confirmedRows) {
          await insertNotification(tx, { userId: uid, type: "game_filled", payload: { sessionId } });
        }
      }
    }

    return { ok: true, status: newStatus };
  });

  if (outcome.ok && circleId) {
    emitSessionEvent(sessionId, "rsvp", { circleId });
    emitCircleEvent(circleId, "rsvp", { sessionId });
    // §9 metric 1: rsvp_changed (state=in|reserve). `source` (feed/session_page/
    // link) from METRICS.md is a UI origin not available at this server layer,
    // so it's omitted. The actor is always an authenticated circle member
    // (guests don't self-RSVP), so is_guest is false — see metrics-manifest.md.
    captureEvent("rsvp_changed", {
      distinctId: userId,
      circleId,
      sessionId,
      timestamp: now.getTime(),
      properties: { user_id: userId, state: outcome.status, is_guest: false },
    });
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
export async function rsvpOut(db: CuatroDb, sessionId: string, userId: string, now: Date = new Date()): Promise<RsvpOutcome> {
  let circleId: string | undefined;
  // Set when a LOCKED rotation game lost a starter: promotion is consent-based
  // there (see offerRotationSlotIfNeeded), so we skip the auto-promote below
  // and kick off the offer cascade AFTER the transaction commits.
  let rotationOfferNeeded = false;

  const outcome = await db.transaction(async (tx): Promise<RsvpOutcome> => {
    // Lock the session row: the reserve auto-promotion (find reserve #1 → make
    // them 'in' → close the gap) is a read-decide-write that two simultaneous
    // dropouts would otherwise race, both promoting the SAME reserve. FOR UPDATE
    // forces the second dropout to wait, then promote reserve #2.
    const ctx = await loadSessionContext(tx, sessionId, { lock: true });
    if (!ctx) return { ok: false, error: "session_not_found" };
    const { session, standingGame } = ctx;
    circleId = session.circleId;

    if (!(await isCircleMember(tx, session.circleId, userId))) return { ok: false, error: "not_a_circle_member" };
    if (now.getTime() >= session.startsAt) return { ok: false, error: "session_started" };

    const [existing] = await tx
      .select()
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.userId, userId)));
    if (!existing || existing.status === "out") {
      return { ok: true, status: "out" };
    }

    if (existing.status === "reserve") {
      await tx.update(rsvps)
        .set({ status: "out", position: null, cancelledAt: now.getTime() })
        .where(eq(rsvps.id, existing.id));
      await closeReserveGap(tx, sessionId, existing.position ?? 0);
      return { ok: true, status: "out" };
    }

    // existing.status === "in": a confirmed dropout.
    const msToStart = session.startsAt - now.getTime();
    if (msToStart < LATE_CANCEL_WINDOW_MS) {
      await tx.update(users)
        .set({ lateCancelCount: sql`${users.lateCancelCount} + 1` })
        .where(eq(users.id, userId));
    }
    await tx.update(rsvps).set({ status: "out", position: null, cancelledAt: now.getTime() }).where(eq(rsvps.id, existing.id));

    // Rotation, post-lock: a sit-out was TOLD to sit out and may have made
    // other plans, so they get a consent OFFER (post-commit), never a silent
    // auto-promote. Non-rotation reserves opted into the queue, so they still
    // auto-promote exactly as before.
    if (standingGame?.rotationEnabled && session.rotationLockedAt && standingGame.rotationMode === "limited") {
      rotationOfferNeeded = true;
      return { ok: true, status: "out" };
    }

    const [nextReserve] = await tx
      .select()
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "reserve")))
      .orderBy(asc(rsvps.position))
      .limit(1);

    if (nextReserve) {
      await tx.update(rsvps)
        .set({ status: "in", position: null, promotedAt: now.getTime() })
        .where(eq(rsvps.id, nextReserve.id));
      await tx.update(users)
        .set({ rsvpInCount: sql`${users.rsvpInCount} + 1` })
        .where(eq(users.id, nextReserve.userId));
      await closeReserveGap(tx, sessionId, nextReserve.position ?? 0);
      await insertNotification(tx, { userId: nextReserve.userId, type: "slot_promoted", payload: { sessionId } });
      return { ok: true, status: "out", promotedUserId: nextReserve.userId };
    }

    // No reserve to promote — the slot goes empty. Let the organiser(s) know
    // (this is the signal that a Fourth Call may be needed before T-48h).
    for (const organiserId of await circleOrganiserIds(tx, session.circleId)) {
      await insertNotification(tx, { userId: organiserId, type: "dropout", payload: { sessionId, userId } });
    }
    return { ok: true, status: "out" };
  });

  // Consent offer for a locked rotation game runs its own transaction, so it
  // must fire AFTER this one commits (the dropped 'in' row must already be out).
  if (outcome.ok && rotationOfferNeeded) await offerRotationSlotIfNeeded(db, sessionId, now);

  if (outcome.ok && circleId) {
    emitSessionEvent(sessionId, "rsvp", { circleId });
    emitCircleEvent(circleId, "rsvp", { sessionId });
    // §9 metric 1: rsvp_changed (state=out). See rsvpIn's note on source/is_guest.
    captureEvent("rsvp_changed", {
      distinctId: userId,
      circleId,
      sessionId,
      timestamp: now.getTime(),
      properties: { user_id: userId, state: "out", is_guest: false },
    });
  }
  return outcome;
}

/** Shifts every reserve position greater than `vacatedPosition` down by one, closing the gap. */
async function closeReserveGap(tx: CuatroDb, sessionId: string, vacatedPosition: number): Promise<void> {
  await tx.update(rsvps)
    .set({ position: sql`${rsvps.position} - 1` })
    .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "reserve"), gt(rsvps.position, vacatedPosition)));
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
 * for this session (via the ->> operator on the payload) as the "already
 * fired" marker, so repeat views don't spam duplicate notifications.
 */
export async function checkFourthCallLevel1(
  db: CuatroDb,
  sessionId: string,
  now: Date = new Date(),
): Promise<FourthCallCheckResult> {
  let circleId: string | undefined;
  let openSlots: number | undefined;

  const result = await db.transaction(async (tx): Promise<FourthCallCheckResult> => {
    // Lock the session row: the "already fired?" idempotency check then the
    // invite insert is a read-decide-write two concurrent views could race,
    // double-firing the Fourth Call. FOR UPDATE serialises them.
    const [session] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for("update");
    if (!session || session.status !== "upcoming") return { fired: false, reason: "session_not_upcoming" };
    circleId = session.circleId;

    const msToStart = session.startsAt - now.getTime();
    if (msToStart < 0) return { fired: false, reason: "session_not_upcoming" };
    if (msToStart > FOURTH_CALL_WINDOW_MS) return { fired: false, reason: "not_yet" };

    const standingGame = session.standingGameId
      ? ((await tx.select().from(standingGames).where(eq(standingGames.id, session.standingGameId)))[0] ?? null)
      : null;
    const slots = slotsForSession(standingGame);
    const confirmed = await countConfirmed(tx, sessionId);
    if (confirmed >= slots) {
      return { fired: false, reason: "already_full" };
    }
    openSlots = slots - confirmed;

    const [alreadyFired] = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.type, "fourth_call"),
          sql`${notifications.payload} ->> 'sessionId' = ${sessionId}`,
        ),
      );
    if (alreadyFired) return { fired: false, reason: "already_notified" };

    const members = await tx
      .select({ userId: circleMembers.userId })
      .from(circleMembers)
      .where(eq(circleMembers.circleId, session.circleId));
    const respondedRows = await tx
      .select({ userId: rsvps.userId })
      .from(rsvps)
      .where(eq(rsvps.sessionId, sessionId));
    const responded = new Set(respondedRows.map((r) => r.userId));
    const targets = members.map((m) => m.userId).filter((id) => !responded.has(id));

    for (const userId of targets) {
      await insertNotification(tx, { userId, type: "fourth_call", payload: { sessionId, level: 1 } });
    }

    return { fired: true, notifiedUserIds: targets };
  });

  if (result.fired && circleId) {
    emitSessionEvent(sessionId, "fourth_call", { circleId, level: 1 });
    emitCircleEvent(circleId, "fourth_call", { sessionId, level: 1 });
    // §9 metric 3: fourth_call_fired, ring 1 (the Circle). There is no discrete
    // "call" entity in the schema, so call_id = session_id (one open call per
    // session); the metric query takes MIN(fired_at) per call_id as the call's
    // open time and slices fill-rate by ring — see metrics-manifest.md. Ring 1
    // is the automatic T-48h window; there's no acting user (SYSTEM_DISTINCT_ID).
    captureEvent("fourth_call_fired", {
      circleId,
      sessionId,
      timestamp: now.getTime(),
      properties: { call_id: sessionId, ring: 1, open_slots: openSlots, trigger: "t48h", fired_at: now.getTime() },
    });
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

/** When did ring 1's first fourth_call notification for this session go out (epoch ms)? Null if it never has. */
async function fourthCallLevel1FiredAt(db: CuatroDb, sessionId: string): Promise<number | null> {
  const [row] = await db
    .select({ createdAt: notifications.createdAt })
    .from(notifications)
    .where(
      and(
        eq(notifications.type, "fourth_call"),
        sql`${notifications.payload} ->> 'sessionId' = ${sessionId}`,
        sql`${notifications.payload} ->> 'level' = '1'`,
      ),
    )
    .orderBy(asc(notifications.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

/**
 * Has the GEO Local Ring (level 2, no `via`) already fired for this session?
 * Its notification is the idempotency marker. Deliberately excludes the
 * played-with ring's notifications — those also carry level 2 but a
 * `via: "played_with"` tag (`->>` on a missing key is NULL, so the geo
 * ring's own invites are `$.via IS NULL`). Without this the played-with ring
 * firing first would wrongly mark the geo ring as already-done.
 */
async function fourthCallLevel2AlreadyFired(db: CuatroDb, sessionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.type, "fourth_call"),
        sql`${notifications.payload} ->> 'sessionId' = ${sessionId}`,
        sql`${notifications.payload} ->> 'level' = '2'`,
        sql`${notifications.payload} ->> 'via' IS NULL`,
      ),
    );
  return !!row;
}

/** When did the played-with ring (via="played_with") first fire for this session (epoch ms)? Null if it never has — used to order the geo ring strictly after it. */
async function fourthCallPlayedWithFiredAt(db: CuatroDb, sessionId: string): Promise<number | null> {
  const [row] = await db
    .select({ createdAt: notifications.createdAt })
    .from(notifications)
    .where(
      and(
        eq(notifications.type, "fourth_call"),
        sql`${notifications.payload} ->> 'sessionId' = ${sessionId}`,
        sql`${notifications.payload} ->> 'via' = 'played_with'`,
      ),
    )
    .orderBy(asc(notifications.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

/** Everyone already invited through the played-with ring for this session — the page reads this for its "sent to N" count and per-person invited state. */
export async function playedWithInvitedUserIds(db: CuatroDb, sessionId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: notifications.userId })
    .from(notifications)
    .where(
      and(
        eq(notifications.type, "fourth_call"),
        sql`${notifications.payload} ->> 'sessionId' = ${sessionId}`,
        sql`${notifications.payload} ->> 'via' = 'played_with'`,
      ),
    );
  return rows.map((r) => r.userId);
}

/** Everyone already sent a fourth_call notification (any level) for this session — the never-nag-twice set. */
async function fourthCallNotifiedUserIds(db: CuatroDb, sessionId: string): Promise<Set<string>> {
  const rows = await db
    .select({ userId: notifications.userId })
    .from(notifications)
    .where(
      and(
        eq(notifications.type, "fourth_call"),
        sql`${notifications.payload} ->> 'sessionId' = ${sessionId}`,
      ),
    );
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
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session || session.status !== "upcoming" || now.getTime() >= session.startsAt) {
    return { fired: false, reason: "session_not_upcoming" };
  }

  const standingGame = session.standingGameId
    ? ((await db.select().from(standingGames).where(eq(standingGames.id, session.standingGameId)))[0] ?? null)
    : null;
  if ((await countConfirmed(db, sessionId)) >= slotsForSession(standingGame)) {
    return { fired: false, reason: "already_full" };
  }

  if (await fourthCallLevel2AlreadyFired(db, sessionId)) {
    return { fired: false, reason: "already_notified" };
  }

  if (!options.forceEscalate) {
    // Ladder: the played-with ring (checkFourthCallPlayedWith) gets first
    // refusal. If it has fired, the geo ring waits its grace window before
    // widening to the map. Only if played-with never fired (no verified-match
    // connections to reach) does the geo ring fall back to ring 1's grace
    // window, as before. This relies on the send page running played-with
    // before this on the same view (see the fourth-call page component);
    // the organiser's manual "Reach nearby players" bypasses it via forceEscalate.
    const gateFrom = (await fourthCallPlayedWithFiredAt(db, sessionId)) ?? (await fourthCallLevel1FiredAt(db, sessionId));
    if (!gateFrom || now.getTime() - gateFrom < FOURTH_CALL_LOCAL_RING_DELAY_MS) {
      return { fired: false, reason: "not_yet" };
    }
  }

  const alreadyNotified = await fourthCallNotifiedUserIds(db, sessionId);
  const candidates = await localRingCandidates(db, sessionId, {
    limit: LOCAL_RING_FANOUT_CAP,
    excludeUserIds: [...alreadyNotified],
  });
  if (candidates.length === 0) return { fired: false, reason: "no_candidates" };

  // --- Phase B: transaction — re-validate under a session lock + write invites -
  let circleId: string | undefined;
  let openSlots: number | undefined;
  const result = await db.transaction(async (tx): Promise<FourthCallLocalRingResult> => {
    const [s] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for("update");
    if (!s || s.status !== "upcoming" || now.getTime() >= s.startsAt) {
      return { fired: false, reason: "session_not_upcoming" };
    }
    circleId = s.circleId;

    const sg = s.standingGameId
      ? ((await tx.select().from(standingGames).where(eq(standingGames.id, s.standingGameId)))[0] ?? null)
      : null;
    const slots = slotsForSession(sg);
    const confirmed = await countConfirmed(tx, sessionId);
    if (confirmed >= slots) {
      return { fired: false, reason: "already_full" };
    }
    openSlots = slots - confirmed;
    if (await fourthCallLevel2AlreadyFired(tx, sessionId)) {
      return { fired: false, reason: "already_notified" };
    }

    // Re-read the notified set inside the transaction so a concurrent
    // escalation can't cause a double-invite (never nag twice).
    const notifiedNow = await fourthCallNotifiedUserIds(tx, sessionId);
    const chosen = candidates.filter((c) => !notifiedNow.has(c.userId));
    if (chosen.length === 0) return { fired: false, reason: "no_candidates" };

    for (const c of chosen) {
      await insertNotification(tx, { userId: c.userId, type: "fourth_call", payload: { sessionId, level: 2 } });
    }
    return { fired: true, notifiedUserIds: chosen.map((c) => c.userId) };
  });

  // --- Phase C: realtime AFTER commit (never inside the transaction) --------
  if (result.fired && circleId) {
    emitSessionEvent(sessionId, "fourth_call", { circleId, level: 2 });
    emitCircleEvent(circleId, "fourth_call", { sessionId, level: 2 });
    // §9 metric 3: fourth_call_fired, ring 2 (the geo Local Ring). See ring 1's
    // note on call_id = session_id. `via: "local_ring"` distinguishes this from
    // the played-with ring, which also fires at level 2.
    captureEvent("fourth_call_fired", {
      circleId,
      sessionId,
      timestamp: now.getTime(),
      properties: {
        call_id: sessionId,
        ring: 2,
        via: "local_ring",
        open_slots: openSlots,
        trigger: options.forceEscalate ? "manual" : "t48h",
        fired_at: now.getTime(),
      },
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Fourth Call — ring 2a (THE PLAYED-WITH RING): people you've shared a
// verified match with, from any circle. Sits between ring 1 (this circle) and
// ring 2b (the geo Local Ring) in the escalation ladder — connection before
// proximity, per Pete's brief. The "who have you played with" query is
// server/played-with.ts; this is the escalation around it, the same
// async-candidates-then-synchronous-transaction shape as the geo ring, with a
// `via: "played_with"` tag on the fourth_call notification so notify.ts renders
// "A four you know needs a player" and the geo ring's level-2 marker stays
// distinct from these. A played-with invitee need not be a circle member, so
// they claim through fourth-call.ts's claimFourthCallSlot, not rsvpIn.
// ---------------------------------------------------------------------------

export type FourthCallPlayedWithResult =
  | {
      fired: false;
      reason: "not_yet" | "already_full" | "already_notified" | "session_not_upcoming" | "no_candidates";
    }
  | { fired: true; notifiedUserIds: string[] };

export interface FourthCallPlayedWithOptions {
  /** Organiser tapped an invite (Invite all, or an individual Invite) — skips the 20-minutes-after-ring-1 wait. */
  forceEscalate?: boolean;
  /** Restrict the invite to specific candidates — the send screen's per-person "Invite" buttons pass one id. Omitted = every eligible played-with candidate ("Invite all" / the auto path). */
  onlyUserIds?: string[];
}

/**
 * Escalate a short game to the played-with ring — people from the confirmed
 * four's verified match history (any circle) get a level-2 `via:"played_with"`
 * fourth_call notification, which is both the nudge and the claim grant (see
 * fourth-call.ts's hasFourthCallInvite/claimFourthCallSlot).
 *
 * Timing tier: the SAME as the geo ring (opens 20 minutes after ring 1's
 * first-refusal window) but ordered BEFORE it in the ladder — the geo ring
 * additionally waits until this has fired (see checkFourthCallLocalRing).
 * Fires lazily on view once that window elapses, or immediately when the
 * organiser taps an invite (`forceEscalate`).
 *
 * There is no blanket "already fired" gate here (unlike the geo ring): the
 * never-nag-twice invariant is enforced strictly per person via the shared
 * fourth_call notified set, which is what lets the organiser hand-pick
 * candidates one at a time (`onlyUserIds`) without a first invite locking out
 * the rest. `reason: "already_notified"` means everyone reachable has already
 * been invited; `"no_candidates"` means there's genuinely no shared history.
 *
 * ASYNC, like the geo ring: playedWithCandidates does reads better-sqlite3
 * can't do inside a synchronous transaction, so the candidate list is computed
 * first (outside any transaction), then a single synchronous transaction
 * re-validates and inserts, and realtime emits only after it commits.
 */
export async function checkFourthCallPlayedWith(
  db: CuatroDb,
  sessionId: string,
  now: Date = new Date(),
  options: FourthCallPlayedWithOptions = {},
): Promise<FourthCallPlayedWithResult> {
  // --- Phase A: async gates + candidate computation (no transaction) --------
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session || session.status !== "upcoming" || now.getTime() >= session.startsAt) {
    return { fired: false, reason: "session_not_upcoming" };
  }

  const standingGame = session.standingGameId
    ? ((await db.select().from(standingGames).where(eq(standingGames.id, session.standingGameId)))[0] ?? null)
    : null;
  if ((await countConfirmed(db, sessionId)) >= slotsForSession(standingGame)) {
    return { fired: false, reason: "already_full" };
  }

  if (!options.forceEscalate) {
    const firedAt = await fourthCallLevel1FiredAt(db, sessionId);
    if (!firedAt || now.getTime() - firedAt < FOURTH_CALL_LOCAL_RING_DELAY_MS) {
      return { fired: false, reason: "not_yet" };
    }
  }

  const alreadyNotified = await fourthCallNotifiedUserIds(db, sessionId);
  let candidates = await playedWithCandidates(db, sessionId, {
    limit: PLAYED_WITH_FANOUT_CAP,
    excludeUserIds: [...alreadyNotified],
    now,
  });
  if (options.onlyUserIds) {
    const only = new Set(options.onlyUserIds);
    candidates = candidates.filter((c) => only.has(c.userId));
  }
  if (candidates.length === 0) {
    // Distinguish "everyone reachable is already invited" from "no shared
    // history at all" so the send screen can say the right thing. The universe
    // query drops the never-nag-twice exclusion (but keeps onlyUserIds) —
    // if it's non-empty, the reason we found nobody is that they're all invited.
    let universe = await playedWithCandidates(db, sessionId, { limit: PLAYED_WITH_FANOUT_CAP, now });
    if (options.onlyUserIds) {
      const only = new Set(options.onlyUserIds);
      universe = universe.filter((c) => only.has(c.userId));
    }
    return { fired: false, reason: universe.length > 0 ? "already_notified" : "no_candidates" };
  }

  // --- Phase B: transaction — re-validate under a session lock + write invites -
  let circleId: string | undefined;
  let openSlots: number | undefined;
  const result = await db.transaction(async (tx): Promise<FourthCallPlayedWithResult> => {
    const [s] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for("update");
    if (!s || s.status !== "upcoming" || now.getTime() >= s.startsAt) {
      return { fired: false, reason: "session_not_upcoming" };
    }
    circleId = s.circleId;

    const sg = s.standingGameId
      ? ((await tx.select().from(standingGames).where(eq(standingGames.id, s.standingGameId)))[0] ?? null)
      : null;
    const slots = slotsForSession(sg);
    const confirmed = await countConfirmed(tx, sessionId);
    if (confirmed >= slots) {
      return { fired: false, reason: "already_full" };
    }
    openSlots = slots - confirmed;

    // Re-read the notified set inside the transaction so a concurrent
    // escalation can't cause a double-invite (never nag twice, per person).
    const notifiedNow = await fourthCallNotifiedUserIds(tx, sessionId);
    const chosen = candidates.filter((c) => !notifiedNow.has(c.userId));
    if (chosen.length === 0) return { fired: false, reason: "already_notified" };

    for (const c of chosen) {
      await insertNotification(tx, {
        userId: c.userId,
        type: "fourth_call",
        payload: { sessionId, level: 2, via: "played_with" },
      });
    }
    return { fired: true, notifiedUserIds: chosen.map((c) => c.userId) };
  });

  // --- Phase C: realtime AFTER commit (never inside the transaction) --------
  if (result.fired && circleId) {
    emitSessionEvent(sessionId, "fourth_call", { circleId, level: 2, via: "played_with" });
    emitCircleEvent(circleId, "fourth_call", { sessionId, level: 2, via: "played_with" });
    // §9 metric 3: fourth_call_fired, ring 2 (the played-with ring). Same
    // call_id = session_id convention; `via: "played_with"` distinguishes it
    // from the geo Local Ring (also level 2).
    captureEvent("fourth_call_fired", {
      circleId,
      sessionId,
      timestamp: now.getTime(),
      properties: {
        call_id: sessionId,
        ring: 2,
        via: "played_with",
        open_slots: openSlots,
        trigger: options.forceEscalate ? "manual" : "t48h",
        fired_at: now.getTime(),
      },
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// THE ROTATION — availability RSVP + lazy T-24h lock (no cron in v0)
//
// When a Standing Game has rotationEnabled, the weekly RSVP is a declaration
// of availability ('available' status) rather than a slot grab. The four who
// play are chosen by server/rotation.ts's pure fairness function from this
// game's recent play history, shown live as a "provisional four", and locked
// on the first view at/after T-24h — the same lazy-on-view pattern as the
// Fourth Call. At lock the selected become 'in' and the rest become 'reserve'
// (the sit-out list, in rotation order) so the ordinary auto-promotion in
// rsvpOut carries them forward if someone drops. Selection is pure and
// explainable; this layer just gathers inputs and writes the outcome.
// ---------------------------------------------------------------------------

/**
 * This Standing Game's recent play history — one entry per past occurrence
 * (strictly earlier than `beforeStartsAt`), newest-first is not required
 * (computeRotation sorts). "Who played" is the verified match roster when a
 * match was recorded (CLAUDE.md rule 13: matches record who PLAYED), else who
 * was 'in'. Capped at the window the fairness math actually reads, so an
 * ancient game doesn't drag in unbounded rows.
 */
async function loadRotationHistory(tx: CuatroDb, standingGameId: string, beforeStartsAt: number): Promise<RotationPastSession[]> {
  const pastSessions = await tx
    .select({ id: sessions.id, startsAt: sessions.startsAt })
    .from(sessions)
    .where(and(eq(sessions.standingGameId, standingGameId), lt(sessions.startsAt, beforeStartsAt)))
    .orderBy(sql`${sessions.startsAt} desc`)
    .limit(ROTATION_RECENT_WINDOW);
  if (pastSessions.length === 0) return [];

  const ids = pastSessions.map((s) => s.id);

  // Verified match rosters keyed by session (the source of truth for "played").
  const matchRows = await tx
    .select({
      sessionId: matches.sessionId,
      a1: matches.teamAPlayer1Id,
      a2: matches.teamAPlayer2Id,
      b1: matches.teamBPlayer1Id,
      b2: matches.teamBPlayer2Id,
    })
    .from(matches)
    .where(and(inArray(matches.sessionId, ids), eq(matches.status, "verified")));
  const rosterBySession = new Map<string, string[]>();
  for (const m of matchRows) {
    const existing = rosterBySession.get(m.sessionId) ?? [];
    rosterBySession.set(m.sessionId, [...existing, m.a1, m.a2, m.b1, m.b2]);
  }

  // Fallback: who was 'in' (selected to play) where no match was recorded.
  const inRows = await tx
    .select({ sessionId: rsvps.sessionId, userId: rsvps.userId })
    .from(rsvps)
    .where(and(inArray(rsvps.sessionId, ids), eq(rsvps.status, "in")));
  const inBySession = new Map<string, string[]>();
  for (const r of inRows) {
    const existing = inBySession.get(r.sessionId) ?? [];
    inBySession.set(r.sessionId, [...existing, r.userId]);
  }

  return pastSessions.map((s) => ({
    startsAt: s.startsAt,
    playedUserIds: rosterBySession.get(s.id) ?? inBySession.get(s.id) ?? [],
  }));
}

/**
 * Available RSVPs for a session as rotation candidates, ordered by reply time.
 * userId is the secondary sort so simultaneous replies (identical respondedAt)
 * still produce a stable, deterministic availabilityOrder — determinism is the
 * whole promise of the feature, so ties can never be resolved by DB row order.
 */
async function rotationCandidates(tx: CuatroDb, sessionId: string): Promise<RotationCandidate[]> {
  const rows = await tx
    .select({ userId: rsvps.userId, respondedAt: rsvps.respondedAt })
    .from(rsvps)
    .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "available")))
    .orderBy(asc(rsvps.respondedAt), asc(rsvps.userId));
  return rows.map((r, i) => ({ userId: r.userId, availabilityOrder: i }));
}

export type RotationRsvpOutcome =
  | { ok: true; status: "available" | "out" }
  | {
      ok: false;
      error:
        | "session_not_found"
        | "not_a_circle_member"
        | "window_not_open"
        | "session_started"
        | "rotation_not_enabled"
        | "rotation_locked";
    };

/**
 * THE ROTATION's "I'm available" tap. Pre-lock (and always, in unlimited mode)
 * it records the member as available (status 'available') — it holds no slot;
 * the lineup is decided at/by the cutoff. Idempotent. Rejected outside the RSVP
 * window, once the session has started, or if the game isn't a rotation game.
 *
 * LATE FILL: once a limited game has LOCKED, a fresh "I'm available" is someone
 * volunteering after the cutoff. They proactively opted in (no consent offer
 * needed), so this delegates to rsvpIn — they take an open slot directly, or
 * join the sit-out queue if the four is already full — filling remaining spots
 * "by the next player in" as the brief requires.
 */
export async function markAvailable(
  db: CuatroDb,
  sessionId: string,
  userId: string,
  now: Date = new Date(),
): Promise<RotationRsvpOutcome | RsvpOutcome> {
  // Post-lock late fill: read the lock state first (outside the txn), then hand
  // off to rsvpIn (which opens its own transaction).
  const locked = await loadSessionContext(db, sessionId);
  if (locked?.standingGame?.rotationEnabled && locked.session.rotationLockedAt && locked.standingGame.rotationMode === "limited") {
    return rsvpIn(db, sessionId, userId, now);
  }

  let circleId: string | undefined;
  const outcome = await db.transaction(async (tx): Promise<RotationRsvpOutcome> => {
    // Lock the session row: 'available' upsert is gated on rotationLockedAt being
    // null, a read-decide-write that must not race the lazy lock (lockRotationIfDue).
    const ctx = await loadSessionContext(tx, sessionId, { lock: true });
    if (!ctx) return { ok: false, error: "session_not_found" };
    const { session, standingGame } = ctx;
    circleId = session.circleId;

    if (!standingGame?.rotationEnabled) return { ok: false, error: "rotation_not_enabled" };
    if (session.rotationLockedAt) return { ok: false, error: "rotation_locked" };
    if (!(await isCircleMember(tx, session.circleId, userId))) return { ok: false, error: "not_a_circle_member" };
    if (now.getTime() >= session.startsAt) return { ok: false, error: "session_started" };

    const windowOpensAt = session.startsAt - rsvpWindowDaysFor(standingGame) * DAY_MS;
    if (now.getTime() < windowOpensAt) return { ok: false, error: "window_not_open" };

    const [existing] = await tx
      .select()
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.userId, userId)));
    if (existing && existing.status === "available") return { ok: true, status: "available" };

    if (existing) {
      await tx.update(rsvps)
        .set({ status: "available", position: null, respondedAt: now.getTime(), cancelledAt: null, promotedAt: null, source: "rsvp" })
        .where(eq(rsvps.id, existing.id));
    } else {
      await tx.insert(rsvps).values({ sessionId, userId, status: "available", respondedAt: now.getTime(), source: "rsvp" });
    }
    return { ok: true, status: "available" };
  });

  if (outcome.ok && circleId) {
    emitSessionEvent(sessionId, "rsvp", { circleId });
    emitCircleEvent(circleId, "rsvp", { sessionId });
  }
  return outcome;
}

/**
 * THE ROTATION's "not this week" tap, pre-lock: drops the member out of the
 * availability pool (status 'out'). Post-lock the game behaves like any other
 * (a locked-in player who drops goes through rsvpOut, which auto-promotes the
 * first sit-out), so this is rejected once locked.
 */
export async function markUnavailable(db: CuatroDb, sessionId: string, userId: string, now: Date = new Date()): Promise<RotationRsvpOutcome> {
  let circleId: string | undefined;
  const outcome = await db.transaction(async (tx): Promise<RotationRsvpOutcome> => {
    // Lock the session row: gated on rotationLockedAt null (read-decide-write vs
    // the lazy lock).
    const ctx = await loadSessionContext(tx, sessionId, { lock: true });
    if (!ctx) return { ok: false, error: "session_not_found" };
    const { session, standingGame } = ctx;
    circleId = session.circleId;

    if (!standingGame?.rotationEnabled) return { ok: false, error: "rotation_not_enabled" };
    if (session.rotationLockedAt) return { ok: false, error: "rotation_locked" };
    if (!(await isCircleMember(tx, session.circleId, userId))) return { ok: false, error: "not_a_circle_member" };
    if (now.getTime() >= session.startsAt) return { ok: false, error: "session_started" };

    const [existing] = await tx
      .select()
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.userId, userId)));
    if (!existing || existing.status === "out") return { ok: true, status: "out" };

    await tx.update(rsvps).set({ status: "out", position: null, cancelledAt: now.getTime() }).where(eq(rsvps.id, existing.id));
    return { ok: true, status: "out" };
  });

  if (outcome.ok && circleId) {
    emitSessionEvent(sessionId, "rsvp", { circleId });
    emitCircleEvent(circleId, "rsvp", { sessionId });
  }
  return outcome;
}

export type RotationLockResult =
  | { locked: false; reason: "not_rotation" | "unlimited_no_lock" | "already_locked" | "not_yet" | "session_not_upcoming" }
  | { locked: true; inUserIds: string[]; sittingUserIds: string[] };

/**
 * Lazily lock a LIMITED-mode rotation game's four at/after its cutoff, on view
 * — the same no-cron pattern as checkFourthCallLevel1. Idempotent:
 * rotationLockedAt being set is the "already done" marker, so repeat views are
 * no-ops. Selects with the pure fairness function, writes the selected as 'in'
 * and the rest as 'reserve' (the sit-out list, in rotation order), stamps the
 * lock time, and notifies each player. Realtime emits AFTER commit.
 *
 * UNLIMITED mode never locks: the provisional four re-ranks live to kickoff, so
 * this is a no-op (`unlimited_no_lock`). Fewer available than slots: everyone
 * available is 'in', no sit-out list, and the Fourth Call fills the gap.
 */
export async function lockRotationIfDue(db: CuatroDb, sessionId: string, now: Date = new Date()): Promise<RotationLockResult> {
  let circleId: string | undefined;
  const result = await db.transaction(async (tx): Promise<RotationLockResult> => {
    // Lock the session row: rotationLockedAt is the idempotency marker (checked
    // then stamped), a read-decide-write two concurrent views could otherwise
    // race, locking the same session twice / double-incrementing rsvpInCount.
    const [session] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for("update");
    if (!session || session.status !== "upcoming") return { locked: false, reason: "session_not_upcoming" };
    if (session.rotationLockedAt) return { locked: false, reason: "already_locked" };
    circleId = session.circleId;

    const standingGame = session.standingGameId
      ? ((await tx.select().from(standingGames).where(eq(standingGames.id, session.standingGameId)))[0] ?? null)
      : null;
    if (!standingGame?.rotationEnabled) return { locked: false, reason: "not_rotation" };
    // Unlimited never resolves to a lock — the ranking stays live to kickoff.
    if (standingGame.rotationMode === "unlimited") return { locked: false, reason: "unlimited_no_lock" };

    const msToStart = session.startsAt - now.getTime();
    if (msToStart < 0) return { locked: false, reason: "session_not_upcoming" };
    if (msToStart > rotationCutoffMs(standingGame)) return { locked: false, reason: "not_yet" };

    const slots = slotsForSession(standingGame);
    const selection = computeRotation(
      await rotationCandidates(tx, sessionId),
      await loadRotationHistory(tx, standingGame.id, session.startsAt),
      slots,
    );

    for (const userId of selection.inUserIds) {
      await tx.update(rsvps)
        .set({ status: "in", position: null, promotedAt: now.getTime() })
        .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.userId, userId)));
      await tx.update(users)
        .set({ rsvpInCount: sql`${users.rsvpInCount} + 1` })
        .where(eq(users.id, userId));
    }
    for (const [i, userId] of selection.sittingUserIds.entries()) {
      await tx.update(rsvps)
        .set({ status: "reserve", position: i + 1, promotedAt: null })
        .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.userId, userId)));
    }

    await tx.update(sessions).set({ rotationLockedAt: now.getTime() }).where(eq(sessions.id, sessionId));

    // Notifications last in the transaction (see notify.ts's push-after-commit note).
    for (const userId of selection.inUserIds) await notifyRotationSelected(tx, userId, sessionId);
    for (const userId of selection.sittingUserIds) await notifyRotationSittingOut(tx, userId, sessionId);

    return { locked: true, inUserIds: selection.inUserIds, sittingUserIds: selection.sittingUserIds };
  });

  if (result.locked && circleId) {
    // The lock rewrote every RSVP row for this session (available -> in/reserve);
    // "rsvp" is the honest refetch signal and is what SessionCard/the hero
    // already re-render on, so the locked lineup appears live.
    emitSessionEvent(sessionId, "rsvp", { circleId });
    emitCircleEvent(circleId, "rsvp", { sessionId });
  }
  return result;
}

// ---------------------------------------------------------------------------
// THE ROTATION — consent-based post-lock promotion (the sit-out OFFER)
//
// A locked-in player who drops does NOT silently promote the next sit-out: a
// benched player was told to sit out and may have made plans, so they get a
// first-refusal OFFER instead. The offer reuses the Fourth Call machinery
// wholesale — it's a `fourth_call` notification (tagged `via:"rotation_offer"`)
// so the invitee already gets the takeover screen and claims through
// claimFourthCallSlot, and "Pass" on that screen just marks it read. This
// module only decides WHO holds the offer and when it advances; accept/decline
// are the Fourth Call's existing surfaces.
//
// Advancement is lazy-on-view (no cron): an offer that's been read (passed) or
// is older than the window is "spent", so the next view offers the next
// sit-out in rotation order. When every sit-out has had first refusal, the
// ordinary Fourth Call takes over (checkFourthCallLevel1, gated on this).
// ---------------------------------------------------------------------------

/** How long a sit-out holds first refusal on an opened spot before the offer lazily moves on. */
export const ROTATION_OFFER_WINDOW_MS = 90 * 60 * 1000;

type RotationOfferResult =
  | { state: "not_applicable" } // not a locked limited rotation game, or already full
  | { state: "waiting"; userId: string } // an offer is live with a sit-out right now
  | { state: "offered"; userId: string } // just handed the offer to the next sit-out
  | { state: "exhausted" }; // every sit-out has had first refusal — Fourth Call may proceed

/** fourth_call notifications tagged as rotation offers for this session, newest first. Timestamps are epoch ms. */
async function rotationOfferNotifs(tx: CuatroDb, sessionId: string): Promise<{ userId: string; createdAt: number; readAt: number | null }[]> {
  return tx
    .select({ userId: notifications.userId, createdAt: notifications.createdAt, readAt: notifications.readAt })
    .from(notifications)
    .where(
      and(
        eq(notifications.type, "fourth_call"),
        sql`${notifications.payload} ->> 'sessionId' = ${sessionId}`,
        sql`${notifications.payload} ->> 'via' = 'rotation_offer'`,
      ),
    )
    .orderBy(sql`${notifications.createdAt} desc`);
}

/**
 * Offer an opened spot in a locked rotation game to the next sit-out in
 * rotation order, or confirm the current offer still stands. Idempotent and
 * safe to call on every view. Returns what it did so the caller can decide
 * whether the ordinary Fourth Call should also run (only once `exhausted`).
 */
export async function offerRotationSlotIfNeeded(db: CuatroDb, sessionId: string, now: Date = new Date()): Promise<RotationOfferResult> {
  let circleId: string | undefined;
  let offeredUserId: string | undefined;

  const result = await db.transaction(async (tx): Promise<RotationOfferResult> => {
    // Lock the session row: advancing the offer (is one live? if not, insert the
    // next sit-out's offer) is a read-decide-write two concurrent views must not
    // race, or the same opened spot gets offered to two sit-outs at once.
    const [session] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for("update");
    if (!session || session.status !== "upcoming" || now.getTime() >= session.startsAt) {
      return { state: "not_applicable" };
    }
    circleId = session.circleId;
    const standingGame = session.standingGameId
      ? ((await tx.select().from(standingGames).where(eq(standingGames.id, session.standingGameId)))[0] ?? null)
      : null;
    if (!standingGame?.rotationEnabled || standingGame.rotationMode !== "limited" || !session.rotationLockedAt) {
      return { state: "not_applicable" };
    }
    if ((await countConfirmed(tx, sessionId)) >= slotsForSession(standingGame)) return { state: "not_applicable" };

    const offers = await rotationOfferNotifs(tx, sessionId);
    const offeredUserIds = new Set(offers.map((o) => o.userId));

    // Is an offer still live? Held by a current sit-out ('reserve'), unread, and
    // inside the window. A read (passed) or aged-out offer is spent → advance.
    const reserves = await tx
      .select({ userId: rsvps.userId, position: rsvps.position })
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "reserve")))
      .orderBy(asc(rsvps.position));
    const reserveIds = new Set(reserves.map((r) => r.userId));

    const liveOffer = offers.find(
      (o) => reserveIds.has(o.userId) && o.readAt == null && now.getTime() - o.createdAt < ROTATION_OFFER_WINDOW_MS,
    );
    if (liveOffer) return { state: "waiting", userId: liveOffer.userId };

    // Advance: the next sit-out (lowest position) who hasn't had first refusal.
    const next = reserves.find((r) => !offeredUserIds.has(r.userId));
    if (!next) return { state: "exhausted" };

    // A fourth_call notification IS the claim grant (hasFourthCallInvite) + the
    // takeover surface. Tagged via:"rotation_offer" so this cascade can find and
    // order its own offers. Inserted directly (not through insertNotification,
    // whose typed payload doesn't carry this tag); the fourth_call render path
    // shows the honest "your circle needs a fourth" copy.
    await tx.insert(notifications)
      // createdAt is set explicitly to `now` (not the column default) because the
      // offer window is measured from it — the caller's clock is the source of truth.
      .values({ userId: next.userId, type: "fourth_call", payload: { sessionId, level: 1, via: "rotation_offer" }, createdAt: now.getTime() });
    offeredUserId = next.userId;
    return { state: "offered", userId: next.userId };
  });

  if (result.state === "offered" && circleId && offeredUserId) {
    emitUserEvent(offeredUserId, "notification", { notificationType: "fourth_call" });
    emitSessionEvent(sessionId, "rsvp", { circleId });
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
export async function ensureSessionPlayedTransition(db: CuatroDb, sessionId: string, now: Date = new Date()): Promise<Session | null> {
  return db.transaction(async (tx) => {
    // Lock the session row: the status check then flip is a read-decide-write;
    // FOR UPDATE keeps two concurrent viewers from both flipping (idempotent, but
    // avoids a redundant double-write) and orders it against RSVP mutations.
    const [session] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for("update");
    if (!session || session.status !== "upcoming") return session ?? null;

    const standingGame = session.standingGameId
      ? ((await tx.select().from(standingGames).where(eq(standingGames.id, session.standingGameId)))[0] ?? null)
      : null;
    const endsAt = session.startsAt + durationMinutesFor(standingGame) * 60_000;
    if (now.getTime() < endsAt) return session;

    const [updated] = await tx.update(sessions).set({ status: "played" }).where(eq(sessions.id, sessionId)).returning();
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Read models for the UI
// ---------------------------------------------------------------------------

export type PlayerRef = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /** Public Glass rating; null while unrated (users.rating stays NULL until the Placement Trio verifies). */
  rating: number | null;
  /** Guests have no profile to link to — surfaces render them unlinked but still named. */
  isGuest: boolean;
};

/** Per-player rotation explainer for the UI (mirrors rotation.ts's RotationReason). */
export type RotationReasonView = RotationReason;

/**
 * THE ROTATION view for a session, present only when the Standing Game has
 * rotationEnabled. Pre-lock, `lineup`/`sitting` are the LIVE provisional split
 * derived from availability (nobody is committed — `confirmed`/`reserves` on
 * the summary stay empty). Post-lock, they mirror the real 'in'/'reserve' rows
 * and `lockedAt` is set. `reasons` explains every available player's standing.
 */
export type SessionRotationView = {
  /** 'limited' locks at the cutoff; 'unlimited' never locks (re-ranks to kickoff). */
  mode: "limited" | "unlimited";
  lockedAt: Date | null;
  /** Instant the provisional four locks (startsAt − cutoff). Unlimited never reaches it. */
  locksAt: Date;
  /** No played history yet — selection is arrival order, reasons say "first to tap in". */
  coldStart: boolean;
  /** Everyone who said they're available this week. */
  available: PlayerRef[];
  /** The four who play — provisional pre-lock, locked-in post-lock. */
  lineup: PlayerRef[];
  /** Sitting out this week, in the order they'd be offered the spot if someone drops. */
  sitting: PlayerRef[];
  reasons: Record<string, RotationReasonView>;
  /** Did the viewer mark themselves available? */
  viewerAvailable: boolean;
};

export type SessionSummary = {
  session: Session;
  standingGame: StandingGame | null;
  venue: Venue | null;
  circleId: string;
  circleName: string;
  /** The Circle's explicitly-chosen colour (a palette hex) / emblem; null when the organiser hasn't set one (UI falls back to the deterministic seed colour + name initials). */
  circleColour: string | null;
  circleEmblem: string | null;
  slots: number;
  confirmed: PlayerRef[];
  reserves: PlayerRef[]; // ordered by position
  // Narrow to the committed states so every SessionCardData builder stays typed
  // as before; a rotation game's pre-lock 'available' surfaces via
  // `rotation.viewerAvailable`, not here (an available player holds no slot).
  viewerStatus: "in" | "reserve" | "out" | null;
  /** Present iff the Standing Game has rotationEnabled; null for plain first-come games. */
  rotation: SessionRotationView | null;
  rsvpWindowOpensAt: Date;
  /** null when the standing game's organiser hasn't set a court cost yet (design/DESIGN-AUDIT.md F4) — a one-off session (no standing game) never has one, matching the schema (cost lives on standing_games only). Also null when a "Booked on" signpost resolves for this session (issue #21): a booked-on game never touches the Tab, so no cost/split chrome may render — derived from `moneyOptIn`, the single rule. */
  costMinor: number | null;
  costCurrency: string;
  /** floor(cost / slots), remainder absorbed by whoever ends up paying — same rule as server/tab.ts's computeEqualSplit, reused here for display before any Tab split exists. */
  costPerHeadMinor: number | null;
  /** The game's resolved money opt-in (issue #21): a "Booked on" signpost XOR a court cost, or null (the default silence). Session booking override > standing-game booking > standing-game cost — the one pure rule in lib/booking.ts resolveMoneyOptIn. Consumers render booking chips / split previews from THIS, so the mutual exclusivity holds everywhere by construction. */
  moneyOptIn: MoneyOptIn;
  /** Fourth Call side hint (issue #21, organiser-set via server/fourth-call.ts): "ideally a left-sider" flavour on call cards. A HINT ONLY — it never filters who sees or can claim a call. 'right' = drive, 'left' = backhand. */
  fourthCallSideHint: "left" | "right" | null;
  /** The session's effective IANA timezone — venue's, else the Circle's (server/week.ts precedent). EVERY render of this session's startsAt must pass this to lib/time.ts's formatters; a bare toLocaleString renders raw UTC on the Fly runtime (the QA4/7/8 hour-early class). */
  timezone: string;
};

/** "£32 court, 4 slots" -> £8 each, floor + payer-absorbs-remainder, reusing tab.ts's computeEqualSplit (design/DESIGN-AUDIT.md F4). Null when there's no cost, or fewer than 2 slots (nothing to split). */
export function computeSessionCostPerHead(costMinor: number | null, slots: number): number | null {
  if (costMinor == null || slots < 2) return null;
  return computeEqualSplit(costMinor, slots - 1).shareMinor;
}

export async function getSessionSummary(
  db: CuatroDb,
  sessionId: string,
  viewerUserId: string,
  now: Date = new Date(),
): Promise<SessionSummary | null> {
  const session = await ensureSessionPlayedTransition(db, sessionId, now);
  if (!session) return null;

  const standingGame = session.standingGameId
    ? ((await db.select().from(standingGames).where(eq(standingGames.id, session.standingGameId)))[0] ?? null)
    : null;
  const venue = session.venueId ? ((await db.select().from(venues).where(eq(venues.id, session.venueId)))[0] ?? null) : null;
  const [circle] = await db.select().from(circles).where(eq(circles.id, session.circleId));

  const rows = await db
    .select({
      status: rsvps.status,
      position: rsvps.position,
      respondedAt: rsvps.respondedAt,
      userId: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      rating: users.rating,
      isGuest: users.isGuest,
    })
    .from(rsvps)
    .innerJoin(users, eq(rsvps.userId, users.id))
    .where(eq(rsvps.sessionId, sessionId));

  // Confirmed slots fill (and must keep displaying) in RSVP order — see
  // design/HANDOFF.md's "slots fill in order" — but rsvpIn() never assigns
  // an "in" row a `position` (only the reserve queue tracks one), so this
  // must sort by `respondedAt` rather than rely on the row's DB order.
  const confirmed = rows
    .filter((r) => r.status === "in")
    .sort((a, b) => (a.respondedAt ?? 0) - (b.respondedAt ?? 0))
    .map(toPlayerRef);
  const reserves = rows
    .filter((r) => r.status === "reserve")
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(toPlayerRef);
  const viewerRow = rows.find((r) => r.userId === viewerUserId);
  const slots = slotsForSession(standingGame);
  // Money opt-in (issue #21): one resolution, then every cost field derives
  // from it — a resolved booking silences the cost (so no split preview can
  // leak onto a booked-on game), and only a real cost opt-in exposes cost.
  const moneyOptIn = resolveMoneyOptIn({ session, standingGame });
  const costMinor = moneyOptIn?.kind === "cost" ? moneyOptIn.amountMinor : null;

  const rotation = await buildRotationView(db, session, standingGame, rows, slots, viewerUserId);

  return {
    session,
    standingGame,
    venue,
    circleId: session.circleId,
    circleName: circle?.name ?? "",
    circleColour: circle?.colour ?? null,
    circleEmblem: circle?.emblem ?? null,
    slots,
    confirmed,
    reserves,
    // 'available' (rotation, pre-lock) is not a committed slot, so it reads as
    // null here — the available state lives on `rotation.viewerAvailable`.
    viewerStatus:
      viewerRow?.status === "in" || viewerRow?.status === "reserve" || viewerRow?.status === "out"
        ? viewerRow.status
        : null,
    rotation,
    rsvpWindowOpensAt: new Date(session.startsAt - rsvpWindowDaysFor(standingGame) * DAY_MS),
    costMinor,
    costCurrency: standingGame?.costCurrency ?? "GBP",
    costPerHeadMinor: computeSessionCostPerHead(costMinor, slots),
    moneyOptIn,
    fourthCallSideHint: session.fourthCallSideHint,
    timezone: effectiveTimezone(venue, { timezone: circle?.timezone ?? DEFAULT_TZ }),
  };
}

type RsvpRow = {
  status: string;
  position: number | null;
  respondedAt: number | null;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  rating: number | null;
  isGuest: boolean;
};

/**
 * Builds the rotation read-model for getSessionSummary. Null unless the
 * Standing Game has rotationEnabled. Pre-lock, the four/sitting split is the
 * LIVE provisional result of the pure fairness function over who's available;
 * post-lock it mirrors the committed 'in'/'reserve' rows. Reasons ("played 2
 * of last 4") are computed the same way in both states so the "why" is always
 * on show.
 */
async function buildRotationView(
  db: CuatroDb,
  session: Session,
  standingGame: StandingGame | null,
  rows: RsvpRow[],
  slots: number,
  viewerUserId: string,
): Promise<SessionRotationView | null> {
  if (!standingGame?.rotationEnabled) return null;

  const refByUser = new Map<string, PlayerRef>(rows.map((r) => [r.userId, toPlayerRef(r)]));
  const refs = (ids: string[]): PlayerRef[] => ids.map((id) => refByUser.get(id)).filter((r): r is PlayerRef => !!r);
  const history = await loadRotationHistory(db, standingGame.id, session.startsAt);
  const locksAt = new Date(session.startsAt - rotationCutoffMs(standingGame));
  const mode = standingGame.rotationMode;

  // userId secondary keeps the derived availabilityOrder deterministic when
  // replies share a timestamp (matches rotationCandidates' ordering exactly, so
  // the provisional view and the eventual lock agree).
  const byResponded = (a: RsvpRow, b: RsvpRow) =>
    (a.respondedAt ?? 0) - (b.respondedAt ?? 0) ||
    (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);

  if (!session.rotationLockedAt) {
    // Provisional: derive the split live from availability. (Unlimited mode
    // stays in this branch forever — it never locks.)
    const availableRows = rows.filter((r) => r.status === "available").sort(byResponded);
    const candidates: RotationCandidate[] = availableRows.map((r, i) => ({ userId: r.userId, availabilityOrder: i }));
    const selection = computeRotation(candidates, history, slots);
    const availableIds = availableRows.map((r) => r.userId);
    return {
      mode,
      lockedAt: null,
      locksAt,
      coldStart: selection.coldStart,
      available: refs(availableIds),
      lineup: refs(selection.inUserIds),
      sitting: refs(selection.sittingUserIds),
      reasons: selection.reasons,
      viewerAvailable: availableIds.includes(viewerUserId),
    };
  }

  // Locked: the committed 'in'/'reserve' rows are authoritative. Reasons are
  // recomputed over everyone who said available (in ∪ reserve) purely for the
  // explainer text — the ordering here doesn't decide anything post-lock.
  const inRows = rows.filter((r) => r.status === "in").sort(byResponded);
  const reserveRows = rows.filter((r) => r.status === "reserve").sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const availableRows = [...inRows, ...reserveRows];
  const reasonCandidates: RotationCandidate[] = availableRows
    .slice()
    .sort(byResponded)
    .map((r, i) => ({ userId: r.userId, availabilityOrder: i }));
  const selection = computeRotation(reasonCandidates, history, slots);
  return {
    mode,
    lockedAt: session.rotationLockedAt != null ? new Date(session.rotationLockedAt) : null,
    locksAt,
    coldStart: selection.coldStart,
    available: availableRows.map(toPlayerRef),
    lineup: inRows.map(toPlayerRef),
    sitting: reserveRows.map(toPlayerRef),
    reasons: selection.reasons,
    viewerAvailable: availableRows.some((r) => r.userId === viewerUserId),
  };
}

function toPlayerRef(row: {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  rating: number | null;
  isGuest: boolean;
}): PlayerRef {
  return {
    userId: row.userId,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    rating: row.rating,
    isGuest: row.isGuest,
  };
}

/** Live view condition for the "Fourth Call" banner — independent of whether the notification has fired. */
export function isFourthCallActive(
  summary: Pick<SessionSummary, "session" | "slots" | "confirmed">,
  now: Date = new Date(),
): boolean {
  const msToStart = summary.session.startsAt - now.getTime();
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
export async function listUpcomingSessionsForUser(db: CuatroDb, userId: string, now: Date = new Date()): Promise<SessionSummary[]> {
  const memberRows = await db
    .select({ circleId: circleMembers.circleId })
    .from(circleMembers)
    .where(eq(circleMembers.userId, userId));
  const memberCircleIds = memberRows.map((r) => r.circleId);
  if (memberCircleIds.length === 0) return [];

  return listUpcomingSessionsForCircles(db, memberCircleIds, userId, now);
}

/**
 * Upcoming sessions for one circle — the circle detail page's data source
 * (shares the same lazy-generation + Fourth Call semantics as
 * listUpcomingSessionsForUser, just scoped to a single circle instead of
 * every circle a user belongs to).
 */
export async function listUpcomingSessionsForCircle(
  db: CuatroDb,
  circleId: string,
  viewerUserId: string,
  now: Date = new Date(),
): Promise<SessionSummary[]> {
  return listUpcomingSessionsForCircles(db, [circleId], viewerUserId, now);
}

async function listUpcomingSessionsForCircles(
  db: CuatroDb,
  circleIds: string[],
  viewerUserId: string,
  now: Date,
): Promise<SessionSummary[]> {
  for (const circleId of circleIds) {
    await ensureUpcomingSessionsForCircle(db, circleId, now);
  }

  const upcoming = await db
    .select()
    .from(sessions)
    .where(and(inArray(sessions.circleId, circleIds), eq(sessions.status, "upcoming"), gt(sessions.startsAt, now.getTime())))
    .orderBy(asc(sessions.startsAt));

  // Lock any due rotation game BEFORE building its summary, so the locked
  // lineup (not the provisional one) is what this view returns — same
  // lazy-on-view contract as the Fourth Call. No-op for non-rotation games and
  // for rotation games still gathering availability.
  for (const s of upcoming) {
    await lockRotationIfDue(db, s.id, now);
  }

  const summaries: SessionSummary[] = [];
  for (const s of upcoming) {
    const summary = await getSessionSummary(db, s.id, viewerUserId, now);
    if (summary !== null) summaries.push(summary);
  }

  for (const summary of summaries) {
    // Rotation sit-outs get first refusal (offerRotationSlotIfNeeded); the
    // ordinary Fourth Call only broadcasts once that chain is exhausted or the
    // game isn't a locked rotation game (not_applicable). Same lazy-on-view point.
    const offer = await offerRotationSlotIfNeeded(db, summary.session.id, now);
    if (offer.state === "exhausted" || offer.state === "not_applicable") {
      await checkFourthCallLevel1(db, summary.session.id, now);
    }
  }

  return summaries;
}
