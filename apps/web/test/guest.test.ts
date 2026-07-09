import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  createClient,
  circles,
  matches,
  notifications,
  rsvps,
  sessions,
  standingGames,
  users,
  type CuatroClient,
  type CuatroDb,
} from "@cuatro/db";
import { createMatchesStore, type MatchesStore } from "@/server/matches-db";
import { getRing3ClaimLink, mintRing3ClaimToken } from "@/server/fourth-call";
import {
  GUEST_HOLD_MS,
  GUEST_PLACEHOLDER_NAME,
  claimGuestSlot,
  convertGuestOnAuth,
  getGuestUserId,
  hashGuestToken,
  joinGuestReserveQueue,
  lockGuestName,
  normalizeGuestName,
} from "@/server/guest";
import { PLACEMENT_TRIO_SIZE } from "@cuatro/glass";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";

let client: CuatroClient;
let db: CuatroDb;
let n = 0;

beforeEach(() => {
  client = createClient(":memory:");
  db = client.db;
  n = 0;
});

afterEach(() => {
  client.close();
  __setRealtimeSenderForTests(null);
});

function seedUser(displayName = "Member") {
  n += 1;
  return db.insert(users).values({ email: `u${n}@example.com`, displayName }).returning().get();
}

function seedCircle(createdBy: string) {
  return db
    .insert(circles)
    .values({ name: `Circle ${++n}`, inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy })
    .returning()
    .get();
}

function seedSession(circleId: string, opts: { slots?: number; startsAt?: Date } = {}) {
  let standingGameId: string | undefined;
  if (opts.slots) {
    const sg = db.insert(standingGames).values({ circleId, weekday: 2, startTime: "20:00", slots: opts.slots }).returning().get();
    standingGameId = sg.id;
  }
  return db
    .insert(sessions)
    .values({ circleId, standingGameId, startsAt: opts.startsAt ?? new Date("2026-08-04T20:00:00.000Z"), status: "upcoming" })
    .returning()
    .get();
}

function rsvpConfirmed(sessionId: string, userId: string) {
  db.insert(rsvps).values({ sessionId, userId, status: "in" }).run();
}

