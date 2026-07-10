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
import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import {
  circleMembers,
  circleMessages,
  circles,
  matchComments,
  matchReactions,
  matches,
  notifications,
  ratingEvents,
  rsvps,
  sessions,
  standingGames,
  tabEntries,
  users,
  type CuatroDb,
} from "@cuatro/db";
import { slotsForSession } from "./games-service";
import { parseRing3ClaimToken } from "./fourth-call";
import { insertNotification } from "./notify";
import { CircleFullError, insertCircleMembership } from "./circles";
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

async function countConfirmed(tx: CuatroDb, sessionId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`cast(count(*) as int)` })
    .from(rsvps)
    .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "in")));
  return row?.n ?? 0;
}

async function confirmedParticipantIds(tx: CuatroDb, sessionId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: rsvps.userId })
    .from(rsvps)
    .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "in")));
  return rows.map((r) => r.userId);
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
async function sweepExpiredHolds(tx: CuatroDb, sessionId: string, now: Date): Promise<void> {
  await tx.update(rsvps)
    .set({ status: "out", holdExpiresAt: null, position: null, cancelledAt: now.getTime() })
    .where(
      and(
        eq(rsvps.sessionId, sessionId),
        eq(rsvps.status, "in"),
        eq(rsvps.source, "guest_link"),
        isNotNull(rsvps.holdExpiresAt),
        lt(rsvps.holdExpiresAt, now.getTime()),
      ),
    );
}

async function loadSessionForClaim(
  tx: CuatroDb,
  sessionId: string,
  now: Date,
): Promise<{ session: (typeof sessions.$inferSelect); error?: undefined } | { session?: undefined; error: "session_not_found" | "session_started" }> {
  // FOR UPDATE: every guest claim/reserve locks the session row up front so the
  // capacity check + hold sweep + insert serialize against concurrent claims.
  const [session] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for("update");
  if (!session) return { error: "session_not_found" };
  if (session.status !== "upcoming" || now.getTime() >= session.startsAt) {
    return { error: "session_started" };
  }
  return { session };
}

async function insertGuestUser(tx: CuatroDb, countryCode: string, tokenHash: string) {
  const [row] = await tx
    .insert(users)
    .values({ displayName: GUEST_PLACEHOLDER_NAME, isGuest: true, guestClaimTokenHash: tokenHash, countryCode })
    .returning();
  return row;
}

export type GuestClaimOutcome =
  | { ok: true; status: "in"; guestUserId: string; token: string; holdExpiresAt: Date }
  | { ok: false; error: "invalid_link" | "session_not_found" | "session_started" | "already_full" };

