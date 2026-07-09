/**
 * GUEST CLAIM — the join-via-link "10-second promise" (design/HANDOFF.md
 * screen 2; Directions turn 11): an anonymous WhatsApp invitee taps a ring-3
 * public link (server/fourth-call.ts's getRing3ClaimLink, unchanged by this
 * file) and is playing padel four taps later, no account required.
 *
 * Schema choice: a guest is a normal `users` row (`isGuest: true`, `email:
 * null`) rather than a separate table. That was the deliberate call over a
 * parallel "guest identity" table: guests already need to be full
 * participants everywhere a `users.id` shows up — rsvps, rating_events for
 * a verified match played before converting, notifications — and giving
 * them their own table would mean either duplicating every one of those FKs
 * as nullable "or this other table" pairs, or writing a shim that
 * materialises a `users` row at first contact anyway. `guestClaimTokenHash`
 * (this row's hashed device-cookie token — see lib/guest-session.ts) is the
 * only guest-specific column beyond the `isGuest` flag itself.
 *
 * Three phases, three functions:
 *   1. claimGuestSlot / joinGuestReserveQueue — tap "I can play"/"Join the
 *      reserve queue". Both mint a brand-new guest `users` row and a fresh
 *      device token; there is no "recognise a returning guest on a
 *      DIFFERENT session" merge in v0 — a device that claims on two
 *      sessions ends up with two independent guest rows, cookie pointing at
 *      whichever claim happened most recently. Documented limitation, same
 *      spirit as the rest of this codebase's "no cron in v0" calls.
 *   2. lockGuestName — the name step. Deliberately does NOT re-check
 *      holdExpiresAt: the 5:00 hold is only ever enforced by a CONTENDING
 *      claim (claimGuestSlot's sweepExpiredHolds sees it's stale and frees
 *      the row to 'out'); if nobody else wanted the slot, a slow typist
 *      still gets to keep it. If someone else's claim attempt did sweep it
 *      away in the meantime, this guest's own rsvp row is now 'out', so
 *      lockGuestName reports `slot_lost` — the same "beaten to it" story
 *      the UI already shows for a live race loss.
 *   3. convertGuestOnAuth — the deferred signup, called additively from
 *      /auth/callback once Supabase resolves a real identity.
 */
