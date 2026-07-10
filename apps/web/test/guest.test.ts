import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  createTestClient,
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
  tabs,
  users,
  type CuatroClient,
  type CuatroDb,
} from "@cuatro/db";
import { createMatchesStoreFromClient, type MatchesStore } from "@/server/matches-db";
import { getRing3ClaimLink, mintRing3ClaimToken } from "@/server/fourth-call";
import {
  GUEST_HOLD_MS,
  GUEST_PLACEHOLDER_NAME,
  MERGED_FROM_GUEST_FACTOR_KEY,
  claimGuestSlot,
  convertGuestOnAuth,
  getGuestMembership,
  getGuestUserId,
  hashGuestToken,
  joinGuestCircle,
  joinGuestReserveQueue,
  lockGuestName,
  normalizeGuestName,
} from "@/server/guest";
import { PLACEMENT_TRIO_SIZE } from "@cuatro/glass";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";

let client: CuatroClient;
let db: CuatroDb;
let n = 0;

beforeEach(async () => {
  client = await createTestClient();
  db = client.db;
  n = 0;
});

afterEach(async () => {
  await client.close();
  __setRealtimeSenderForTests(null);
});

async function seedUser(displayName = "Member") {
  n += 1;
  const [row] = await db.insert(users).values({ email: `u${n}@example.com`, displayName }).returning();
  return row;
}

async function seedCircle(createdBy: string) {
  const [row] = await db
    .insert(circles)
    .values({ name: `Circle ${++n}`, inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy })
    .returning();
  return row;
}

async function seedSession(circleId: string, opts: { slots?: number; startsAt?: Date } = {}) {
  let standingGameId: string | undefined;
  if (opts.slots) {
    const [sg] = await db.insert(standingGames).values({ circleId, weekday: 2, startTime: "20:00", slots: opts.slots }).returning();
    standingGameId = sg.id;
  }
  const [row] = await db
    .insert(sessions)
    .values({ circleId, standingGameId, startsAt: (opts.startsAt ?? new Date("2026-08-04T20:00:00.000Z")).getTime(), status: "upcoming" })
    .returning();
  return row;
}

async function rsvpConfirmed(sessionId: string, userId: string) {
  await db.insert(rsvps).values({ sessionId, userId, status: "in" });
}

describe("claimGuestSlot", () => {
  it("mints a fresh guest user and soft-holds the slot for GUEST_HOLD_MS", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const session = await seedSession(circle.id, { slots: 4 });
    await rsvpConfirmed(session.id, organiser.id);
    const link = await getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");

    const now = new Date("2026-08-01T00:00:00.000Z");
    const outcome = await claimGuestSlot(db, session.id, link.value.token, now);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.status).toBe("in");
    expect(outcome.holdExpiresAt.getTime()).toBe(now.getTime() + GUEST_HOLD_MS);

    const [guest] = await db.select().from(users).where(eq(users.id, outcome.guestUserId));
    expect(guest?.isGuest).toBe(true);
    expect(guest?.email).toBeNull();
    expect(guest?.displayName).toBe(GUEST_PLACEHOLDER_NAME);

    const [rsvp] = await db.select().from(rsvps).where(and(eq(rsvps.sessionId, session.id), eq(rsvps.userId, outcome.guestUserId)));
    expect(rsvp?.status).toBe("in");
    expect(rsvp?.source).toBe("guest_link");
    expect(rsvp?.holdExpiresAt).toBe(now.getTime() + GUEST_HOLD_MS);
  });

  it("rejects a token signed for a different session", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const session = await seedSession(circle.id, { slots: 4 });
    const otherSession = await seedSession(circle.id, { slots: 4 });
    const wrongToken = mintRing3ClaimToken(otherSession.id, new Date(session.startsAt));

    const outcome = await claimGuestSlot(db, session.id, wrongToken);
    expect(outcome).toEqual({ ok: false, error: "invalid_link" });
  });

  it("rejects a claim on a session that's no longer upcoming", async () => {
    // A ring-3 token's own expiry is always the session's startsAt (see
    // getRing3ClaimLink's comment in server/fourth-call.ts), so "the
    // session has started" reads as an expired (invalid_link) token before
    // claimGuestSlot's own session_started check would ever run — the same
    // is true of claimFourthCallSlot's ring3Token path. A cancelled session
    // still within its token's validity window is what actually exercises
    // that branch.
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const session = await seedSession(circle.id, { slots: 4, startsAt: new Date("2026-08-01T20:00:00.000Z") });
    await db.update(sessions).set({ status: "cancelled" }).where(eq(sessions.id, session.id));
    const token = mintRing3ClaimToken(session.id, new Date(session.startsAt));

    const outcome = await claimGuestSlot(db, session.id, token, new Date("2026-08-01T00:00:00.000Z"));
    expect(outcome).toEqual({ ok: false, error: "session_started" });
  });

  it("the race: two claim attempts on the last open slot — one wins, the other loses", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const session = await seedSession(circle.id, { slots: 4 });
    await rsvpConfirmed(session.id, organiser.id);
    await rsvpConfirmed(session.id, (await seedUser()).id);
    await rsvpConfirmed(session.id, (await seedUser()).id); // 3 of 4 held — one slot left
    const link = await getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");

    const first = await claimGuestSlot(db, session.id, link.value.token);
    const second = await claimGuestSlot(db, session.id, link.value.token);

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: "already_full" });
  });

  it("an expired hold frees the slot for the next claimant", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const session = await seedSession(circle.id, { slots: 1 });
    const link = await getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");

    const claimedAt = new Date("2026-08-01T00:00:00.000Z");
    const first = await claimGuestSlot(db, session.id, link.value.token, claimedAt);
    expect(first.ok).toBe(true);

    // Still within the 5:00 hold — the slot reads as taken.
    const stillHeld = await claimGuestSlot(db, session.id, link.value.token, new Date(claimedAt.getTime() + GUEST_HOLD_MS - 1000));
    expect(stillHeld).toEqual({ ok: false, error: "already_full" });

    // Past the hold — a fresh claimant sweeps the abandoned hold and takes it.
    const afterExpiry = new Date(claimedAt.getTime() + GUEST_HOLD_MS + 1000);
    const second = await claimGuestSlot(db, session.id, link.value.token, afterExpiry);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.guestUserId).not.toBe(first.guestUserId);

    const [abandonedRsvp] = await db.select().from(rsvps).where(and(eq(rsvps.sessionId, session.id), eq(rsvps.userId, first.guestUserId)));
    expect(abandonedRsvp?.status).toBe("out");
  });
});

