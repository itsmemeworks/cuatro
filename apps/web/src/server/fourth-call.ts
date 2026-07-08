/**
 * FOURTH CALL — level 2 (extended network), per DESIGN.md's escalating
 * cascade for a short game:
 *   1. Circle — reserves and members not yet in (games-service.ts's
 *      checkFourthCallLevel1, T-48h).
 *   2. Extended network (this file) — members of the session participants'
 *      OTHER circles, or people they've verified a match against, within a
 *      ±0.5 Glass band, same country as the session's circle.
 *   3. Open call (v1, out of scope).
 *
 * Fires lazily on view — same "no cron in v0" design as level 1 — either
 * because the organiser tapped "escalate" (forceEscalate) or because 20
 * minutes have passed since level 1's notifications went out. A level-2
 * invitee is not necessarily a member of the session's circle, so claiming
 * a slot goes through claimFourthCallSlot() below rather than
 * games-service.ts's rsvpIn(), which gates on circle membership — claiming
 * makes someone a session participant (a plain `rsvps` row; that table has
 * no circle_members FK) without making them a circle member.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  circleMembers,
  circles,
  notifications,
  ratingEvents,
  rsvps,
  sessions,
  standingGames,
  users,
  type CuatroDb,
} from "@cuatro/db";
import { slotsForSession } from "./games-service";
import { insertNotification } from "./notify";
import { emitCircleEvent, emitSessionEvent } from "@/lib/realtime/broadcast";

export const FOURTH_CALL_LEVEL2_DELAY_MS = 20 * 60 * 1000;
const FOURTH_CALL_LEVEL2_RATING_BAND = 0.5;
export const FOURTH_CALL_LEVEL2_CAP = 12;

export type FourthCallLevel2Result =
  | {
      fired: false;
      reason: "not_yet" | "already_full" | "already_notified" | "session_not_upcoming" | "no_candidates";
    }
  | { fired: true; notifiedUserIds: string[] };

export interface FourthCallLevel2Options {
  /** Organiser tapped "escalate" — skips the 20-minutes-after-level-1 wait. */
  forceEscalate?: boolean;
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

function confirmedParticipantIds(tx: CuatroDb, sessionId: string): string[] {
  return tx
    .select({ userId: rsvps.userId })
    .from(rsvps)
    .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "in")))
    .all()
    .map((r) => r.userId);
}

/** Every user already sent a fourth_call notification (any level) for this session. */
function fourthCallNotifiedUserIds(tx: CuatroDb, sessionId: string): Set<string> {
  const rows = tx
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

function level1FiredAt(tx: CuatroDb, sessionId: string): Date | null {
  const row = tx
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

function level2AlreadyFired(tx: CuatroDb, sessionId: string): boolean {
  const row = tx
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
  return !!row;
}

/** Every circle any of `userIds` belongs to (deduped). */
function circleIdsFor(tx: CuatroDb, userIds: string[]): string[] {
  if (userIds.length === 0) return [];
  const rows = tx.select({ circleId: circleMembers.circleId }).from(circleMembers).where(inArray(circleMembers.userId, userIds)).all();
  return [...new Set(rows.map((r) => r.circleId))];
}

/** Members of any of `circleIds`, minus `excludeUserIds`. */
function membersOfCircles(tx: CuatroDb, circleIds: string[], excludeUserIds: string[]): Set<string> {
  if (circleIds.length === 0) return new Set();
  const excluded = new Set(excludeUserIds);
  const rows = tx.select({ userId: circleMembers.userId }).from(circleMembers).where(inArray(circleMembers.circleId, circleIds)).all();
  return new Set(rows.map((r) => r.userId).filter((id) => !excluded.has(id)));
}

/** Every opponent any of `userIds` has a verified rating_events row against, minus `excludeUserIds`. */
function opponentHistoryFor(tx: CuatroDb, userIds: string[], excludeUserIds: string[]): Set<string> {
  if (userIds.length === 0) return new Set();
  const excluded = new Set(excludeUserIds);
  const rows = tx.select({ factors: ratingEvents.factors }).from(ratingEvents).where(inArray(ratingEvents.userId, userIds)).all();
  const result = new Set<string>();
  for (const row of rows) {
    for (const opponentId of row.factors.opponentUserIds) {
      if (!excluded.has(opponentId)) result.add(opponentId);
    }
  }
  return result;
}

function isMemberOf(tx: CuatroDb, circleId: string, userId: string): boolean {
  return !!tx
    .select({ userId: circleMembers.userId })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)))
    .get();
}