import { randomBytes, createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { circleMembers, circles, rsvps, sessions, standingGames, users, type CuatroDb } from "@cuatro/db";
import { slotsForSession } from "./games-service";
import { parseRing3ClaimToken } from "./fourth-call";
import { insertNotification } from "./notify";
import { displayNameLooksDerived } from "@/lib/entry-name";
import { emitCircleEvent, emitSessionEvent } from "@/lib/realtime/broadcast";

export const GUEST_HOLD_MS = 5 * 60 * 1000;
/** The displayName every guest row starts with, before the name step locks in a real first name — also the "not yet named" test used by the /fc/[token] page to decide which onboarding step to resume at. */
export const GUEST_PLACEHOLDER_NAME = "Guest";
const MAX_GUEST_NAME_LENGTH = 40;

export function mintGuestToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashGuestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Trims and length-caps a guest's typed first name; empty (after trim) is invalid. */
export function normalizeGuestName(raw: string): string | null {
  const trimmed = raw.trim().slice(0, MAX_GUEST_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
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

/**
 * Frees any guest_link 'in' row on this session whose 5:00 hold has lapsed
 * — "expired holds free the slot" (design/HANDOFF.md screen 2's edge case).
 * Run at the top of every claim attempt's transaction, before counting
 * confirmed slots, so a claim right after an abandoned hold sees accurate
 * capacity. Deliberately does not auto-promote a reserve the way
 * games-service.ts's rsvpOut does — v0 leaves that to the next lazy view,
 * same "no cron" posture as checkFourthCallLevel1/2.
 */
function sweepExpiredHolds(tx: CuatroDb, sessionId: string, now: Date): void {
  tx.update(rsvps)
    .set({ status: "out", holdExpiresAt: null, position: null, cancelledAt: now })
    .where(
      and(
        eq(rsvps.sessionId, sessionId),
        eq(rsvps.status, "in"),
        eq(rsvps.source, "guest_link"),
        sql`${rsvps.holdExpiresAt} IS NOT NULL AND ${rsvps.holdExpiresAt} < ${now.getTime()}`,
      ),
    )
    .run();
}

function loadSessionForClaim(
  tx: CuatroDb,
  sessionId: string,
  now: Date,
): { session: (typeof sessions.$inferSelect); error?: undefined } | { session?: undefined; error: "session_not_found" | "session_started" } {
  const session = tx.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!session) return { error: "session_not_found" };
  if (session.status !== "upcoming" || now.getTime() >= session.startsAt.getTime()) {
    return { error: "session_started" };
  }
  return { session };
}

function insertGuestUser(tx: CuatroDb, countryCode: string, tokenHash: string) {
  return tx
    .insert(users)
    .values({ displayName: GUEST_PLACEHOLDER_NAME, isGuest: true, guestClaimTokenHash: tokenHash, countryCode })
    .returning()
    .get();
}

export type GuestClaimOutcome =
  | { ok: true; status: "in"; guestUserId: string; token: string; holdExpiresAt: Date }
  | { ok: false; error: "invalid_link" | "session_not_found" | "session_started" | "already_full" };

/** Ring 3's "I can play — claim it" for an anonymous visitor. Verifies `ring3Token` itself (unlike claimFourthCallSlot, there's no signed-in user to already hold a fourth_call invite) then mints a fresh guest identity and soft-holds the open slot for GUEST_HOLD_MS. */
export function claimGuestSlot(db: CuatroDb, sessionId: string, ring3Token: string, now: Date = new Date()): GuestClaimOutcome {
  const parsed = parseRing3ClaimToken(ring3Token, now);
  if (!parsed || parsed.sessionId !== sessionId) return { ok: false, error: "invalid_link" };

  let circleId: string | undefined;
  const rawToken = mintGuestToken();
  const tokenHash = hashGuestToken(rawToken);

  const outcome = db.transaction((tx): GuestClaimOutcome => {
    const loaded = loadSessionForClaim(tx, sessionId, now);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { session } = loaded;
    circleId = session.circleId;

    sweepExpiredHolds(tx, sessionId, now);

    const circle = tx.select().from(circles).where(eq(circles.id, session.circleId)).get();
    const standingGame = session.standingGameId
      ? (tx.select().from(standingGames).where(eq(standingGames.id, session.standingGameId)).get() ?? null)
      : null;
    const slots = slotsForSession(standingGame);
    const confirmedCount = countConfirmed(tx, sessionId);
    if (confirmedCount >= slots) return { ok: false, error: "already_full" };

    const holdExpiresAt = new Date(now.getTime() + GUEST_HOLD_MS);
    const guest = insertGuestUser(tx, circle?.countryCode ?? "GB", tokenHash);

    tx.insert(rsvps)
      .values({ sessionId, userId: guest.id, status: "in", respondedAt: now, source: "guest_link", holdExpiresAt })
      .run();
    tx.update(users)
      .set({ rsvpInCount: sql`${users.rsvpInCount} + 1` })
      .where(eq(users.id, guest.id))
      .run();

    if (confirmedCount + 1 === slots) {
      for (const uid of confirmedParticipantIds(tx, sessionId)) {
        insertNotification(tx, { userId: uid, type: "game_filled", payload: { sessionId } });
      }
    }

    return { ok: true, status: "in", guestUserId: guest.id, token: rawToken, holdExpiresAt };
  });

  if (outcome.ok && circleId) {
    emitSessionEvent(sessionId, "rsvp", { circleId });
    emitCircleEvent(circleId, "rsvp", { sessionId });
  }
  return outcome;
}

export type GuestReserveOutcome =
  | { ok: true; status: "reserve"; guestUserId: string; token: string; position: number }
  | { ok: false; error: "invalid_link" | "session_not_found" | "session_started" };

/** The race-loser path: "X beat you to it" -> one-tap join the reserve queue as a fresh guest. */
export function joinGuestReserveQueue(db: CuatroDb, sessionId: string, ring3Token: string, now: Date = new Date()): GuestReserveOutcome {
  const parsed = parseRing3ClaimToken(ring3Token, now);
  if (!parsed || parsed.sessionId !== sessionId) return { ok: false, error: "invalid_link" };

  let circleId: string | undefined;
  const rawToken = mintGuestToken();
  const tokenHash = hashGuestToken(rawToken);

  const outcome = db.transaction((tx): GuestReserveOutcome => {
    const loaded = loadSessionForClaim(tx, sessionId, now);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { session } = loaded;
    circleId = session.circleId;

    const circle = tx.select().from(circles).where(eq(circles.id, session.circleId)).get();
    const guest = insertGuestUser(tx, circle?.countryCode ?? "GB", tokenHash);

    const maxPos =
      tx
        .select({ n: sql<number>`coalesce(max(${rsvps.position}), 0)` })
        .from(rsvps)
        .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "reserve")))
        .get()?.n ?? 0;
    const position = maxPos + 1;

    tx.insert(rsvps).values({ sessionId, userId: guest.id, status: "reserve", position, respondedAt: now, source: "guest_link" }).run();

    return { ok: true, status: "reserve", guestUserId: guest.id, token: rawToken, position };
  });

  if (outcome.ok && circleId) {
    emitSessionEvent(sessionId, "rsvp", { circleId });
    emitCircleEvent(circleId, "rsvp", { sessionId });
  }
  return outcome;
}