describe("lockGuestName", () => {
  it("sets the guest's real first name and clears the hold", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const session = await seedSession(circle.id, { slots: 4 });
    const link = await getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");
    const claim = await claimGuestSlot(db, session.id, link.value.token);
    if (!claim.ok) throw new Error("expected claim");

    const outcome = await lockGuestName(db, claim.guestUserId, session.id, "  Alex  ");
    expect(outcome).toEqual({ ok: true, displayName: "Alex" });

    const [guest] = await db.select().from(users).where(eq(users.id, claim.guestUserId));
    expect(guest?.displayName).toBe("Alex");

    const [rsvp] = await db.select().from(rsvps).where(and(eq(rsvps.sessionId, session.id), eq(rsvps.userId, claim.guestUserId)));
    expect(rsvp?.holdExpiresAt).toBeNull();
    expect(rsvp?.status).toBe("in");
  });

  it("rejects an empty name", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const session = await seedSession(circle.id, { slots: 4 });
    const link = await getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");
    const claim = await claimGuestSlot(db, session.id, link.value.token);
    if (!claim.ok) throw new Error("expected claim");

    expect(await lockGuestName(db, claim.guestUserId, session.id, "   ")).toEqual({ ok: false, error: "invalid_name" });
  });

  it("reports slot_lost once a contending claim has swept the expired hold away", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const session = await seedSession(circle.id, { slots: 1 });
    const link = await getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");

    const claimedAt = new Date("2026-08-01T00:00:00.000Z");
    const first = await claimGuestSlot(db, session.id, link.value.token, claimedAt);
    if (!first.ok) throw new Error("expected claim");

    // A second claimant shows up after the hold lapsed and takes the slot.
    await claimGuestSlot(db, session.id, link.value.token, new Date(claimedAt.getTime() + GUEST_HOLD_MS + 1000));

    // The original (slow-typing) guest now tries to lock in — too late.
    const outcome = await lockGuestName(db, first.guestUserId, session.id, "Alex");
    expect(outcome).toEqual({ ok: false, error: "slot_lost" });
  });
});

describe("joinGuestReserveQueue", () => {
  it("queues a fresh guest behind any existing reserves", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const session = await seedSession(circle.id, { slots: 4 });
    await db.insert(rsvps).values({ sessionId: session.id, userId: (await seedUser()).id, status: "reserve", position: 1 });
    const link = await getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");

    const outcome = await joinGuestReserveQueue(db, session.id, link.value.token);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.position).toBe(2);

    const [rsvp] = await db.select().from(rsvps).where(and(eq(rsvps.sessionId, session.id), eq(rsvps.userId, outcome.guestUserId)));
    expect(rsvp?.status).toBe("reserve");
    expect(rsvp?.source).toBe("guest_link");
  });
});