/** Ring 3's "I can play — claim it" for an anonymous visitor. Verifies `ring3Token` itself (unlike claimFourthCallSlot, there's no signed-in user to already hold a fourth_call invite) then mints a fresh guest identity and soft-holds the open slot for GUEST_HOLD_MS. */
export async function claimGuestSlot(db: CuatroDb, sessionId: string, ring3Token: string, now: Date = new Date()): Promise<GuestClaimOutcome> {
  const parsed = parseRing3ClaimToken(ring3Token, now);
  if (!parsed || parsed.sessionId !== sessionId) return { ok: false, error: "invalid_link" };

  let circleId: string | undefined;
  const rawToken = mintGuestToken();
  const tokenHash = hashGuestToken(rawToken);

  const outcome = await db.transaction(async (tx): Promise<GuestClaimOutcome> => {
    const loaded = await loadSessionForClaim(tx, sessionId, now);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { session } = loaded;
    circleId = session.circleId;

    await sweepExpiredHolds(tx, sessionId, now);

    const [circle] = await tx.select().from(circles).where(eq(circles.id, session.circleId));
    const standingGame = session.standingGameId
      ? (await tx.select().from(standingGames).where(eq(standingGames.id, session.standingGameId)))[0] ?? null
      : null;
    const slots = slotsForSession(standingGame);
    const confirmedCount = await countConfirmed(tx, sessionId);
    if (confirmedCount >= slots) return { ok: false, error: "already_full" };

    const holdExpiresMs = now.getTime() + GUEST_HOLD_MS;
    const guest = await insertGuestUser(tx, circle?.countryCode ?? "GB", tokenHash);

    await tx.insert(rsvps)
      .values({ sessionId, userId: guest.id, status: "in", respondedAt: now.getTime(), source: "guest_link", holdExpiresAt: holdExpiresMs });
    await tx.update(users)
      .set({ rsvpInCount: sql`${users.rsvpInCount} + 1` })
      .where(eq(users.id, guest.id));

    if (confirmedCount + 1 === slots) {
      for (const uid of await confirmedParticipantIds(tx, sessionId)) {
        await insertNotification(tx, { userId: uid, type: "game_filled", payload: { sessionId } });
      }
    }

    return { ok: true, status: "in", guestUserId: guest.id, token: rawToken, holdExpiresAt: new Date(holdExpiresMs) };
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
export async function joinGuestReserveQueue(db: CuatroDb, sessionId: string, ring3Token: string, now: Date = new Date()): Promise<GuestReserveOutcome> {
  const parsed = parseRing3ClaimToken(ring3Token, now);
  if (!parsed || parsed.sessionId !== sessionId) return { ok: false, error: "invalid_link" };

  let circleId: string | undefined;
  const rawToken = mintGuestToken();
  const tokenHash = hashGuestToken(rawToken);

  const outcome = await db.transaction(async (tx): Promise<GuestReserveOutcome> => {
    const loaded = await loadSessionForClaim(tx, sessionId, now);
    if (loaded.error) return { ok: false, error: loaded.error };
    const { session } = loaded;
    circleId = session.circleId;

    const [circle] = await tx.select().from(circles).where(eq(circles.id, session.circleId));
    const guest = await insertGuestUser(tx, circle?.countryCode ?? "GB", tokenHash);

    // Session row is already locked (loadSessionForClaim FOR UPDATE), so the
    // max-position read + insert can't race another reserve joiner.
    const [maxRow] = await tx
      .select({ n: sql<number>`coalesce(max(${rsvps.position}), 0)` })
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "reserve")));
    const position = (maxRow?.n ?? 0) + 1;

    await tx.insert(rsvps).values({ sessionId, userId: guest.id, status: "reserve", position, respondedAt: now.getTime(), source: "guest_link" });

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
export async function lockGuestName(
  db: CuatroDb,
  guestUserId: string,
  sessionId: string,
  rawName: string,
  now: Date = new Date(),
): Promise<LockGuestNameOutcome> {
  const displayName = normalizeGuestName(rawName);
  if (!displayName) return { ok: false, error: "invalid_name" };

  let circleId: string | undefined;
  const outcome = await db.transaction(async (tx): Promise<LockGuestNameOutcome> => {
    const [user] = await tx.select().from(users).where(eq(users.id, guestUserId));
    if (!user || !user.isGuest) return { ok: false, error: "not_found" };

    const [rsvp] = await tx.select().from(rsvps).where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.userId, guestUserId)));
    if (!rsvp || rsvp.status === "out") return { ok: false, error: "slot_lost" };

    await tx.update(users).set({ displayName, updatedAt: now.getTime() }).where(eq(users.id, guestUserId));
    if (rsvp.holdExpiresAt) {
      await tx.update(rsvps).set({ holdExpiresAt: null }).where(eq(rsvps.id, rsvp.id));
    }

    const [session] = await tx.select({ circleId: sessions.circleId }).from(sessions).where(eq(sessions.id, sessionId));
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
export async function getGuestUserId(db: CuatroDb, rawToken: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id, isGuest: users.isGuest })
    .from(users)
    .where(eq(users.guestClaimTokenHash, hashGuestToken(rawToken)));
  return row?.isGuest ? row.id : null;
}

export type JoinGuestCircleOutcome =
  | { ok: true; guestUserId: string; token: string | null; circleId: string; circleName: string; displayName: string }
  | { ok: false; error: "invalid_name" | "circle_not_found" | "circle_full" };

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
export async function joinGuestCircle(
  db: CuatroDb,
  { inviteCode, rawName, existingGuestUserId }: { inviteCode: string; rawName: string; existingGuestUserId?: string | null },
  now: Date = new Date(),
): Promise<JoinGuestCircleOutcome> {
  const displayName = normalizeGuestName(rawName);
  if (!displayName) return { ok: false, error: "invalid_name" };

  const [circle] = await db.select().from(circles).where(eq(circles.inviteCode, inviteCode));
  if (!circle) return { ok: false, error: "circle_not_found" };

  const rawToken = mintGuestToken();
  const tokenHash = hashGuestToken(rawToken);

  try {
    return await db.transaction(async (tx): Promise<JoinGuestCircleOutcome> => {
      const [existing] = existingGuestUserId
        ? await tx.select().from(users).where(eq(users.id, existingGuestUserId))
        : [undefined];
      const reuse = existing?.isGuest ? existing : null;

      let guestUserId: string;
      let token: string | null;
      if (reuse) {
        await tx.update(users).set({ displayName, updatedAt: now.getTime() }).where(eq(users.id, reuse.id));
        guestUserId = reuse.id;
        token = null; // the device cookie already carries this identity
      } else {
        const [guest] = await tx
          .insert(users)
          .values({ displayName, isGuest: true, guestClaimTokenHash: tokenHash, countryCode: circle.countryCode })
          .returning();
        guestUserId = guest.id;
        token = rawToken;
      }

      // Shared membership path — enforces the Circle's capacity in this same
      // transaction. A full capped Circle throws CircleFullError, rolling back
      // the whole join (including a freshly-minted guest row), caught below.
      await insertCircleMembership(tx, circle.id, guestUserId);

      return { ok: true, guestUserId, token, circleId: circle.id, circleName: circle.name, displayName };
    });
  } catch (err) {
    if (err instanceof CircleFullError) return { ok: false, error: "circle_full" };
    throw err;
  }
}

/** The guest's displayName if `guestUserId` is already a member of `circleId`, else null — the /join/[code] page's "is this guest in yet?" check that picks the done-vs-join step. */
export async function getGuestMembership(db: CuatroDb, guestUserId: string, circleId: string): Promise<{ displayName: string } | null> {
  const [row] = await db
    .select({ displayName: users.displayName })
    .from(circleMembers)
    .innerJoin(users, eq(circleMembers.userId, users.id))
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, guestUserId), eq(users.isGuest, true)));
  return row ? { displayName: row.displayName } : null;
}