export type LockGuestNameOutcome =
  | { ok: true; displayName: string }
  | { ok: false; error: "invalid_name" | "not_found" | "slot_lost" };

/** The name step: "Spot held. Who should we say is coming?" -> "Lock it in". */
export function lockGuestName(
  db: CuatroDb,
  guestUserId: string,
  sessionId: string,
  rawName: string,
  now: Date = new Date(),
): LockGuestNameOutcome {
  const displayName = normalizeGuestName(rawName);
  if (!displayName) return { ok: false, error: "invalid_name" };

  let circleId: string | undefined;
  const outcome = db.transaction((tx): LockGuestNameOutcome => {
    const user = tx.select().from(users).where(eq(users.id, guestUserId)).get();
    if (!user || !user.isGuest) return { ok: false, error: "not_found" };

    const rsvp = tx.select().from(rsvps).where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.userId, guestUserId))).get();
    if (!rsvp || rsvp.status === "out") return { ok: false, error: "slot_lost" };

    tx.update(users).set({ displayName, updatedAt: now }).where(eq(users.id, guestUserId)).run();
    if (rsvp.holdExpiresAt) {
      tx.update(rsvps).set({ holdExpiresAt: null }).where(eq(rsvps.id, rsvp.id)).run();
    }

    const session = tx.select({ circleId: sessions.circleId }).from(sessions).where(eq(sessions.id, sessionId)).get();
    circleId = session?.circleId;

    return { ok: true, displayName };
  });

  if (outcome.ok && circleId) {
    emitSessionEvent(sessionId, "rsvp", { circleId });
    emitCircleEvent(circleId, "rsvp", { sessionId });
  }
  return outcome;
}

/** Resolves a raw device-cookie token to a still-guest user id, or null (no match, or that row has since converted — guestClaimTokenHash is cleared on conversion so a stale cookie can never resolve again). */
export function getGuestUserId(db: CuatroDb, rawToken: string): string | null {
  const row = db
    .select({ id: users.id, isGuest: users.isGuest })
    .from(users)
    .where(eq(users.guestClaimTokenHash, hashGuestToken(rawToken)))
    .get();
  return row?.isGuest ? row.id : null;
}

export type JoinGuestCircleOutcome =
  | { ok: true; guestUserId: string; token: string | null; circleId: string; circleName: string; displayName: string }
  | { ok: false; error: "invalid_name" | "circle_not_found" };