describe("getGuestUserId", () => {
  it("resolves a raw token to its guest user id, and rejects a wrong token", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const session = await seedSession(circle.id, { slots: 4 });
    const link = await getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");
    const claim = await claimGuestSlot(db, session.id, link.value.token);
    if (!claim.ok) throw new Error("expected claim");

    expect(await getGuestUserId(db, claim.token)).toBe(claim.guestUserId);
    expect(await getGuestUserId(db, "not-a-real-token")).toBeNull();
  });

  it("stores only the hash, never the raw token", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const session = await seedSession(circle.id, { slots: 4 });
    const link = await getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");
    const claim = await claimGuestSlot(db, session.id, link.value.token);
    if (!claim.ok) throw new Error("expected claim");

    const [guest] = await db.select().from(users).where(eq(users.id, claim.guestUserId));
    expect(guest?.guestClaimTokenHash).toBe(hashGuestToken(claim.token));
    expect(guest?.guestClaimTokenHash).not.toBe(claim.token);
  });
});

describe("convertGuestOnAuth", () => {
  it("flips a guest row to a real account in place when there's no pre-existing account", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const session = await seedSession(circle.id, { slots: 4 });
    const link = await getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");
    const claim = await claimGuestSlot(db, session.id, link.value.token);
    if (!claim.ok) throw new Error("expected claim");
    await lockGuestName(db, claim.guestUserId, session.id, "Alex");

    const result = await convertGuestOnAuth(db, claim.guestUserId, claim.guestUserId);
    expect(result).toEqual({ converted: true, merged: false, carriedName: "Alex" });

    const [converted] = await db.select().from(users).where(eq(users.id, claim.guestUserId));
    expect(converted?.isGuest).toBe(false);
    expect(converted?.guestClaimTokenHash).toBeNull();
    expect(converted?.displayName).toBe("Alex");

    // The stale device cookie can never resolve to this row again.
    expect(await getGuestUserId(db, claim.token)).toBeNull();
  });

  it("email conflict: re-points the guest's rsvps onto the pre-existing account", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const session = await seedSession(circle.id, { slots: 4 });
    const existingAccount = await seedUser("Alex (existing)");
    const link = await getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");
    const claim = await claimGuestSlot(db, session.id, link.value.token);
    if (!claim.ok) throw new Error("expected claim");
    await lockGuestName(db, claim.guestUserId, session.id, "Alex");

    const result = await convertGuestOnAuth(db, claim.guestUserId, existingAccount.id);
    // The pre-existing account already has a real (non-derived) chosen name,
    // so the guest's name is NOT carried over — carriedName stays null.
    expect(result).toEqual({ converted: true, merged: true, carriedName: null });

    const rsvp = (await db.select().from(rsvps).where(eq(rsvps.sessionId, session.id))).find((r) => r.userId === existingAccount.id);
    expect(rsvp?.status).toBe("in");

    const [guestRow] = await db.select().from(users).where(eq(users.id, claim.guestUserId));
    expect(guestRow?.guestClaimTokenHash).toBeNull();
    // The merge rule scopes to rsvps only — the now-inert guest row is left
    // in place, not deleted (see server/guest.ts's convertGuestOnAuth doc).
    expect(guestRow).not.toBeNull();
  });

  it("email conflict with a session the resolved account already holds: the resolved account's row wins, the guest's is dropped", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const session = await seedSession(circle.id, { slots: 4 });
    const existingAccount = await seedUser("Alex (existing)");
    await rsvpConfirmed(session.id, existingAccount.id);

    const link = await getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");
    // A second slot for the guest to have claimed independently before converting.
    const secondSession = await seedSession(circle.id, { slots: 4 });
    const secondLink = await getRing3ClaimLink(db, secondSession.id);
    if (!secondLink.ok) throw new Error("expected link");

    const claimA = await claimGuestSlot(db, session.id, link.value.token);
    if (!claimA.ok) throw new Error("expected claim");
    // Same guest device also claims the OTHER session before converting —
    // simulated here by reusing the same guest user id for a second rsvp.
    await db.insert(rsvps).values({ sessionId: secondSession.id, userId: claimA.guestUserId, status: "in", source: "guest_link" });

    await convertGuestOnAuth(db, claimA.guestUserId, existingAccount.id);

    const rowsForSession = await db.select().from(rsvps).where(eq(rsvps.sessionId, session.id));
    // The guest's own rsvp for `session` was dropped (existingAccount already had one).
    expect(rowsForSession.find((r) => r.userId === claimA.guestUserId)).toBeUndefined();
    expect(rowsForSession.find((r) => r.userId === existingAccount.id)?.status).toBe("in");

    // The guest's OTHER rsvp (no clash there) was re-pointed onto the resolved account.
    const rowsForSecondSession = await db.select().from(rsvps).where(eq(rsvps.sessionId, secondSession.id));
    expect(rowsForSecondSession.find((r) => r.userId === existingAccount.id)).toBeTruthy();
  });

  it("reports not_a_guest for a normal user id", async () => {
    const alex = await seedUser("Alex");
    const bob = await seedUser("Bob");
    expect(await convertGuestOnAuth(db, alex.id, bob.id)).toEqual({ converted: false, reason: "not_a_guest" });
  });

  it("carries the guest's chosen name onto a freshly provisioned (email-derived) account", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const join = await joinGuestCircle(db, { inviteCode: circle.inviteCode, rawName: "Pete" });
    if (!join.ok) throw new Error("expected join");

    // A brand-new magic-link account whose displayName is still the email
    // local-part (auth-store's deriveDisplayName) — the exact case F6 targets.
    const [fresh] = await db.insert(users).values({ email: "pete@example.com", displayName: "pete" }).returning();

    const result = await convertGuestOnAuth(db, join.guestUserId, fresh.id);
    expect(result).toEqual({ converted: true, merged: true, carriedName: "Pete" });

    const [account] = await db.select().from(users).where(eq(users.id, fresh.id));
    expect(account?.displayName).toBe("Pete");
  });

  it("re-points a circle-join guest's membership onto the resolved account (move, no clash)", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const join = await joinGuestCircle(db, { inviteCode: circle.inviteCode, rawName: "Pete" });
    if (!join.ok) throw new Error("expected join");
    const account = await seedUser("Pete (existing)");

    await convertGuestOnAuth(db, join.guestUserId, account.id);

    // The membership moved to the resolved account; the guest no longer holds one.
    const [accountMembership] = await db
      .select()
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, circle.id), eq(circleMembers.userId, account.id)))
      ;
    expect(accountMembership).toBeTruthy();
    const [guestMembership] = await db
      .select()
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, circle.id), eq(circleMembers.userId, join.guestUserId)))
      ;
    expect(guestMembership).toBeUndefined();
  });

  it("drops the guest's membership when the resolved account is already in that circle", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const account = await seedUser("Pete (existing)");
    await db.insert(circleMembers).values({ circleId: circle.id, userId: account.id, role: "member" });

    const join = await joinGuestCircle(db, { inviteCode: circle.inviteCode, rawName: "Pete" });
    if (!join.ok) throw new Error("expected join");

    await convertGuestOnAuth(db, join.guestUserId, account.id);

    // Exactly one membership for this circle+account (no PK collision thrown),
    // and the guest's row is gone.
    const [guestMembership] = await db
      .select()
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, circle.id), eq(circleMembers.userId, join.guestUserId)))
      ;
    expect(guestMembership).toBeUndefined();
    const [accountMembership] = await db
      .select()
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, circle.id), eq(circleMembers.userId, account.id)))
      ;
    expect(accountMembership?.role).toBe("member");
  });
});