export type ConvertGuestResult =
  | { converted: true; merged: boolean; carriedName: string | null }
  | { converted: false; reason: "not_a_guest" };

/** Marker written into a re-attributed rating_event's `factors` jsonb when the guest AND the surviving account both had a rating trajectory. It flags the row as historical provenance, not part of the account's LIVE trajectory, so matches-db.ts's loadPlayerState can exclude it when computing the account's current internal rating for its next game (see reattributeGuestData + the both-have-history note on convertGuestOnAuth). */
export const MERGED_FROM_GUEST_FACTOR_KEY = "mergedFromGuestUserId";

/**
 * Moves every trace of the guest identity `guestUserId` onto the surviving
 * account `resolvedUserId`, inside the caller's already-locked transaction.
 * `guest` is the locked guest row (its reliability counters + rating fields
 * are read from this snapshot).
 *
 * Union, never duplicate: relations with a uniqueness constraint that the
 * account might already satisfy (rsvps' (session,user); circle_members' PK;
 * match_reactions' (match,user,kind)) drop the guest's row on a clash and
 * move it otherwise. Relations with no such constraint (matches' four player
 * columns, match_comments, circle_messages, tab_entries, notifications,
 * rating_events) are re-attributed wholesale.
 *
 * The Ledger (rating_events) is APPEND-ONLY: rows are re-attributed (user_id
 * updated), never rewritten or deleted. The two-trajectory case additionally
 * stamps a `factors` provenance key (a jsonb note, not a schema change) — the
 * only permitted touch beyond user_id, and explicitly the honest mark the
 * ledger's own design note anticipates. Reliability counters
 * (rsvp/showUp/lateCancel) are additive, so they FOLD (survivor += guest);
 * the show-up-rate ratio stays exact because numerator and denominator move
 * together. Tab entries are money, not the Ledger: a debt the survivor would
 * now owe ITSELF (payer === debtor after the merge) is nonsense and deleted.
 *
 * Not touched, all because a guest structurally can never own one: circles
 * (guests can't create a Circle), match_confirmations (a seal needs a real
 * member; an all-guest team stays pending), and knocks (guests are excluded
 * from the discovery surfaces a knock comes from).
 */