describe("claimGuestSlot", () => {
  it("mints a fresh guest user and soft-holds the slot for GUEST_HOLD_MS", () => {
    const organiser = seedUser("Organiser");
    const circle = seedCircle(organiser.id);
    const session = seedSession(circle.id, { slots: 4 });
    rsvpConfirmed(session.id, organiser.id);
    const link = getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");

    const now = new Date("2026-08-01T00:00:00.000Z");
    const outcome = claimGuestSlot(db, session.id, link.value.token, now);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.status).toBe("in");
    expect(outcome.holdExpiresAt.getTime()).toBe(now.getTime() + GUEST_HOLD_MS);

    const guest = db.select().from(users).where(eq(users.id, outcome.guestUserId)).get();
    expect(guest?.isGuest).toBe(true);
    expect(guest?.email).toBeNull();
    expect(guest?.displayName).toBe(GUEST_PLACEHOLDER_NAME);

    const rsvp = db.select().from(rsvps).where(and(eq(rsvps.sessionId, session.id), eq(rsvps.userId, outcome.guestUserId))).get();
    expect(rsvp?.status).toBe("in");
    expect(rsvp?.source).toBe("guest_link");
    expect(rsvp?.holdExpiresAt?.getTime()).toBe(now.getTime() + GUEST_HOLD_MS);
  });

  it("rejects a token signed for a different session", () => {
    const organiser = seedUser("Organiser");
    const circle = seedCircle(organiser.id);
    const session = seedSession(circle.id, { slots: 4 });
    const otherSession = seedSession(circle.id, { slots: 4 });
    const wrongToken = mintRing3ClaimToken(otherSession.id, session.startsAt);

    const outcome = claimGuestSlot(db, session.id, wrongToken);
    expect(outcome).toEqual({ ok: false, error: "invalid_link" });
  });

  it("rejects a claim on a session that's no longer upcoming", () => {
    // A ring-3 token's own expiry is always the session's startsAt (see
    // getRing3ClaimLink's comment in server/fourth-call.ts), so "the
    // session has started" reads as an expired (invalid_link) token before
    // claimGuestSlot's own session_started check would ever run — the same
    // is true of claimFourthCallSlot's ring3Token path. A cancelled session
    // still within its token's validity window is what actually exercises
    // that branch.
    const organiser = seedUser("Organiser");
    const circle = seedCircle(organiser.id);
    const session = seedSession(circle.id, { slots: 4, startsAt: new Date("2026-08-01T20:00:00.000Z") });
    db.update(sessions).set({ status: "cancelled" }).where(eq(sessions.id, session.id)).run();
    const token = mintRing3ClaimToken(session.id, session.startsAt);

    const outcome = claimGuestSlot(db, session.id, token, new Date("2026-08-01T00:00:00.000Z"));
    expect(outcome).toEqual({ ok: false, error: "session_started" });
  });

  it("the race: two claim attempts on the last open slot — one wins, the other loses", () => {
    const organiser = seedUser("Organiser");
    const circle = seedCircle(organiser.id);
    const session = seedSession(circle.id, { slots: 4 });
    rsvpConfirmed(session.id, organiser.id);
    rsvpConfirmed(session.id, seedUser().id);
    rsvpConfirmed(session.id, seedUser().id); // 3 of 4 held — one slot left
    const link = getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");

    const first = claimGuestSlot(db, session.id, link.value.token);
    const second = claimGuestSlot(db, session.id, link.value.token);

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: "already_full" });
  });

  it("an expired hold frees the slot for the next claimant", () => {
    const organiser = seedUser("Organiser");
    const circle = seedCircle(organiser.id);
    const session = seedSession(circle.id, { slots: 1 });
    const link = getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");

    const claimedAt = new Date("2026-08-01T00:00:00.000Z");
    const first = claimGuestSlot(db, session.id, link.value.token, claimedAt);
    expect(first.ok).toBe(true);

    // Still within the 5:00 hold — the slot reads as taken.
    const stillHeld = claimGuestSlot(db, session.id, link.value.token, new Date(claimedAt.getTime() + GUEST_HOLD_MS - 1000));
    expect(stillHeld).toEqual({ ok: false, error: "already_full" });

    // Past the hold — a fresh claimant sweeps the abandoned hold and takes it.
    const afterExpiry = new Date(claimedAt.getTime() + GUEST_HOLD_MS + 1000);
    const second = claimGuestSlot(db, session.id, link.value.token, afterExpiry);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.guestUserId).not.toBe(first.guestUserId);

    const abandonedRsvp = db.select().from(rsvps).where(and(eq(rsvps.sessionId, session.id), eq(rsvps.userId, first.guestUserId))).get();
    expect(abandonedRsvp?.status).toBe("out");
  });
});

describe("lockGuestName", () => {
  it("sets the guest's real first name and clears the hold", () => {
    const organiser = seedUser("Organiser");
    const circle = seedCircle(organiser.id);
    const session = seedSession(circle.id, { slots: 4 });
    const link = getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");
    const claim = claimGuestSlot(db, session.id, link.value.token);
    if (!claim.ok) throw new Error("expected claim");

    const outcome = lockGuestName(db, claim.guestUserId, session.id, "  Alex  ");
    expect(outcome).toEqual({ ok: true, displayName: "Alex" });

    const guest = db.select().from(users).where(eq(users.id, claim.guestUserId)).get();
    expect(guest?.displayName).toBe("Alex");

    const rsvp = db.select().from(rsvps).where(and(eq(rsvps.sessionId, session.id), eq(rsvps.userId, claim.guestUserId))).get();
    expect(rsvp?.holdExpiresAt).toBeNull();
    expect(rsvp?.status).toBe("in");
  });

  it("rejects an empty name", () => {
    const organiser = seedUser("Organiser");
    const circle = seedCircle(organiser.id);
    const session = seedSession(circle.id, { slots: 4 });
    const link = getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");
    const claim = claimGuestSlot(db, session.id, link.value.token);
    if (!claim.ok) throw new Error("expected claim");

    expect(lockGuestName(db, claim.guestUserId, session.id, "   ")).toEqual({ ok: false, error: "invalid_name" });
  });

  it("reports slot_lost once a contending claim has swept the expired hold away", () => {
    const organiser = seedUser("Organiser");
    const circle = seedCircle(organiser.id);
    const session = seedSession(circle.id, { slots: 1 });
    const link = getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");

    const claimedAt = new Date("2026-08-01T00:00:00.000Z");
    const first = claimGuestSlot(db, session.id, link.value.token, claimedAt);
    if (!first.ok) throw new Error("expected claim");

    // A second claimant shows up after the hold lapsed and takes the slot.
    claimGuestSlot(db, session.id, link.value.token, new Date(claimedAt.getTime() + GUEST_HOLD_MS + 1000));

    // The original (slow-typing) guest now tries to lock in — too late.
    const outcome = lockGuestName(db, first.guestUserId, session.id, "Alex");
    expect(outcome).toEqual({ ok: false, error: "slot_lost" });
  });
});

