/**
 * FOURTH CALL — the claim + ring-3 machinery, per DESIGN.md's escalating
 * cascade for a short game:
 *   1. Circle — reserves and members not yet in (games-service.ts's
 *      checkFourthCallLevel1, T-48h).
 *   2. The Local Ring — nearby, level-matched, findable players
 *      (games-service.ts's checkFourthCallLocalRing + server/local-ring.ts).
 *   3. Open call — "anyone with the link" (this file's ring-3 signed tokens).
 *
 * This file owns what's shared across those rings once a slot is offered: the
 * signed ring-3 claim link, and the claim itself. A ring-2/ring-3 invitee is
 * not necessarily a member of the session's circle, so claiming a slot goes
 * through claimFourthCallSlot() below rather than games-service.ts's rsvpIn(),
 * which gates on circle membership — claiming makes someone a session
 * participant (a plain `rsvps` row; that table has no circle_members FK)
 * without making them a circle member.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  circleMembers,
  notifications,
  rsvps,
  sessions,
  standingGames,
  users,
  type CuatroDb,
} from "@cuatro/db";
import { slotsForSession } from "./games-service";
import { insertNotification } from "./notify";
import { emitCircleEvent, emitSessionEvent } from "@/lib/realtime/broadcast";
import { captureEvent } from "@/lib/analytics";

// Startup check (not the lazy per-call warn() below): fail loudly, once, at
// module load in production if the real secret was never set, rather than
// only surfacing it the first time a ring-3 link happens to be minted.
if (process.env.NODE_ENV === "production" && !process.env.FOURTH_CALL_LINK_SECRET) {
  console.error("[fourth-call] FOURTH_CALL_LINK_SECRET is not set. Ring-3 claim links will be signed with an insecure fallback secret. Set FOURTH_CALL_LINK_SECRET in production.");
}

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
      "[fourth-call] FOURTH_CALL_LINK_SECRET is not set. Ring-3 claim links are being signed with an insecure fallback secret. Set FOURTH_CALL_LINK_SECRET in production.",
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
export async function getRing3ClaimLink(db: CuatroDb, sessionId: string, now: Date = new Date()): Promise<Ring3LinkResult> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session) return { ok: false, error: "session_not_found" };
  if (session.status !== "upcoming" || now.getTime() >= session.startsAt) {
    return { ok: false, error: "session_started" };
  }

  // startsAt is epoch-ms now; the token/crypto layer works in Date, so wrap it.
  const expiresAt = new Date(session.startsAt);
  const token = mintRing3ClaimToken(sessionId, expiresAt);
  return { ok: true, value: { sessionId, token, expiresAt, path: `/fc/${token}` } };
}

async function countConfirmed(tx: CuatroDb, sessionId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)` })
    .from(rsvps)
    .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "in")));
  return Number(row?.n ?? 0);
}

async function confirmedParticipantIds(tx: CuatroDb, sessionId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: rsvps.userId })
    .from(rsvps)
    .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "in")));
  return rows.map((r) => r.userId);
}

export type ClaimOutcome =
  | { ok: true; status: "in"; alreadyIn: boolean }
  | { ok: false; error: "no_fourth_call_invite" | "session_not_found" | "session_started" | "already_full" };

/** Does `userId` hold ANY fourth_call invite (level 1 or 2) for this session? Shared by claimFourthCallSlot's gate and the /games/[sessionId] page's "I can play" button visibility. */
export async function hasFourthCallInvite(db: CuatroDb, sessionId: string, userId: string): Promise<boolean> {
  const [invited] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, "fourth_call"),
        sql`${notifications.payload} ->> 'sessionId' = ${sessionId}`,
      ),
    );
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
export async function claimFourthCallSlot(
  db: CuatroDb,
  sessionId: string,
  userId: string,
  now: Date = new Date(),
  options: ClaimFourthCallOptions = {},
): Promise<ClaimOutcome> {
  let circleId: string | undefined;
  // §9 metric 3 telemetry, captured inside the transaction so the fourth_call
  // events can fire AFTER commit (never inside it) with the right facts.
  let ringUsed = 2; // network invite (ring 2) unless a ring-3 public link is the sole grant.
  let filledLastSlot = false; // this claim filled the session's final open slot.
  let isNewToCircle = false; // the claimant wasn't already a Circle member (a growth signal).
  let isGuestClaimant = false;

  const outcome = await db.transaction(async (tx): Promise<ClaimOutcome> => {
    const holdsInvite = await hasFourthCallInvite(tx, sessionId, userId);
    const ring3Valid = options.ring3Token ? parseRing3ClaimToken(options.ring3Token, now)?.sessionId === sessionId : false;
    if (!holdsInvite && !ring3Valid) return { ok: false, error: "no_fourth_call_invite" };
    // A claim backed only by a public link is ring 3; anything holding a
    // fourth_call notification is a ring-1/2 invite. The exact 1-vs-2 split
    // isn't distinguished here (the notification level isn't re-read) — see
    // metrics-manifest.md; ring 3 is the growth-story-critical one.
    ringUsed = ring3Valid && !holdsInvite ? 3 : 2;

    // Lock the session row: the capacity check (confirmedCount >= slots) then the
    // slot write is a read-decide-write that must serialise against rsvpIn and
    // other claimants racing the same last open slot. FOR UPDATE guarantees the
    // second claimant sees the first's commit and reads already_full.
    const [session] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for("update");
    if (!session) return { ok: false, error: "session_not_found" };
    circleId = session.circleId;
    if (session.status !== "upcoming" || now.getTime() >= session.startsAt) {
      return { ok: false, error: "session_started" };
    }

    const [existing] = await tx.select().from(rsvps).where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.userId, userId)));
    if (existing?.status === "in") return { ok: true, status: "in", alreadyIn: true };

    const standingGame = session.standingGameId
      ? ((await tx.select().from(standingGames).where(eq(standingGames.id, session.standingGameId)))[0] ?? null)
      : null;
    const slots = slotsForSession(standingGame);
    const confirmedCount = await countConfirmed(tx, sessionId);
    if (confirmedCount >= slots) return { ok: false, error: "already_full" };

    if (existing) {
      await tx.update(rsvps)
        .set({ status: "in", position: null, respondedAt: now.getTime(), cancelledAt: null, promotedAt: null, source: "fourth_call" })
        .where(eq(rsvps.id, existing.id));
    } else {
      await tx.insert(rsvps).values({ sessionId, userId, status: "in", respondedAt: now.getTime(), source: "fourth_call" });
    }

    await tx.update(users)
      .set({ rsvpInCount: sql`${users.rsvpInCount} + 1` })
      .where(eq(users.id, userId));

    // Growth-signal facts for the §9 fourth_call events (captured here, fired
    // after commit): was the claimant already in the Circle, are they a guest.
    const [membership] = await tx
      .select({ userId: circleMembers.userId })
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, session.circleId), eq(circleMembers.userId, userId)));
    isNewToCircle = !membership;
    const [claimant] = await tx.select({ isGuest: users.isGuest }).from(users).where(eq(users.id, userId));
    isGuestClaimant = Boolean(claimant?.isGuest);

    if (confirmedCount + 1 === slots) {
      filledLastSlot = true;
      for (const uid of await confirmedParticipantIds(tx, sessionId)) {
        await insertNotification(tx, { userId: uid, type: "game_filled", payload: { sessionId } });
      }
    }

    return { ok: true, status: "in", alreadyIn: false };
  });

  if (outcome.ok && !outcome.alreadyIn && circleId) {
    emitSessionEvent(sessionId, "fourth_call", { circleId, claimed: true });
    emitCircleEvent(circleId, "fourth_call", { sessionId, claimed: true });
    emitSessionEvent(sessionId, "rsvp", { circleId });
    emitCircleEvent(circleId, "rsvp", { sessionId });

    // §9 metric 3: fourth_call_answered (a slot was claimed via the call).
    // call_id = session_id (no discrete call entity — see metrics-manifest.md).
    captureEvent("fourth_call_answered", {
      distinctId: userId,
      circleId,
      sessionId,
      timestamp: now.getTime(),
      properties: {
        call_id: sessionId,
        filled_by: userId,
        ring_that_filled: ringUsed,
        is_new_to_circle: isNewToCircle,
        is_guest: isGuestClaimant,
        answered_at: now.getTime(),
      },
    });

    // §9 metric 3: fourth_call_resolved with outcome=filled — the anchor for the
    // median fill-time query (fired_at → this). The expired_short and cancelled
    // outcomes are NOT emitted here (they happen at rotation-lock / session-start
    // in the scheduler path, out of this callsite's reach); fill rate is still
    // computable as resolved-filled / distinct-fired call_ids — see manifest.
    if (filledLastSlot) {
      captureEvent("fourth_call_resolved", {
        distinctId: userId,
        circleId,
        sessionId,
        timestamp: now.getTime(),
        properties: { call_id: sessionId, outcome: "filled", resolved_at: now.getTime() },
      });
    }
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
export async function findFourthCallClaimant(db: CuatroDb, sessionId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: rsvps.userId })
    .from(rsvps)
    .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "in"), eq(rsvps.source, "fourth_call")));
  return row?.userId ?? null;
}