// --- Full merge (V1-READINESS #11): a guest claimed into an EXISTING account.
// These build their trail on `db` directly, and (where a real Ledger is needed)
// through a MatchesStore sharing the same client so rating_events are genuine.
async function seedGuestRow(target: CuatroDb, displayName = GUEST_PLACEHOLDER_NAME) {
  n += 1;
  const [row] = await target
    .insert(users)
    .values({ displayName, isGuest: true, guestClaimTokenHash: `hash-${n}-${Math.random().toString(36).slice(2)}` })
    .returning();
  return row;
}
async function seedRealUserOn(target: CuatroDb, displayName: string) {
  n += 1;
  const [row] = await target.insert(users).values({ email: `real${n}@example.com`, displayName }).returning();
  return row;
}
async function seedCircleOn(target: CuatroDb, createdBy: string) {
  n += 1;
  const [row] = await target
    .insert(circles)
    .values({ name: `Circle ${n}`, inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy })
    .returning();
  return row;
}
/** Plays one verified match through the real Glass pipeline (both teams sealed), so every player on it gains a genuine rating_events row. `sealBy` must be a real member of teamB. */
async function playVerifiedMatch(
  store: MatchesStore,
  target: CuatroDb,
  circleId: string,
  teamA: [string, string],
  teamB: [string, string],
  sealBy: string,
) {
  n += 1;
  const [session] = await target
    .insert(sessions)
    .values({ circleId, startsAt: new Date("2026-08-01T18:00:00.000Z").getTime() + n * 3_600_000, status: "played" })
    .returning();
  const { matchId } = await store.recordMatch({
    sessionId: session.id,
    reporterId: teamA[0],
    teamA,
    teamB,
    sets: [{ a: 6, b: 2 }],
  });
  const outcome = await store.confirmMatch(matchId, sealBy);
  return { matchId, sessionId: session.id, outcome };
}