/**
 * Lazily checked on view (no cron in v0, matching checkFourthCallLevel1).
 * Idempotent per session: a "fourth_call" level:2 notification already
 * existing for the session is the fired marker, so a second view (or a
 * second "escalate" tap) is a no-op — nobody gets nagged twice.
 */
export function checkFourthCallLevel2(
  db: CuatroDb,
  sessionId: string,
  now: Date = new Date(),
  options: FourthCallLevel2Options = {},
): FourthCallLevel2Result {
  let circleId: string | undefined;

  const result = db.transaction((tx): FourthCallLevel2Result => {
    const session = tx.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!session || session.status !== "upcoming" || now.getTime() >= session.startsAt.getTime()) {
      return { fired: false, reason: "session_not_upcoming" };
    }
    circleId = session.circleId;

    const standingGame = session.standingGameId
      ? (tx.select().from(standingGames).where(eq(standingGames.id, session.standingGameId)).get() ?? null)
      : null;
    if (countConfirmed(tx, sessionId) >= slotsForSession(standingGame)) {
      return { fired: false, reason: "already_full" };
    }

    if (level2AlreadyFired(tx, sessionId)) {
      return { fired: false, reason: "already_notified" };
    }

    if (!options.forceEscalate) {
      const firedAt = level1FiredAt(tx, sessionId);
      if (!firedAt || now.getTime() - firedAt.getTime() < FOURTH_CALL_LEVEL2_DELAY_MS) {
        return { fired: false, reason: "not_yet" };
      }
    }

    const circle = tx.select().from(circles).where(eq(circles.id, session.circleId)).get();
    if (!circle) return { fired: false, reason: "session_not_upcoming" };

    const participantIds = confirmedParticipantIds(tx, sessionId);
    const alreadyNotified = fourthCallNotifiedUserIds(tx, sessionId);

    const participantCircleIds = circleIdsFor(tx, participantIds);
    const viaCircle = membersOfCircles(tx, participantCircleIds, participantIds);
    const viaOpponentHistory = opponentHistoryFor(tx, participantIds, participantIds);

    const candidateIds = new Set<string>([...viaCircle, ...viaOpponentHistory]);
    // "excluding current circle members already notified": a candidate who
    // is a member of the SESSION's own circle and already has a fourth_call
    // notification for it (the normal case — level 1 reaches everyone who
    // hasn't responded) is dropped; one who slipped through level 1 for any
    // reason is still eligible here.
    for (const id of candidateIds) {
      if (alreadyNotified.has(id) && isMemberOf(tx, session.circleId, id)) {
        candidateIds.delete(id);
      }
    }

    if (candidateIds.size === 0) return { fired: false, reason: "no_candidates" };

    // The yardstick for "the right Glass band" — average of the confirmed
    // slot-holders' ratings (unrated participants don't contribute one).
    const participantRatings = participantIds.length
      ? tx
          .select({ rating: users.rating })
          .from(users)
          .where(inArray(users.id, participantIds))
          .all()
          .map((r) => r.rating)
          .filter((r): r is number => r != null)
      : [];
    const slotHolderAverage =
      participantRatings.length > 0 ? participantRatings.reduce((a, b) => a + b, 0) / participantRatings.length : null;

    const candidateRows = tx
      .select({ id: users.id, rating: users.rating, countryCode: users.countryCode })
      .from(users)
      .where(inArray(users.id, [...candidateIds]))
      .all();

    const scored: { id: string; distance: number | null }[] = [];
    for (const c of candidateRows) {
      if (c.countryCode !== circle.countryCode) continue;

      if (c.rating == null) {
        // Unrated candidates only qualify via the shared-circle path — no
        // Glass number to weigh against a pure opponent-history match.
        if (!viaCircle.has(c.id)) continue;
        scored.push({ id: c.id, distance: null });
        continue;
      }

      if (slotHolderAverage == null) {
        // No rated participant to compare against — nothing to filter on.
        scored.push({ id: c.id, distance: null });
        continue;
      }

      const distance = Math.abs(c.rating - slotHolderAverage);
      if (distance > FOURTH_CALL_LEVEL2_RATING_BAND) continue;
      scored.push({ id: c.id, distance });
    }

    if (scored.length === 0) return { fired: false, reason: "no_candidates" };

    scored.sort((a, b) => {
      if (a.distance == null && b.distance == null) return 0;
      if (a.distance == null) return 1; // no-distance (unrated) candidates sort after rated ones
      if (b.distance == null) return -1;
      return a.distance - b.distance;
    });

    const chosen = scored.slice(0, FOURTH_CALL_LEVEL2_CAP);
    for (const c of chosen) {
      insertNotification(tx, { userId: c.id, type: "fourth_call", payload: { sessionId, level: 2 } });
    }

    return { fired: true, notifiedUserIds: chosen.map((c) => c.id) };
  });

  if (result.fired && circleId) {
    emitSessionEvent(sessionId, "fourth_call", { circleId, level: 2 });
    emitCircleEvent(circleId, "fourth_call", { sessionId, level: 2 });
  }
  return result;
}

