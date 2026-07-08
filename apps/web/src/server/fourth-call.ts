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
import { createHmac, timingSafeEqual } from "node:crypto";
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

// ---------------------------------------------------------------------------
// Fourth Call — level 3 ("anyone with the link")
// ---------------------------------------------------------------------------
//
// No new table: a ring-3 claim link is a self-contained, server-signed
// token — `base64url(sessionId + "." + expiresAtMs) + "." + hmac(...)` —
// not a stored invite row. Minting it (mintRing3ClaimToken /
// getRing3ClaimLink) is a pure function of (sessionId, expiresAt), so
// generating "the same" link twice (the organiser reopening the send
// screen, or tapping Copy again) always reproduces the identical token —
// idempotent by construction, no "already sent" bookkeeping needed the way
// level 1/2's notification-based invites require. Verification
// (parseRing3ClaimToken) re-derives the HMAC and checks expiry; tampering
// with either half of the payload changes the signature, and
// timingSafeEqual keeps that check from leaking timing information about
// how close a forged signature got.
//
// Expiry is always the session's own kickoff time: claimFourthCallSlot
// already rejects a claim once a session has started, so embedding a
// separate, shorter TTL would just be a second, redundant clock to keep in
// sync with the first.
function ring3Secret(): string {
  const secret = process.env.FOURTH_CALL_LINK_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[fourth-call] FOURTH_CALL_LINK_SECRET is not set — ring-3 claim links are being signed with an insecure fallback secret. Set FOURTH_CALL_LINK_SECRET in production.",
    );
  }
  // Stable across a dev/test process so a minted link keeps verifying for
  // the lifetime of one run; never used when the env var is set.
  return "cuatro-dev-insecure-fourth-call-secret";
}

/** Pure signing — `secret` is a parameter (rather than reading env directly) so tests can exercise tamper/expiry without touching process.env. */
export function signRing3Token(sessionId: string, expiresAt: Date, secret: string): string {
  const payload = `${sessionId}.${expiresAt.getTime()}`;
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

/** Pure verification. Returns the embedded sessionId iff the signature matches and the token hasn't expired; null for anything else (malformed, tampered, or expired). */
export function verifyRing3Token(token: string, secret: string, now: Date = new Date()): { sessionId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expectedSig = createHmac("sha256", secret).update(payloadB64).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  // UUIDs (idColumn()'s crypto.randomUUID()) never contain ".", so the
  // *last* dot unambiguously separates sessionId from the expiry suffix
  // even though sessionId itself is attacker-uncontrolled here anyway.
  const dot = payload.lastIndexOf(".");
  if (dot === -1) return null;
  const sessionId = payload.slice(0, dot);
  const exp = Number(payload.slice(dot + 1));
  if (!sessionId || !Number.isFinite(exp)) return null;
  if (now.getTime() > exp) return null;

  return { sessionId };
}

export function mintRing3ClaimToken(sessionId: string, expiresAt: Date): string {
  return signRing3Token(sessionId, expiresAt, ring3Secret());
}

export function parseRing3ClaimToken(token: string, now: Date = new Date()): { sessionId: string } | null {
  return verifyRing3Token(token, ring3Secret(), now);
}

export interface Ring3ClaimLink {
  sessionId: string;
  token: string;
  expiresAt: Date;
  /** The public route this token is valid on — see app/fc/[token]/page.tsx. */
  path: string;
}

export type Ring3LinkResult =
  | { ok: true; value: Ring3ClaimLink }
  | { ok: false; error: "session_not_found" | "session_started" };

/** Ring 3's "Copy" action (organiser, fourth-call-send.tsx) — mints (or re-derives) the public claim link for a still-open, not-yet-started session. */
export function getRing3ClaimLink(db: CuatroDb, sessionId: string, now: Date = new Date()): Ring3LinkResult {
  const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!session) return { ok: false, error: "session_not_found" };
  if (session.status !== "upcoming" || now.getTime() >= session.startsAt.getTime()) {
    return { ok: false, error: "session_started" };
  }

  const expiresAt = session.startsAt;
  const token = mintRing3ClaimToken(sessionId, expiresAt);
  return { ok: true, value: { sessionId, token, expiresAt, path: `/fc/${token}` } };
}

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

export interface ClaimFourthCallOptions {
  /** A ring-3 public-link token (see getRing3ClaimLink) — accepted in lieu of holding a fourth_call notification. Verified against `sessionId`, not just "any valid token", so one Circle's link can't claim a slot on a different session. */
  ring3Token?: string;
}

/**
 * The non-member path onto an open slot: a Fourth Call invitee (a level-2
 * candidate who isn't a circle member, or anyone who followed a ring-3
 * public link) taps "I can play". Mirrors games-service.ts's rsvpIn()
 * slot-assignment but swaps its isCircleMember() gate for "this user holds
 * a fourth_call invite OR a valid ring-3 token for this session" —
 * claiming does not enrol them in the circle, it only creates a session
 * participant. Every successful claim through here is `source: "fourth_call"`
 * on the rsvps row (see design/HANDOFF.md gap #5) — that's the honest
 * "claimed via Fourth Call" signal fourth-call-send.tsx's banner now reads,
 * replacing the old hasFourthCallInvite heuristic.
 */
export function claimFourthCallSlot(
  db: CuatroDb,
  sessionId: string,
  userId: string,
  now: Date = new Date(),
  options: ClaimFourthCallOptions = {},
): ClaimOutcome {
  let circleId: string | undefined;

  const outcome = db.transaction((tx): ClaimOutcome => {
    const holdsInvite = hasFourthCallInvite(tx, sessionId, userId);
    const ring3Valid = options.ring3Token ? parseRing3ClaimToken(options.ring3Token, now)?.sessionId === sessionId : false;
    if (!holdsInvite && !ring3Valid) return { ok: false, error: "no_fourth_call_invite" };

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
        .set({ status: "in", position: null, respondedAt: now, cancelledAt: null, promotedAt: null, source: "fourth_call" })
        .where(eq(rsvps.id, existing.id))
        .run();
    } else {
      tx.insert(rsvps).values({ sessionId, userId, status: "in", respondedAt: now, source: "fourth_call" }).run();
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

/**
 * Whoever currently holds this session's open slot via a Fourth Call claim
 * (level 2 or ring 3 — see claimFourthCallSlot's `source: "fourth_call"`
 * write), or null if every confirmed slot was filled the ordinary way.
 * Replaces the old hasFourthCallInvite-based guess in the send page, which
 * could misfire for a regular circle member who separately held a stale
 * fourth_call notification from an earlier escalation that they didn't
 * actually claim through.
 */
export function findFourthCallClaimant(db: CuatroDb, sessionId: string): string | null {
  const row = db
    .select({ userId: rsvps.userId })
    .from(rsvps)
    .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "in"), eq(rsvps.source, "fourth_call")))
    .get();
  return row?.userId ?? null;
}