describe("convertGuestOnAuth — merge into an existing account", () => {
  it("moves match participations, tab entries, comments, chat, reactions and notifications; dedupes memberships; deletes self-debt", async () => {
    const store = createMatchesStoreFromClient(await createTestClient());
    try {
      const sdb = store.db;
      const account = await seedRealUserOn(sdb, "Alex (existing)");
      const partner = await seedRealUserOn(sdb, "Partner");
      const opp1 = await seedRealUserOn(sdb, "Opp1");
      const opp2 = await seedRealUserOn(sdb, "Opp2");
      const guest = await seedGuestRow(sdb, "Alex (guest)");
      const circle = await seedCircleOn(sdb, account.id);

      // The guest PLAYED a verified match (guest as reporter on team A).
      const { matchId } = await playVerifiedMatch(store, sdb, circle.id, [guest.id, partner.id], [opp1.id, opp2.id], opp1.id);

      // A circle the guest is in but the account is not (moves), and one they
      // both are in (dedupes to a single account row).
      const soloCircle = await seedCircleOn(sdb, account.id);
      await sdb.insert(circleMembers).values({ circleId: soloCircle.id, userId: guest.id, role: "member" });
      const sharedCircle = await seedCircleOn(sdb, account.id);
      await sdb.insert(circleMembers).values({ circleId: sharedCircle.id, userId: account.id, role: "organiser" });
      await sdb.insert(circleMembers).values({ circleId: sharedCircle.id, userId: guest.id, role: "member" });

      // Guest-authored content + a reaction the account already made (dedupe).
      await sdb.insert(matchComments).values({ matchId, userId: guest.id, body: "gg" });
      await sdb.insert(circleMessages).values({ circleId: circle.id, userId: guest.id, body: "hi all" });
      await sdb.insert(matchReactions).values({ matchId, userId: account.id, kind: "respect" });
      await sdb.insert(matchReactions).values({ matchId, userId: guest.id, kind: "respect" });

      // Tab: the guest OWES the organiser (moves), and a to-be self-debt where
      // the account paid and the guest owed (payer===debtor after merge → gone).
      const [tab] = await sdb.insert(tabs).values({ circleId: circle.id }).returning();
      await sdb.insert(tabEntries).values({ tabId: tab.id, payerUserId: partner.id, debtorUserId: guest.id, amountMinor: 500 });
      await sdb.insert(tabEntries).values({ tabId: tab.id, payerUserId: account.id, debtorUserId: guest.id, amountMinor: 700 });

      const result = await convertGuestOnAuth(sdb, guest.id, account.id);
      expect(result.converted).toBe(true);
      if (!result.converted) return;
      expect(result.merged).toBe(true);

      // Match participation re-pointed to the account.
      const [matchRow] = await sdb.select().from(matches).where(eq(matches.id, matchId));
      expect(matchRow?.teamAPlayer1Id).toBe(account.id);

      // Memberships: moved for the solo circle, deduped for the shared one.
      const soloMembers = await sdb.select().from(circleMembers).where(eq(circleMembers.circleId, soloCircle.id));
      expect(soloMembers.map((m) => m.userId)).toEqual([account.id]);
      const sharedMembers = await sdb.select().from(circleMembers).where(eq(circleMembers.circleId, sharedCircle.id));
      expect(sharedMembers.filter((m) => m.userId === account.id)).toHaveLength(1);
      expect(sharedMembers.find((m) => m.userId === guest.id)).toBeUndefined();
      expect(sharedMembers.find((m) => m.userId === account.id)?.role).toBe("organiser");

      // Content moved; the reaction deduped to the single pre-existing account row.
      expect((await sdb.select().from(matchComments).where(eq(matchComments.matchId, matchId)))[0]?.userId).toBe(account.id);
      expect((await sdb.select().from(circleMessages).where(eq(circleMessages.circleId, circle.id)))[0]?.userId).toBe(account.id);
      const reactions = await sdb.select().from(matchReactions).where(eq(matchReactions.matchId, matchId));
      expect(reactions).toHaveLength(1);
      expect(reactions[0]?.userId).toBe(account.id);

      // Notifications from the played match followed the guest onto the account.
      const guestNotifs = await sdb.select().from(notifications).where(eq(notifications.userId, guest.id));
      expect(guestNotifs).toHaveLength(0);
      expect((await sdb.select().from(notifications).where(eq(notifications.userId, account.id))).length).toBeGreaterThan(0);

      // Tab: the real debt moved; the self-debt was deleted.
      const entries = await sdb.select().from(tabEntries).where(eq(tabEntries.tabId, tab.id));
      expect(entries).toHaveLength(1);
      expect(entries[0]?.debtorUserId).toBe(account.id);
      expect(entries[0]?.amountMinor).toBe(500);

      // The husk: drained, no longer a guest, cannot resurrect.
      const [husk] = await sdb.select().from(users).where(eq(users.id, guest.id));
      expect(husk?.isGuest).toBe(false);
      expect(husk?.guestClaimTokenHash).toBeNull();
    } finally {
      await store.close();
    }
  });

  it("adopts the guest's rating trajectory wholesale when the account had no Ledger history", async () => {
    const store = createMatchesStoreFromClient(await createTestClient());
    try {
      const sdb = store.db;
      const account = await seedRealUserOn(sdb, "Alex (existing, unrated)");
      const partner = await seedRealUserOn(sdb, "Partner");
      const opp1 = await seedRealUserOn(sdb, "Opp1");
      const opp2 = await seedRealUserOn(sdb, "Opp2");
      const guest = await seedGuestRow(sdb, "Alex (guest)");
      const circle = await seedCircleOn(sdb, account.id);

      await playVerifiedMatch(store, sdb, circle.id, [guest.id, partner.id], [opp1.id, opp2.id], opp1.id);
      const [guestBefore] = await sdb.select().from(users).where(eq(users.id, guest.id));
      expect(guestBefore?.verifiedMatchCount).toBe(1);

      await convertGuestOnAuth(sdb, guest.id, account.id);

      const [accountAfter] = await sdb.select().from(users).where(eq(users.id, account.id));
      // Rating fields adopted from the guest wholesale.
      expect(accountAfter?.verifiedMatchCount).toBe(guestBefore!.verifiedMatchCount);
      expect(accountAfter?.confidence).toBe(guestBefore!.confidence);
      expect(accountAfter?.rating).toBe(guestBefore!.rating); // null: still 1 of 3

      // The guest's Ledger events are now the account's — and UNMARKED (they
      // are the account's own trajectory, not merged-in provenance).
      const accountEvents = await sdb.select().from(ratingEvents).where(eq(ratingEvents.userId, account.id));
      expect(accountEvents).toHaveLength(1);
      expect((accountEvents[0]!.factors as Record<string, unknown>)[MERGED_FROM_GUEST_FACTOR_KEY]).toBeUndefined();
    } finally {
      await store.close();
    }
  });

  it("keeps the account's rating as the live trail and marks the guest's Ledger events when BOTH have history", async () => {
    const store = createMatchesStoreFromClient(await createTestClient());
    try {
      const sdb = store.db;
      const account = await seedRealUserOn(sdb, "Alex (existing, rated)");
      const aPartner = await seedRealUserOn(sdb, "A-Partner");
      const aOpp1 = await seedRealUserOn(sdb, "A-Opp1");
      const aOpp2 = await seedRealUserOn(sdb, "A-Opp2");
      const guest = await seedGuestRow(sdb, "Alex (guest)");
      const gPartner = await seedRealUserOn(sdb, "G-Partner");
      const gOpp1 = await seedRealUserOn(sdb, "G-Opp1");
      const gOpp2 = await seedRealUserOn(sdb, "G-Opp2");
      const circle = await seedCircleOn(sdb, account.id);

      // The account has its OWN history.
      const accountMatch = await playVerifiedMatch(store, sdb, circle.id, [account.id, aPartner.id], [aOpp1.id, aOpp2.id], aOpp1.id);
      const accountEventBefore = (await sdb.select().from(ratingEvents).where(eq(ratingEvents.userId, account.id)))[0]!;
      const [accountBefore] = await sdb.select().from(users).where(eq(users.id, account.id));

      // The guest has a separate trajectory.
      await playVerifiedMatch(store, sdb, circle.id, [guest.id, gPartner.id], [gOpp1.id, gOpp2.id], gOpp1.id);
      const guestEvent = (await sdb.select().from(ratingEvents).where(eq(ratingEvents.userId, guest.id)))[0]!;

      await convertGuestOnAuth(sdb, guest.id, account.id);

      // The account's live rating is untouched.
      const [accountAfter] = await sdb.select().from(users).where(eq(users.id, account.id));
      expect(accountAfter?.rating).toBe(accountBefore!.rating);
      expect(accountAfter?.confidence).toBe(accountBefore!.confidence);
      expect(accountAfter?.verifiedMatchCount).toBe(accountBefore!.verifiedMatchCount);

      // Both events now belong to the account; the guest's is marked, the
      // account's own is not (append-only: neither was rewritten).
      const accountEvents = await sdb.select().from(ratingEvents).where(eq(ratingEvents.userId, account.id));
      expect(accountEvents).toHaveLength(2);
      const moved = accountEvents.find((e) => e.id === guestEvent.id)!;
      const own = accountEvents.find((e) => e.id === accountEventBefore.id)!;
      expect((moved.factors as Record<string, unknown>)[MERGED_FROM_GUEST_FACTOR_KEY]).toBe(guest.id);
      expect((own.factors as Record<string, unknown>)[MERGED_FROM_GUEST_FACTOR_KEY]).toBeUndefined();
      expect(own.ratingAfter).toBe(accountEventBefore.ratingAfter); // untouched
    } finally {
      await store.close();
    }
  });

  it("folds the guest's Reliability counters into the surviving account", async () => {
    const account = await seedUser("Alex (existing)");
    await db.update(users).set({ rsvpInCount: 4, showUpCount: 3, lateCancelCount: 1 }).where(eq(users.id, account.id));
    const guest = await seedGuestRow(db, "Alex (guest)");
    await db.update(users).set({ rsvpInCount: 2, showUpCount: 1, lateCancelCount: 0 }).where(eq(users.id, guest.id));

    await convertGuestOnAuth(db, guest.id, account.id);

    const [after] = await db.select().from(users).where(eq(users.id, account.id));
    expect(after?.rsvpInCount).toBe(6);
    expect(after?.showUpCount).toBe(4);
    expect(after?.lateCancelCount).toBe(1);
  });

  it("is idempotent: replaying the conversion never double-merges", async () => {
    const account = await seedUser("Alex (existing)");
    await db.update(users).set({ rsvpInCount: 4, showUpCount: 3 }).where(eq(users.id, account.id));
    const guest = await seedGuestRow(db, "Alex (guest)");
    await db.update(users).set({ rsvpInCount: 2, showUpCount: 1 }).where(eq(users.id, guest.id));

    const first = await convertGuestOnAuth(db, guest.id, account.id);
    expect(first.converted).toBe(true);

    // A double-clicked magic link replays the callback with the same ids.
    const second = await convertGuestOnAuth(db, guest.id, account.id);
    expect(second).toEqual({ converted: false, reason: "not_a_guest" });

    // Counters folded exactly once.
    const [after] = await db.select().from(users).where(eq(users.id, account.id));
    expect(after?.rsvpInCount).toBe(6);
    expect(after?.showUpCount).toBe(4);
  });

  it("a converted guest's ring-3 claim link still resolves for the next visitor, and the drained husk cookie cannot", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const session = await seedSession(circle.id, { slots: 4 });
    const existingAccount = await seedUser("Alex (existing)");
    const link = await getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");
    const claim = await claimGuestSlot(db, session.id, link.value.token);
    if (!claim.ok) throw new Error("expected claim");

    await convertGuestOnAuth(db, claim.guestUserId, existingAccount.id);

    // The husk's old device cookie can never resolve again.
    expect(await getGuestUserId(db, claim.token)).toBeNull();

    // The ring-3 LINK (bound to the session, not the guest) still works: the
    // next person who taps it claims a fresh slot.
    const nextClaim = await claimGuestSlot(db, session.id, link.value.token);
    expect(nextClaim.ok).toBe(true);
    if (!nextClaim.ok) return;
    expect(nextClaim.guestUserId).not.toBe(claim.guestUserId);
  });
});