async function reattributeGuestData(
  tx: CuatroDb,
  guest: typeof users.$inferSelect,
  resolvedUserId: string,
  nowMs: number,
): Promise<void> {
  const guestUserId = guest.id;

  // rsvps — unique(session_id, user_id): move, drop-on-clash.
  const guestRsvps = await tx.select().from(rsvps).where(eq(rsvps.userId, guestUserId));
  for (const row of guestRsvps) {
    const [clash] = await tx
      .select({ id: rsvps.id })
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, row.sessionId), eq(rsvps.userId, resolvedUserId)));
    if (clash) {
      await tx.delete(rsvps).where(eq(rsvps.id, row.id));
    } else {
      await tx.update(rsvps).set({ userId: resolvedUserId }).where(eq(rsvps.id, row.id));
    }
  }

  // circle_members — PK(circle_id, user_id): move, drop-on-clash. Without this
  // a circle-join guest would fall OUT of the Circle they just joined the
  // instant they signed in (the device cookie is cleared, so the now-signed-in
  // account would not otherwise be in it).
  const guestMemberships = await tx.select().from(circleMembers).where(eq(circleMembers.userId, guestUserId));
  for (const row of guestMemberships) {
    const [clash] = await tx
      .select({ userId: circleMembers.userId })
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, row.circleId), eq(circleMembers.userId, resolvedUserId)));
    if (clash) {
      await tx.delete(circleMembers)
        .where(and(eq(circleMembers.circleId, row.circleId), eq(circleMembers.userId, guestUserId)));
    } else {
      await tx.update(circleMembers)
        .set({ userId: resolvedUserId })
        .where(and(eq(circleMembers.circleId, row.circleId), eq(circleMembers.userId, guestUserId)));
    }
  }

  // matches — no user-uniqueness constraint; the guest may sit in any of the
  // four player slots of any match (any status). Re-point each slot. A single
  // match holding the guest AND the account on different slots can't arise in
  // practice (one real person is one roster entry at record time).
  await tx.update(matches).set({ teamAPlayer1Id: resolvedUserId }).where(eq(matches.teamAPlayer1Id, guestUserId));
  await tx.update(matches).set({ teamAPlayer2Id: resolvedUserId }).where(eq(matches.teamAPlayer2Id, guestUserId));
  await tx.update(matches).set({ teamBPlayer1Id: resolvedUserId }).where(eq(matches.teamBPlayer1Id, guestUserId));
  await tx.update(matches).set({ teamBPlayer2Id: resolvedUserId }).where(eq(matches.teamBPlayer2Id, guestUserId));

  // match_reactions — unique(match_id, user_id, kind): move, drop-on-clash.
  const guestReactions = await tx.select().from(matchReactions).where(eq(matchReactions.userId, guestUserId));
  for (const row of guestReactions) {
    const [clash] = await tx
      .select({ id: matchReactions.id })
      .from(matchReactions)
      .where(and(eq(matchReactions.matchId, row.matchId), eq(matchReactions.userId, resolvedUserId), eq(matchReactions.kind, row.kind)));
    if (clash) {
      await tx.delete(matchReactions).where(eq(matchReactions.id, row.id));
    } else {
      await tx.update(matchReactions).set({ userId: resolvedUserId }).where(eq(matchReactions.id, row.id));
    }
  }

  // match_comments / circle_messages / notifications — no uniqueness on user;
  // authored content and the guest's own inbox move wholesale.
  await tx.update(matchComments).set({ userId: resolvedUserId }).where(eq(matchComments.userId, guestUserId));
  await tx.update(circleMessages).set({ userId: resolvedUserId }).where(eq(circleMessages.userId, guestUserId));
  await tx.update(notifications).set({ userId: resolvedUserId }).where(eq(notifications.userId, guestUserId));

  // tab_entries — re-point every user reference (payer, debtor, settled-by),
  // then delete any self-debt the merge just created (you can't owe yourself).
  await tx.update(tabEntries).set({ payerUserId: resolvedUserId }).where(eq(tabEntries.payerUserId, guestUserId));
  await tx.update(tabEntries).set({ debtorUserId: resolvedUserId }).where(eq(tabEntries.debtorUserId, guestUserId));
  await tx.update(tabEntries).set({ settledConfirmedBy: resolvedUserId }).where(eq(tabEntries.settledConfirmedBy, guestUserId));
  await tx.delete(tabEntries).where(and(eq(tabEntries.payerUserId, resolvedUserId), eq(tabEntries.debtorUserId, resolvedUserId)));

  // rating_events — THE LEDGER. Presence of any row is "has a rating
  // trajectory" (rating stays null through the Placement Trio, so users.rating
  // alone can't tell). Two shapes:
  const [{ n: accountEvents } = { n: 0 }] = await tx
    .select({ n: sql<number>`cast(count(*) as int)` })
    .from(ratingEvents)
    .where(eq(ratingEvents.userId, resolvedUserId));
  const [{ n: guestEvents } = { n: 0 }] = await tx
    .select({ n: sql<number>`cast(count(*) as int)` })
    .from(ratingEvents)
    .where(eq(ratingEvents.userId, guestUserId));

  if (guestEvents > 0 && accountEvents === 0) {
    // Account was Unrated with no history: adopt the guest's trajectory
    // wholesale. The re-attributed events become the account's own (unmarked),
    // and the mirrored users fields follow so loadPlayerState reads a coherent
    // state. placementPriorRating never clobbers an explicit import the account
    // already made.
    await tx.update(ratingEvents).set({ userId: resolvedUserId }).where(eq(ratingEvents.userId, guestUserId));
    await tx.update(users)
      .set({
        rating: guest.rating,
        confidence: guest.confidence,
        verifiedMatchCount: guest.verifiedMatchCount,
        placementPriorRating: sql`coalesce(${users.placementPriorRating}, ${guest.placementPriorRating})`,
        updatedAt: nowMs,
      })
      .where(eq(users.id, resolvedUserId));
  } else if (guestEvents > 0) {
    // Both identities have real history: re-attribution alone would interleave
    // two independent rating trajectories. Keep the account's trail as the LIVE
    // rating (its rating/confidence/verifiedMatchCount are left untouched; future
    // games absorb), and move the guest events with a provenance mark so they
    // stay visible in the Ledger history but never drive the live rating (the
    // matches-db.ts loadPlayerState filter — see the manifest — excludes marked
    // rows). The mark is a jsonb key added to factors: the only touch beyond
    // user_id, and append-only in spirit (nothing existing is rewritten).
    await tx.update(ratingEvents)
      .set({
        userId: resolvedUserId,
        factors: sql`${ratingEvents.factors} || jsonb_build_object(${MERGED_FROM_GUEST_FACTOR_KEY}::text, ${guestUserId}::text)`,
      })
      .where(eq(ratingEvents.userId, guestUserId));
  }

  // Reliability counters are additive — fold the guest's into the survivor's so
  // the show-up-rate ratio (showUp / rsvpIn) stays exact. Runs in every merge,
  // independent of the rating decision above.
  await tx.update(users)
    .set({
      rsvpInCount: sql`${users.rsvpInCount} + ${guest.rsvpInCount}`,
      showUpCount: sql`${users.showUpCount} + ${guest.showUpCount}`,
      lateCancelCount: sql`${users.lateCancelCount} + ${guest.lateCancelCount}`,
      updatedAt: nowMs,
    })
    .where(eq(users.id, resolvedUserId));
}