/**
 * The circle-invite counterpart to claimGuestSlot — the growth-loop promise
 * ("Three+ players tap the link… join to RSVP — 10-second onboarding, no
 * rating questionnaire", DESIGN.md §Growth loop). A logged-out invitee who
 * opened /join/[code] joins the Circle as a first-class guest with just a
 * name, no account.
 *
 * "In the circle", concretely, is a real `circle_members` row keyed on a
 * guest `users` row — byte-for-byte the membership a signed-in join writes
 * (server/circles.ts joinCircle), just with a guest user id. So the guest
 * shows up in the members list, counts toward memberCount, and passes
 * games-service's isCircleMember gate to RSVP the circle's next game. No
 * separate "guest membership" concept.
 *
 * `existingGuestUserId` (the API route resolves it from the device cookie)
 * keeps one device to one guest identity: a visitor who already claimed a
 * Fourth Call spot and then opens a circle invite reuses that same guest row
 * — membership added, name updated to what they typed here — rather than
 * minting a second orphan row, so a later conversion carries BOTH their
 * fourth-call rsvp and this membership onto the account. Only when there's no
 * usable existing guest row is a fresh one (and a fresh device token) minted;
 * the caller sets the cookie iff `token` comes back non-null.
 */
export function joinGuestCircle(
  db: CuatroDb,
  { inviteCode, rawName, existingGuestUserId }: { inviteCode: string; rawName: string; existingGuestUserId?: string | null },
  now: Date = new Date(),
): JoinGuestCircleOutcome {
  const displayName = normalizeGuestName(rawName);
  if (!displayName) return { ok: false, error: "invalid_name" };

  const circle = db.select().from(circles).where(eq(circles.inviteCode, inviteCode)).get();
  if (!circle) return { ok: false, error: "circle_not_found" };

  const rawToken = mintGuestToken();
  const tokenHash = hashGuestToken(rawToken);

  return db.transaction((tx): JoinGuestCircleOutcome => {
    const existing = existingGuestUserId
      ? tx.select().from(users).where(eq(users.id, existingGuestUserId)).get()
      : undefined;
    const reuse = existing?.isGuest ? existing : null;

    let guestUserId: string;
    let token: string | null;
    if (reuse) {
      tx.update(users).set({ displayName, updatedAt: now }).where(eq(users.id, reuse.id)).run();
      guestUserId = reuse.id;
      token = null; // the device cookie already carries this identity
    } else {
      const guest = tx
        .insert(users)
        .values({ displayName, isGuest: true, guestClaimTokenHash: tokenHash, countryCode: circle.countryCode })
        .returning()
        .get();
      guestUserId = guest.id;
      token = rawToken;
    }

    tx.insert(circleMembers)
      .values({ circleId: circle.id, userId: guestUserId, role: "member" })
      .onConflictDoNothing()
      .run();

    return { ok: true, guestUserId, token, circleId: circle.id, circleName: circle.name, displayName };
  });
}

/** The guest's displayName if `guestUserId` is already a member of `circleId`, else null — the /join/[code] page's "is this guest in yet?" check that picks the done-vs-join step. */
export function getGuestMembership(db: CuatroDb, guestUserId: string, circleId: string): { displayName: string } | null {
  const row = db
    .select({ displayName: users.displayName })
    .from(circleMembers)
    .innerJoin(users, eq(circleMembers.userId, users.id))
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, guestUserId), eq(users.isGuest, true)))
    .get();
  return row ? { displayName: row.displayName } : null;
}

export type ConvertGuestResult =
  | { converted: true; merged: boolean; carriedName: string | null }
  | { converted: false; reason: "not_a_guest" };