describe("joinGuestCircle", () => {
  it("mints a guest user with the chosen name and a real circle_members row", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);

    const outcome = await joinGuestCircle(db, { inviteCode: circle.inviteCode, rawName: "  Alex  " });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.displayName).toBe("Alex");
    expect(outcome.token).toBeTruthy();
    expect(outcome.circleId).toBe(circle.id);

    const [guest] = await db.select().from(users).where(eq(users.id, outcome.guestUserId));
    expect(guest?.isGuest).toBe(true);
    expect(guest?.email).toBeNull();
    expect(guest?.displayName).toBe("Alex");

    // The device cookie resolves to this guest, and they're a real member.
    expect(await getGuestUserId(db, outcome.token!)).toBe(outcome.guestUserId);
    const [membership] = await db
      .select()
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, circle.id), eq(circleMembers.userId, outcome.guestUserId)))
      ;
    expect(membership?.role).toBe("member");
  });

  it("rejects an empty name and an unknown invite code", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    expect(await joinGuestCircle(db, { inviteCode: circle.inviteCode, rawName: "   " })).toEqual({ ok: false, error: "invalid_name" });
    expect(await joinGuestCircle(db, { inviteCode: "NOPE", rawName: "Alex" })).toEqual({ ok: false, error: "circle_not_found" });
  });

  it("reuses an existing guest identity for the device rather than minting a second row", async () => {
    const organiser = await seedUser("Organiser");
    const circleA = await seedCircle(organiser.id);
    const circleB = await seedCircle(organiser.id);

    const first = await joinGuestCircle(db, { inviteCode: circleA.inviteCode, rawName: "Alex" });
    if (!first.ok) throw new Error("expected first join");

    // Same device (existingGuestUserId) opens a second circle invite.
    const second = await joinGuestCircle(db, {
      inviteCode: circleB.inviteCode,
      rawName: "Alex",
      existingGuestUserId: first.guestUserId,
    });
    if (!second.ok) throw new Error("expected second join");

    // Same guest row reused; no fresh token to set (cookie already carries it).
    expect(second.guestUserId).toBe(first.guestUserId);
    expect(second.token).toBeNull();

    // One guest identity, member of BOTH circles.
    expect((await getGuestMembership(db, first.guestUserId, circleA.id))?.displayName).toBe("Alex");
    expect((await getGuestMembership(db, first.guestUserId, circleB.id))?.displayName).toBe("Alex");
  });
});