/**
 * The deferred signup, called additively from /auth/callback once
 * findOrCreateUserBySupabase has resolved `resolvedUserId` for the identity
 * that just signed in.
 *
 * Truth table (guestUserId = the row the cuatro_guest cookie resolves to;
 * resolvedUserId = the row Supabase provisioned/linked for the email):
 *  - guest row already converted (isGuest false) → { converted:false }: a
 *    no-op, which is exactly what makes a replayed callback (double-clicked
 *    magic link) safe — the husk below is left isGuest:false, so a second
 *    convert with the same ids short-circuits here.
 *  - resolvedUserId === guestUserId → CONVERT IN PLACE: no pre-existing
 *    account at that email, so flip the one row guest→real. Nothing to merge.
 *  - resolvedUserId !== guestUserId → MERGE: an email conflict — the identity
 *    resolved onto a DIFFERENT, pre-existing account, which wins. The guest's
 *    entire trail (rsvps, memberships, matches, ledger, tab, comments, chat,
 *    notifications, reliability counters) moves onto that account via
 *    reattributeGuestData. The guest row becomes an emptied husk: isGuest is
 *    set false and its token hash cleared, mirroring the in-place path so the
 *    device cookie can never re-resolve it and a replay is a clean no-op.
 *
 * Rating on the surviving account (MERGE case), decided in reattributeGuestData:
 *  - account had no ledger events → adopt the guest's rating fields wholesale.
 *  - account AND guest both had events → keep the account's rating as the live
 *    trail; the guest's events move in marked as historical provenance.
 * The Ledger is never rewritten or deleted — only re-attributed (+ that mark).
 *
 * `carriedName`: the guest's chosen display name is carried onto the resolved
 * account when that account is still on an auto-derived (email local-part)
 * name — a magic-link sign-up that just provisioned. It never clobbers a real
 * chosen name on a pre-existing account. Returned so /auth/callback can decide
 * the first-run name step against the POST-conversion name, so a guest who
 * already named themselves isn't re-prompted with the wrong prefill.
 */