/**
 * The deferred signup, called additively from /auth/callback once
 * findOrCreateUserBySupabase has resolved `resolvedUserId` for the identity
 * that just signed in. Two cases:
 *  - `resolvedUserId === guestUserId`: Supabase provisioned (or linked) the
 *    SAME row this guest cookie points at — no pre-existing account at that
 *    email, so just flip the row from guest to real in place.
 *  - otherwise: an email conflict — the signed-in identity resolved onto a
 *    DIFFERENT, pre-existing account. That account wins. The guest's rsvps
 *    are re-pointed onto it; one that would collide with an rsvp the
 *    resolved user already holds for the same session (the (session_id,
 *    user_id) unique constraint) is dropped instead — the resolved
 *    account's own row for that session is the one that counts. The guest
 *    row itself is left in place (not deleted): rating_events or
 *    notifications may reference it from a verified match played as a
 *    guest, and re-pointing rsvps is the full extent of the merge this
 *    function is asked to do. Its token hash is cleared either way so the
 *    device cookie can never resolve to it again post-conversion.
 *
 * Two re-pointed relations, not one: a guest who joined a Circle via
 * /join/[code] (joinGuestCircle) carries a `circle_members` row too, not just
 * rsvps. Both move to the resolved account under the same PK-collision rule
 * (drop-on-clash, move otherwise) — without the membership re-point a
 * circle-join guest would silently fall OUT of the Circle they just joined
 * the instant they signed in (the guest row keeps it, but the device cookie
 * is cleared here, so the now-signed-in account would not be in it).
 *
 * `carriedName`: the guest's chosen display name is carried onto the resolved
 * account when that account is still on an auto-derived (email local-part)
 * name — a magic-link sign-up that just provisioned. It never clobbers a real
 * chosen name on a pre-existing account. Returned so /auth/callback can decide
 * the first-run name step against the POST-conversion name, so a guest who
 * already named themselves isn't re-prompted with the wrong prefill.
 */
export function convertGuestOnAuth(db: CuatroDb, guestUserId: string, resolvedUserId: string, now: Date = new Date()): ConvertGuestResult {
  return db.transaction((tx): ConvertGuestResult => {
    const guest = tx.select().from(users).where(eq(users.id, guestUserId)).get();
    if (!guest || !guest.isGuest) return { converted: false, reason: "not_a_guest" };

    const chosenName = guest.displayName !== GUEST_PLACEHOLDER_NAME ? guest.displayName : null;

    if (guestUserId === resolvedUserId) {
      tx.update(users).set({ isGuest: false, guestClaimTokenHash: null, updatedAt: now }).where(eq(users.id, guestUserId)).run();
      return { converted: true, merged: false, carriedName: chosenName };
    }

    const guestRsvps = tx.select().from(rsvps).where(eq(rsvps.userId, guestUserId)).all();
    for (const row of guestRsvps) {
      const clash = tx
        .select({ id: rsvps.id })
        .from(rsvps)
        .where(and(eq(rsvps.sessionId, row.sessionId), eq(rsvps.userId, resolvedUserId)))
        .get();
      if (clash) {
        tx.delete(rsvps).where(eq(rsvps.id, row.id)).run();
      } else {
        tx.update(rsvps).set({ userId: resolvedUserId }).where(eq(rsvps.id, row.id)).run();
      }
    }

    const guestMemberships = tx.select().from(circleMembers).where(eq(circleMembers.userId, guestUserId)).all();
    for (const row of guestMemberships) {
      const clash = tx
        .select({ userId: circleMembers.userId })
        .from(circleMembers)
        .where(and(eq(circleMembers.circleId, row.circleId), eq(circleMembers.userId, resolvedUserId)))
        .get();
      if (clash) {
        tx.delete(circleMembers)
          .where(and(eq(circleMembers.circleId, row.circleId), eq(circleMembers.userId, guestUserId)))
          .run();
      } else {
        tx.update(circleMembers)
          .set({ userId: resolvedUserId })
          .where(and(eq(circleMembers.circleId, row.circleId), eq(circleMembers.userId, guestUserId)))
          .run();
      }
    }

    let carriedName: string | null = null;
    if (chosenName) {
      const resolved = tx
        .select({ displayName: users.displayName, email: users.email })
        .from(users)
        .where(eq(users.id, resolvedUserId))
        .get();
      if (resolved && displayNameLooksDerived(resolved.displayName, resolved.email)) {
        tx.update(users).set({ displayName: chosenName, updatedAt: now }).where(eq(users.id, resolvedUserId)).run();
        carriedName = chosenName;
      }
    }

    tx.update(users).set({ guestClaimTokenHash: null, updatedAt: now }).where(eq(users.id, guestUserId)).run();
    return { converted: true, merged: true, carriedName };
  });
}