describe("getGuestMembership", () => {
  it("returns the guest's name when a member, null otherwise", async () => {
    const organiser = await seedUser("Organiser");
    const circle = await seedCircle(organiser.id);
    const otherCircle = await seedCircle(organiser.id);
    const join = await joinGuestCircle(db, { inviteCode: circle.inviteCode, rawName: "Alex" });
    if (!join.ok) throw new Error("expected join");

    expect(await getGuestMembership(db, join.guestUserId, circle.id)).toEqual({ displayName: "Alex" });
    expect(await getGuestMembership(db, join.guestUserId, otherCircle.id)).toBeNull();
    // A normal (non-guest) member of the circle never resolves through this
    // guest-only helper (the isGuest filter, not just an absent membership row).
    await db.insert(circleMembers).values({ circleId: circle.id, userId: organiser.id, role: "organiser" });
    expect(await getGuestMembership(db, organiser.id, circle.id)).toBeNull();
  });
});

describe("normalizeGuestName", () => {
  it("trims and caps length, rejecting empty-after-trim", async () => {
    expect(normalizeGuestName("  Alex  ")).toBe("Alex");
    expect(normalizeGuestName("   ")).toBeNull();
    expect(normalizeGuestName("a".repeat(100))).toHaveLength(40);
  });
});