describe("joinGuestReserveQueue", () => {
  it("queues a fresh guest behind any existing reserves", () => {
    const organiser = seedUser("Organiser");
    const circle = seedCircle(organiser.id);
    const session = seedSession(circle.id, { slots: 4 });
    db.insert(rsvps).values({ sessionId: session.id, userId: seedUser().id, status: "reserve", position: 1 }).run();
    const link = getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");

    const outcome = joinGuestReserveQueue(db, session.id, link.value.token);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.position).toBe(2);

    const rsvp = db.select().from(rsvps).where(and(eq(rsvps.sessionId, session.id), eq(rsvps.userId, outcome.guestUserId))).get();
    expect(rsvp?.status).toBe("reserve");
    expect(rsvp?.source).toBe("guest_link");
  });
});

describe("getGuestUserId", () => {
  it("resolves a raw token to its guest user id, and rejects a wrong token", () => {
    const organiser = seedUser("Organiser");
    const circle = seedCircle(organiser.id);
    const session = seedSession(circle.id, { slots: 4 });
    const link = getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");
    const claim = claimGuestSlot(db, session.id, link.value.token);
    if (!claim.ok) throw new Error("expected claim");

    expect(getGuestUserId(db, claim.token)).toBe(claim.guestUserId);
    expect(getGuestUserId(db, "not-a-real-token")).toBeNull();
  });

  it("stores only the hash, never the raw token", () => {
    const organiser = seedUser("Organiser");
    const circle = seedCircle(organiser.id);
    const session = seedSession(circle.id, { slots: 4 });
    const link = getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");
    const claim = claimGuestSlot(db, session.id, link.value.token);
    if (!claim.ok) throw new Error("expected claim");

    const guest = db.select().from(users).where(eq(users.id, claim.guestUserId)).get();
    expect(guest?.guestClaimTokenHash).toBe(hashGuestToken(claim.token));
    expect(guest?.guestClaimTokenHash).not.toBe(claim.token);
  });
});