export type ClaimOutcome =
  | { ok: true; status: "in"; alreadyIn: boolean }
  | { ok: false; error: "no_fourth_call_invite" | "session_not_found" | "session_started" | "already_full" };

/** Does `userId` hold ANY fourth_call invite (level 1 or 2) for this session? Shared by claimFourthCallSlot's gate and the /games/[sessionId] page's "I can play" button visibility. */
export function hasFourthCallInvite(db: CuatroDb, sessionId: string, userId: string): boolean {
  const invited = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, "fourth_call"),
        sql`json_extract(${notifications.payload}, '$.sessionId') = ${sessionId}`,
      ),
    )
    .get();
  return !!invited;
}

/**
 * The non-member path onto an open slot: a Fourth Call invitee (typically a
 * level-2 candidate who isn't a circle member) taps "I can play" from their
 * notification. Mirrors games-service.ts's rsvpIn() slot-assignment but
 * swaps its isCircleMember() gate for "this user actually holds a
 * fourth_call invite for this session" — claiming does not enrol them in
 * the circle, it only creates a session participant.
 */
export function claimFourthCallSlot(db: CuatroDb, sessionId: string, userId: string, now: Date = new Date()): ClaimOutcome {
  let circleId: string | undefined;

  const outcome = db.transaction((tx): ClaimOutcome => {
    if (!hasFourthCallInvite(tx, sessionId, userId)) return { ok: false, error: "no_fourth_call_invite" };

    const session = tx.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!session) return { ok: false, error: "session_not_found" };
    circleId = session.circleId;
    if (session.status !== "upcoming" || now.getTime() >= session.startsAt.getTime()) {
      return { ok: false, error: "session_started" };
    }

    const existing = tx.select().from(rsvps).where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.userId, userId))).get();
    if (existing?.status === "in") return { ok: true, status: "in", alreadyIn: true };

    const standingGame = session.standingGameId
      ? (tx.select().from(standingGames).where(eq(standingGames.id, session.standingGameId)).get() ?? null)
      : null;
    const slots = slotsForSession(standingGame);
    const confirmedCount = countConfirmed(tx, sessionId);
    if (confirmedCount >= slots) return { ok: false, error: "already_full" };

    if (existing) {
      tx.update(rsvps)
        .set({ status: "in", position: null, respondedAt: now, cancelledAt: null, promotedAt: null })
        .where(eq(rsvps.id, existing.id))
        .run();
    } else {
      tx.insert(rsvps).values({ sessionId, userId, status: "in", respondedAt: now }).run();
    }

    tx.update(users)
      .set({ rsvpInCount: sql`${users.rsvpInCount} + 1` })
      .where(eq(users.id, userId))
      .run();

    if (confirmedCount + 1 === slots) {
      for (const uid of confirmedParticipantIds(tx, sessionId)) {
        insertNotification(tx, { userId: uid, type: "game_filled", payload: { sessionId } });
      }
    }

    return { ok: true, status: "in", alreadyIn: false };
  });

  if (outcome.ok && !outcome.alreadyIn && circleId) {
    emitSessionEvent(sessionId, "fourth_call", { circleId, claimed: true });
    emitCircleEvent(circleId, "fourth_call", { sessionId, claimed: true });
    emitSessionEvent(sessionId, "rsvp", { circleId });
    emitCircleEvent(circleId, "rsvp", { sessionId });
  }
  return outcome;
}