describe("a guest in a verified match", () => {
  it("flows through the Glass/Placement Trio pipeline exactly like any other player", async () => {
    const store: MatchesStore = createMatchesStoreFromClient(await createTestClient());
    try {
      const guestDb = store.db;
      const [organiser] = await guestDb.insert(users).values({ email: "organiser@example.com", displayName: "Organiser" }).returning();
      const [circle] = await guestDb
        .insert(circles)
        .values({ name: "Guest Test Circle", inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy: organiser.id })
        .returning()
        ;

      // A guest row exactly as claimGuestSlot would create one — no email,
      // isGuest true, still Unrated.
      const [guest] = await guestDb.insert(users).values({ displayName: "Guest", isGuest: true, guestClaimTokenHash: "abc" }).returning();
      const [partner] = await guestDb.insert(users).values({ email: "partner@example.com", displayName: "Partner" }).returning();
      const [opp1] = await guestDb.insert(users).values({ email: "opp1@example.com", displayName: "Opp1" }).returning();
      const [opp2] = await guestDb.insert(users).values({ email: "opp2@example.com", displayName: "Opp2" }).returning();

      const [session] = await guestDb
        .insert(sessions)
        .values({ circleId: circle.id, startsAt: new Date("2026-08-01T18:00:00.000Z").getTime(), status: "played" })
        .returning()
        ;

      const { matchId } = await store.recordMatch({
        sessionId: session.id,
        reporterId: guest.id,
        teamA: [guest.id, partner.id],
        teamB: [opp1.id, opp2.id],
        sets: [{ a: 6, b: 2 }],
      });
      const outcome = await store.confirmMatch(matchId, opp1.id);
      expect(outcome.status).toBe("verified");

      const [guestRow] = await guestDb.select().from(users).where(eq(users.id, guest.id));
      expect(guestRow!.verifiedMatchCount).toBe(1);
      expect(guestRow!.rating).toBeNull(); // still inside the Placement Trio (1 of 3)
      expect(guestRow!.email).toBeNull(); // never gained an email just by playing

      const matchRow = (await guestDb.select().from(matches).where(eq(matches.id, matchId)))[0];
      expect(matchRow!.status).toBe("verified");

      const verifiedNotifs = await guestDb.select().from(notifications).where(eq(notifications.type, "result_verified"));
      expect(verifiedNotifs.map((n) => n.userId)).toContain(guest.id);
      expect(guestRow!.verifiedMatchCount).toBeLessThan(PLACEMENT_TRIO_SIZE);
    } finally {
      await store.close();
    }
  });
});