describe("convertGuestOnAuth", () => {
  it("flips a guest row to a real account in place when there's no pre-existing account", () => {
    const organiser = seedUser("Organiser");
    const circle = seedCircle(organiser.id);
    const session = seedSession(circle.id, { slots: 4 });
    const link = getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");
    const claim = claimGuestSlot(db, session.id, link.value.token);
    if (!claim.ok) throw new Error("expected claim");
    lockGuestName(db, claim.guestUserId, session.id, "Alex");

    const result = convertGuestOnAuth(db, claim.guestUserId, claim.guestUserId);
    expect(result).toEqual({ converted: true, merged: false });

    const converted = db.select().from(users).where(eq(users.id, claim.guestUserId)).get();
    expect(converted?.isGuest).toBe(false);
    expect(converted?.guestClaimTokenHash).toBeNull();
    expect(converted?.displayName).toBe("Alex");

    // The stale device cookie can never resolve to this row again.
    expect(getGuestUserId(db, claim.token)).toBeNull();
  });

  it("email conflict: re-points the guest's rsvps onto the pre-existing account", () => {
    const organiser = seedUser("Organiser");
    const circle = seedCircle(organiser.id);
    const session = seedSession(circle.id, { slots: 4 });
    const existingAccount = seedUser("Alex (existing)");
    const link = getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");
    const claim = claimGuestSlot(db, session.id, link.value.token);
    if (!claim.ok) throw new Error("expected claim");
    lockGuestName(db, claim.guestUserId, session.id, "Alex");

    const result = convertGuestOnAuth(db, claim.guestUserId, existingAccount.id);
    expect(result).toEqual({ converted: true, merged: true });

    const rsvp = db.select().from(rsvps).where(eq(rsvps.sessionId, session.id)).all().find((r) => r.userId === existingAccount.id);
    expect(rsvp?.status).toBe("in");

    const guestRow = db.select().from(users).where(eq(users.id, claim.guestUserId)).get();
    expect(guestRow?.guestClaimTokenHash).toBeNull();
    // The merge rule scopes to rsvps only — the now-inert guest row is left
    // in place, not deleted (see server/guest.ts's convertGuestOnAuth doc).
    expect(guestRow).not.toBeNull();
  });

  it("email conflict with a session the resolved account already holds: the resolved account's row wins, the guest's is dropped", () => {
    const organiser = seedUser("Organiser");
    const circle = seedCircle(organiser.id);
    const session = seedSession(circle.id, { slots: 4 });
    const existingAccount = seedUser("Alex (existing)");
    rsvpConfirmed(session.id, existingAccount.id);

    const link = getRing3ClaimLink(db, session.id);
    if (!link.ok) throw new Error("expected link");
    // A second slot for the guest to have claimed independently before converting.
    const secondSession = seedSession(circle.id, { slots: 4 });
    const secondLink = getRing3ClaimLink(db, secondSession.id);
    if (!secondLink.ok) throw new Error("expected link");

    const claimA = claimGuestSlot(db, session.id, link.value.token);
    if (!claimA.ok) throw new Error("expected claim");
    // Same guest device also claims the OTHER session before converting —
    // simulated here by reusing the same guest user id for a second rsvp.
    db.insert(rsvps).values({ sessionId: secondSession.id, userId: claimA.guestUserId, status: "in", source: "guest_link" }).run();

    convertGuestOnAuth(db, claimA.guestUserId, existingAccount.id);

    const rowsForSession = db.select().from(rsvps).where(eq(rsvps.sessionId, session.id)).all();
    // The guest's own rsvp for `session` was dropped (existingAccount already had one).
    expect(rowsForSession.find((r) => r.userId === claimA.guestUserId)).toBeUndefined();
    expect(rowsForSession.find((r) => r.userId === existingAccount.id)?.status).toBe("in");

    // The guest's OTHER rsvp (no clash there) was re-pointed onto the resolved account.
    const rowsForSecondSession = db.select().from(rsvps).where(eq(rsvps.sessionId, secondSession.id)).all();
    expect(rowsForSecondSession.find((r) => r.userId === existingAccount.id)).toBeTruthy();
  });

  it("reports not_a_guest for a normal user id", () => {
    const alex = seedUser("Alex");
    const bob = seedUser("Bob");
    expect(convertGuestOnAuth(db, alex.id, bob.id)).toEqual({ converted: false, reason: "not_a_guest" });
  });
});

describe("normalizeGuestName", () => {
  it("trims and caps length, rejecting empty-after-trim", () => {
    expect(normalizeGuestName("  Alex  ")).toBe("Alex");
    expect(normalizeGuestName("   ")).toBeNull();
    expect(normalizeGuestName("a".repeat(100))).toHaveLength(40);
  });
});

describe("a guest in a verified match", () => {
  it("flows through the Glass/Placement Trio pipeline exactly like any other player", async () => {
    const store: MatchesStore = createMatchesStore(":memory:");
    try {
      const guestDb = store.db;
      const organiser = guestDb.insert(users).values({ email: "organiser@example.com", displayName: "Organiser" }).returning().get();
      const circle = guestDb
        .insert(circles)
        .values({ name: "Guest Test Circle", inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy: organiser.id })
        .returning()
        .get();

      // A guest row exactly as claimGuestSlot would create one — no email,
      // isGuest true, still Unrated.
      const guest = guestDb.insert(users).values({ displayName: "Guest", isGuest: true, guestClaimTokenHash: "abc" }).returning().get();
      const partner = guestDb.insert(users).values({ email: "partner@example.com", displayName: "Partner" }).returning().get();
      const opp1 = guestDb.insert(users).values({ email: "opp1@example.com", displayName: "Opp1" }).returning().get();
      const opp2 = guestDb.insert(users).values({ email: "opp2@example.com", displayName: "Opp2" }).returning().get();

      const session = guestDb
        .insert(sessions)
        .values({ circleId: circle.id, startsAt: new Date("2026-08-01T18:00:00.000Z"), status: "played" })
        .returning()
        .get();

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
      store.close();
    }
  });
});