export async function convertGuestOnAuth(db: CuatroDb, guestUserId: string, resolvedUserId: string, now: Date = new Date()): Promise<ConvertGuestResult> {
  const nowMs = now.getTime();
  return db.transaction(async (tx): Promise<ConvertGuestResult> => {
    // Lock BOTH user rows up front, in a deterministic (id-sorted) order, so two
    // merges touching the same pair can never deadlock. The guest row's lock
    // also serialises the re-attribute-then-clear-token sequence against a
    // second conversion of the same guest identity.
    const lockIds = guestUserId === resolvedUserId ? [guestUserId] : [guestUserId, resolvedUserId].sort();
    for (const id of lockIds) {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, id)).for("update");
    }

    const [guest] = await tx.select().from(users).where(eq(users.id, guestUserId));
    if (!guest || !guest.isGuest) return { converted: false, reason: "not_a_guest" };

    const chosenName = guest.displayName !== GUEST_PLACEHOLDER_NAME ? guest.displayName : null;

    if (guestUserId === resolvedUserId) {
      await tx.update(users).set({ isGuest: false, guestClaimTokenHash: null, updatedAt: nowMs }).where(eq(users.id, guestUserId));
      return { converted: true, merged: false, carriedName: chosenName };
    }

    await reattributeGuestData(tx, guest, resolvedUserId, nowMs);

    let carriedName: string | null = null;
    if (chosenName) {
      const [resolved] = await tx
        .select({ displayName: users.displayName, email: users.email })
        .from(users)
        .where(eq(users.id, resolvedUserId));
      if (resolved && displayNameLooksDerived(resolved.displayName, resolved.email)) {
        await tx.update(users).set({ displayName: chosenName, updatedAt: nowMs }).where(eq(users.id, resolvedUserId));
        carriedName = chosenName;
      }
    }

    // Emptied husk: guest→not-guest AND token cleared. isGuest:false is what
    // makes a replay short-circuit at the not_a_guest guard above, and stops
    // any old link/cookie from resurrecting the drained row as a live guest.
    await tx.update(users).set({ isGuest: false, guestClaimTokenHash: null, updatedAt: nowMs }).where(eq(users.id, guestUserId));
    return { converted: true, merged: true, carriedName };
  });
}
