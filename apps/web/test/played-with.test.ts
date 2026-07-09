import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createClient,
  circleMembers,
  circles,
  matches,
  notifications,
  rsvps,
  sessions,
  standingGames,
  users,
  venues,
  type CuatroClient,
  type CuatroDb,
  type SetScore,
} from "@cuatro/db";
import { playedWithCandidates, PLAYED_WITH_FANOUT_CAP } from "@/server/played-with";
import {
  checkFourthCallPlayedWith,
  checkFourthCallLocalRing,
  playedWithInvitedUserIds,
  FOURTH_CALL_LOCAL_RING_DELAY_MS,
} from "@/server/games-service";
import { renderNotificationCopy } from "@/server/notify";
import { hasFourthCallInvite, claimFourthCallSlot } from "@/server/fourth-call";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";
import { circleChannel, sessionChannel } from "@/lib/realtime/channels";

// Two pinned venues, mirroring local-ring.test.ts's geo fixtures — used only
// where a played-with candidate must ALSO be a geo Local Ring candidate (to
// prove the two rings don't nag the same person twice).
const SHOREDITCH = { name: "Powerleague Shoreditch", lat: 51.5265, lng: -0.0805 };
const STRATFORD = { name: "Padel Social Club Stratford", lat: 51.5432, lng: -0.0125 };

const WIN: SetScore[] = [
  { a: 6, b: 3 },
  { a: 6, b: 4 },
];

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

function seedVenue(pin: { name: string; lat: number | null; lng: number | null }) {
  return db.insert(venues).values({ name: pin.name, lat: pin.lat, lng: pin.lng }).returning().get();
}

function seedUser(
  opts: {
    rating?: number | null;
    findable?: boolean;
    isGuest?: boolean;
    homeVenueId?: string | null;
    showUpCount?: number;
    rsvpInCount?: number;
  } = {},
) {
  n += 1;
  return db
    .insert(users)
    .values({
      email: `u${n}@example.com`,
      displayName: `User ${n}`,
      rating: opts.rating ?? null,
      findable: opts.findable ?? true,
      isGuest: opts.isGuest ?? false,
      homeVenueId: opts.homeVenueId ?? null,
      showUpCount: opts.showUpCount ?? 0,
      rsvpInCount: opts.rsvpInCount ?? 0,
    })
    .returning()
    .get();
}

function seedCircle(createdBy: string) {
  return db
    .insert(circles)
    .values({ name: `Circle ${++n}`, inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy })
    .returning()
    .get();
}

function addMember(circleId: string, userId: string, role: "organiser" | "member" = "member") {
  db.insert(circleMembers).values({ circleId, userId, role }).run();
}

function seedSession(circleId: string, venueId: string | null, opts: { slots?: number; startsAt?: Date } = {}) {
  let standingGameId: string | undefined;
  if (opts.slots) {
    const sg = db
      .insert(standingGames)
      .values({ circleId, venueId, weekday: 2, startTime: "20:00", slots: opts.slots })
      .returning()
      .get();
    standingGameId = sg.id;
  }
  return db
    .insert(sessions)
    .values({
      circleId,
      venueId,
      standingGameId,
      startsAt: opts.startsAt ?? new Date("2026-08-04T20:00:00.000Z"),
      status: "upcoming",
    })
    .returning()
    .get();
}

function confirm(sessionId: string, userId: string) {
  db.insert(rsvps).values({ sessionId, userId, status: "in" }).run();
}

function reserve(sessionId: string, userId: string, position = 1) {
  db.insert(rsvps).values({ sessionId, userId, status: "reserve", position }).run();
}

/** A verified match on its own (played) session, so the four share a real, earned court history. */
function seedVerifiedMatch(
  circleId: string,
  four: [string, string, string, string],
  playedAt = new Date("2026-07-01T20:00:00.000Z"),
  status: "verified" | "pending_confirmation" | "disputed" = "verified",
) {
  const session = db
    .insert(sessions)
    .values({ circleId, venueId: null, startsAt: playedAt, status: "played" })
    .returning()
    .get();
  db.insert(matches)
    .values({
      sessionId: session.id,
      teamAPlayer1Id: four[0],
      teamAPlayer2Id: four[1],
      teamBPlayer1Id: four[2],
      teamBPlayer2Id: four[3],
      score: WIN,
      status,
      playedAt,
    })
    .run();
}

/**
 * A short upcoming game in `circle` with two confirmed slot-holders (p1, p2).
 * The venue is unpinned by default (played-with is connection-based, not geo).
 */
function shortGame(opts: { slots?: number; pinnedVenue?: boolean } = {}) {
  const venue = seedVenue(opts.pinnedVenue ? SHOREDITCH : { name: "Unpinned", lat: null, lng: null });
  const organiser = seedUser();
  const circle = seedCircle(organiser.id);
  addMember(circle.id, organiser.id, "organiser");
  const p1 = seedUser({ rating: 4.0 });
  const p2 = seedUser({ rating: 4.2 });
  addMember(circle.id, p1.id);
  addMember(circle.id, p2.id);
  const session = seedSession(circle.id, venue.id, { slots: opts.slots ?? 4 });
  confirm(session.id, p1.id);
  confirm(session.id, p2.id);
  return { venue, organiser, circle, p1, p2, session };
}

describe("playedWithCandidates — the shared-history query", () => {
  it("includes a player from another circle who shared a verified match with a confirmed slot-holder", async () => {
    const { circle, p1, session } = shortGame();
    // A separate circle whose members aren't in the target circle.
    const otherOrg = seedUser();
    const other = seedCircle(otherOrg.id);
    const mate = seedUser({ rating: 4.1 });
    const filler = seedUser();
    addMember(other.id, mate.id);

    // p1 (confirmed) once played a verified match with `mate`.
    seedVerifiedMatch(circle.id, [p1.id, mate.id, filler.id, otherOrg.id]);

    const ids = (await playedWithCandidates(db, session.id)).map((c) => c.userId);
    expect(ids).toContain(mate.id);
  });

  it("excludes circle members, guests, opted-out players, current participants, and explicitly-excluded ids", async () => {
    const { circle, p1, p2, session } = shortGame();

    const memberMate = seedUser({ rating: 4.0 });
    addMember(circle.id, memberMate.id); // in THIS circle → ring 1's job, not played-with
    const guestMate = seedUser({ rating: 4.0, isGuest: true });
    const optedOut = seedUser({ rating: 4.0, findable: false });
    const reserveMate = seedUser({ rating: 4.0 });
    const excludedMate = seedUser({ rating: 4.0 });
    const goodMate = seedUser({ rating: 4.0 });
    const filler = seedUser();

    for (const m of [memberMate, guestMate, optedOut, reserveMate, excludedMate, goodMate]) {
      seedVerifiedMatch(circle.id, [p1.id, m.id, p2.id, filler.id]);
    }
    reserve(session.id, reserveMate.id);

    const ids = (await playedWithCandidates(db, session.id, { excludeUserIds: [excludedMate.id] })).map((c) => c.userId);
    expect(ids).toContain(goodMate.id);
    expect(ids).not.toContain(memberMate.id);
    expect(ids).not.toContain(guestMate.id);
    expect(ids).not.toContain(optedOut.id);
    expect(ids).not.toContain(reserveMate.id);
    expect(ids).not.toContain(excludedMate.id);
    // Confirmed slot-holders themselves are never candidates.
    expect(ids).not.toContain(p1.id);
    expect(ids).not.toContain(p2.id);
  });

  it("only counts VERIFIED matches, not pending or disputed", async () => {
    const { circle, p1, session } = shortGame();
    const filler = seedUser();
    const pendingMate = seedUser({ rating: 4.0 });
    const disputedMate = seedUser({ rating: 4.0 });
    const verifiedMate = seedUser({ rating: 4.0 });

    seedVerifiedMatch(circle.id, [p1.id, pendingMate.id, filler.id, seedUser().id], undefined, "pending_confirmation");
    seedVerifiedMatch(circle.id, [p1.id, disputedMate.id, filler.id, seedUser().id], undefined, "disputed");
    seedVerifiedMatch(circle.id, [p1.id, verifiedMate.id, filler.id, seedUser().id], undefined, "verified");

    const ids = (await playedWithCandidates(db, session.id)).map((c) => c.userId);
    expect(ids).toContain(verifiedMate.id);
    expect(ids).not.toContain(pendingMate.id);
    expect(ids).not.toContain(disputedMate.id);
  });

  it("orders by shared-match count, then recency, then Reliability", async () => {
    const { circle, p1, p2, session } = shortGame();
    const filler = seedUser();

    // Two shared matches → strongest connection, sorts first regardless of reliability.
    const twice = seedUser({ rating: 4.0, showUpCount: 0, rsvpInCount: 10 }); // 0% reliability
    seedVerifiedMatch(circle.id, [p1.id, twice.id, filler.id, seedUser().id], new Date("2026-06-01T20:00:00Z"));
    seedVerifiedMatch(circle.id, [p2.id, twice.id, filler.id, seedUser().id], new Date("2026-06-08T20:00:00Z"));

    // One match each; recentOnce played more recently than staleOnce → sorts ahead.
    const recentOnce = seedUser({ rating: 4.0, showUpCount: 1, rsvpInCount: 10 });
    seedVerifiedMatch(circle.id, [p1.id, recentOnce.id, filler.id, seedUser().id], new Date("2026-07-05T20:00:00Z"));
    const staleOnce = seedUser({ rating: 4.0, showUpCount: 10, rsvpInCount: 10 }); // 100% but older
    seedVerifiedMatch(circle.id, [p1.id, staleOnce.id, filler.id, seedUser().id], new Date("2026-05-01T20:00:00Z"));

    const ordered = (await playedWithCandidates(db, session.id)).map((c) => c.userId);
    expect(ordered.indexOf(twice.id)).toBeLessThan(ordered.indexOf(recentOnce.id));
    expect(ordered.indexOf(recentOnce.id)).toBeLessThan(ordered.indexOf(staleOnce.id));

    const twiceCandidate = (await playedWithCandidates(db, session.id)).find((c) => c.userId === twice.id)!;
    expect(twiceCandidate.sharedMatchCount).toBe(2);
    expect(twiceCandidate.lastPlayedWithLabel).toContain("played together 2 times");
  });

  it("caps the fan-out", async () => {
    const { circle, p1, session } = shortGame();
    const filler = seedUser();
    for (let i = 0; i < PLAYED_WITH_FANOUT_CAP + 3; i++) {
      const mate = seedUser({ rating: 4.0 });
      seedVerifiedMatch(circle.id, [p1.id, mate.id, filler.id, seedUser().id]);
    }
    expect(await playedWithCandidates(db, session.id)).toHaveLength(PLAYED_WITH_FANOUT_CAP);
  });

  it("returns nothing when there are no confirmed players or no shared history", async () => {
    // No confirmed players.
    const venue = seedVenue({ name: "V", lat: null, lng: null });
    const org = seedUser();
    const circle = seedCircle(org.id);
    const emptySession = seedSession(circle.id, venue.id, { slots: 4 });
    expect(await playedWithCandidates(db, emptySession.id)).toEqual([]);

    // Confirmed players, but no verified match history at all.
    const { session } = shortGame();
    expect(await playedWithCandidates(db, session.id)).toEqual([]);
  });
});

describe("checkFourthCallPlayedWith — escalation", () => {
  const NOW = new Date("2026-08-04T18:00:00.000Z");

  it("forceEscalate invites played-with candidates with level-2 via=played_with notifications and fires realtime", async () => {
    const { circle, p1, session } = shortGame();
    const filler = seedUser();
    const mate = seedUser({ rating: 4.1 });
    seedVerifiedMatch(circle.id, [p1.id, mate.id, filler.id, seedUser().id]);

    const calls: { topic: string; type: string; fields: Record<string, unknown> }[] = [];
    __setRealtimeSenderForTests(async (topic, type, fields) => {
      calls.push({ topic, type, fields });
    });

    const result = await checkFourthCallPlayedWith(db, session.id, NOW, { forceEscalate: true });
    expect(result.fired).toBe(true);
    if (!result.fired) throw new Error("unreachable");
    expect(result.notifiedUserIds).toContain(mate.id);

    const notif = db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "fourth_call"))
      .all()
      .find((r) => r.userId === mate.id)!;
    expect((notif.payload as { level: number; via?: string }).level).toBe(2);
    expect((notif.payload as { via?: string }).via).toBe("played_with");

    const fc = calls.filter((c) => c.type === "fourth_call");
    expect(fc).toHaveLength(2);
    expect(fc.map((c) => c.topic).sort()).toEqual([sessionChannel(session.id), circleChannel(circle.id)].sort());
    expect(fc.every((c) => c.fields.via === "played_with")).toBe(true);
  });

  it("the invitee sees the played-with notification copy and can claim (receive side)", () => {
    const { session } = shortGame();
    const copy = renderNotificationCopy(db, {
      type: "fourth_call",
      payload: { sessionId: session.id, level: 2, via: "played_with" },
    });
    expect(copy.title).toBe("A four you know needs a player");
    expect(copy.body).toContain("played with this lot before");
    expect(copy.title).not.toContain("!");
  });

  it("individual invites reach exactly one person at a time, never nagging anyone twice", async () => {
    const { circle, p1, session } = shortGame();
    const filler = seedUser();
    const a = seedUser({ rating: 4.0 });
    const b = seedUser({ rating: 4.0 });
    seedVerifiedMatch(circle.id, [p1.id, a.id, filler.id, seedUser().id]);
    seedVerifiedMatch(circle.id, [p1.id, b.id, filler.id, seedUser().id]);

    const first = await checkFourthCallPlayedWith(db, session.id, NOW, { forceEscalate: true, onlyUserIds: [a.id] });
    expect(first.fired).toBe(true);
    if (!first.fired) throw new Error("unreachable");
    expect(first.notifiedUserIds).toEqual([a.id]);

    // Inviting a again is a no-op; inviting b still works.
    const again = await checkFourthCallPlayedWith(db, session.id, NOW, { forceEscalate: true, onlyUserIds: [a.id] });
    expect(again).toEqual({ fired: false, reason: "already_notified" });

    const second = await checkFourthCallPlayedWith(db, session.id, NOW, { forceEscalate: true, onlyUserIds: [b.id] });
    expect(second.fired).toBe(true);

    expect(playedWithInvitedUserIds(db, session.id).sort()).toEqual([a.id, b.id].sort());
    // Exactly one notification per person.
    expect(db.select().from(notifications).where(eq(notifications.type, "fourth_call")).all()).toHaveLength(2);
  });

  it("never nags twice: a second invite-all reaches nobody new", async () => {
    const { circle, p1, session } = shortGame();
    const filler = seedUser();
    const mate = seedUser({ rating: 4.0 });
    seedVerifiedMatch(circle.id, [p1.id, mate.id, filler.id, seedUser().id]);

    const first = await checkFourthCallPlayedWith(db, session.id, NOW, { forceEscalate: true });
    expect(first.fired).toBe(true);
    const second = await checkFourthCallPlayedWith(db, session.id, NOW, { forceEscalate: true });
    expect(second).toEqual({ fired: false, reason: "already_notified" });

    const forMate = db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "fourth_call"))
      .all()
      .filter((r) => r.userId === mate.id);
    expect(forMate).toHaveLength(1);
  });

  it("declines when the four is full, and reports no_candidates when there's no shared history", async () => {
    const full = shortGame({ slots: 2 });
    expect(await checkFourthCallPlayedWith(db, full.session.id, NOW, { forceEscalate: true })).toEqual({
      fired: false,
      reason: "already_full",
    });

    const empty = shortGame();
    expect(await checkFourthCallPlayedWith(db, empty.session.id, NOW, { forceEscalate: true })).toEqual({
      fired: false,
      reason: "no_candidates",
    });
  });

  it("without forceEscalate, waits for the 20-minute window after ring 1", async () => {
    const { circle, p1, p2, session } = shortGame();
    const filler = seedUser();
    seedVerifiedMatch(circle.id, [p1.id, seedUser({ rating: 4.0 }).id, filler.id, seedUser().id]);

    const ring1At = new Date("2026-08-04T18:00:00.000Z");
    const row = db
      .insert(notifications)
      .values({ userId: p2.id, type: "fourth_call", payload: { sessionId: session.id, level: 1 } })
      .returning()
      .get();
    db.update(notifications).set({ createdAt: ring1At }).where(eq(notifications.id, row.id)).run();

    const tooSoon = await checkFourthCallPlayedWith(
      db,
      session.id,
      new Date(ring1At.getTime() + FOURTH_CALL_LOCAL_RING_DELAY_MS - 1000),
    );
    expect(tooSoon).toEqual({ fired: false, reason: "not_yet" });

    const ready = await checkFourthCallPlayedWith(db, session.id, new Date(ring1At.getTime() + FOURTH_CALL_LOCAL_RING_DELAY_MS));
    expect(ready.fired).toBe(true);
  });
});

describe("Fourth Call ladder — played-with before the geo Local Ring", () => {
  const NOW = new Date("2026-08-04T18:00:00.000Z");

  it("the geo ring excludes a played-with invitee and never re-notifies them", async () => {
    // Pinned venue so the geo ring is live. The played-with mate ALSO sits
    // nearby and in-band, so they're eligible for BOTH rings — the geo ring
    // must skip them (already invited) and reach only the geo-only player.
    const { venue, circle, p1, session } = shortGame({ pinnedVenue: true });
    const stratford = seedVenue(STRATFORD);
    void venue;

    const filler = seedUser();
    const mate = seedUser({ rating: 4.1, homeVenueId: stratford.id }); // played-with AND nearby
    seedVerifiedMatch(circle.id, [p1.id, mate.id, filler.id, seedUser().id]);
    const geoOnly = seedUser({ rating: 4.1, homeVenueId: stratford.id }); // nearby only, no shared history

    const pw = await checkFourthCallPlayedWith(db, session.id, NOW, { forceEscalate: true });
    expect(pw.fired).toBe(true);
    if (!pw.fired) throw new Error("unreachable");
    expect(pw.notifiedUserIds).toContain(mate.id);

    const geo = await checkFourthCallLocalRing(db, session.id, NOW, { forceEscalate: true });
    expect(geo.fired).toBe(true);
    if (!geo.fired) throw new Error("unreachable");
    expect(geo.notifiedUserIds).toContain(geoOnly.id);
    // Nobody the played-with ring already reached is nagged again by the geo ring.
    for (const id of pw.notifiedUserIds) expect(geo.notifiedUserIds).not.toContain(id);

    // mate holds exactly one invite (the played-with one), never re-notified.
    const forMate = db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "fourth_call"))
      .all()
      .filter((r) => r.userId === mate.id);
    expect(forMate).toHaveLength(1);
    expect((forMate[0].payload as { via?: string }).via).toBe("played_with");
  });

  it("the geo ring's auto-open waits for the played-with ring's first-refusal window", async () => {
    const { circle, p1, session } = shortGame({ pinnedVenue: true });
    const stratford = seedVenue(STRATFORD);
    const filler = seedUser();
    seedVerifiedMatch(circle.id, [p1.id, seedUser({ rating: 4.1 }).id, filler.id, seedUser().id]);
    seedUser({ rating: 4.1, homeVenueId: stratford.id }); // a geo candidate

    // Ring 1 fired long ago (its own gate is already satisfied)...
    const longAgo = new Date("2026-08-01T00:00:00.000Z");
    const r1 = db
      .insert(notifications)
      .values({ userId: p1.id, type: "fourth_call", payload: { sessionId: session.id, level: 1 } })
      .returning()
      .get();
    db.update(notifications).set({ createdAt: longAgo }).where(eq(notifications.id, r1.id)).run();

    // ...but played-with only just fired (pin its notif to a fixed T).
    const pw = await checkFourthCallPlayedWith(db, session.id, NOW, { forceEscalate: true });
    expect(pw.fired).toBe(true);
    const T = new Date("2026-08-04T19:00:00.000Z");
    db.update(notifications)
      .set({ createdAt: T })
      .where(eq(notifications.type, "fourth_call"))
      .run();
    // Re-stamp ring 1 back to longAgo (the blanket update above touched it too).
    db.update(notifications).set({ createdAt: longAgo }).where(eq(notifications.id, r1.id)).run();

    // The geo ring must wait 20 min after PLAYED-WITH (T), not just after ring 1.
    const tooSoon = await checkFourthCallLocalRing(db, session.id, new Date(T.getTime() + FOURTH_CALL_LOCAL_RING_DELAY_MS - 1000));
    expect(tooSoon).toEqual({ fired: false, reason: "not_yet" });

    const ready = await checkFourthCallLocalRing(db, session.id, new Date(T.getTime() + FOURTH_CALL_LOCAL_RING_DELAY_MS));
    expect(ready.fired).toBe(true);
  });

  it("a played-with invitee holds a claim grant and claiming fills the slot (receive side, no new machinery)", async () => {
    const { circle, p1, p2, session } = shortGame(); // slots 4, two confirmed
    const filler = seedUser();
    const mate = seedUser({ rating: 4.1 });
    seedVerifiedMatch(circle.id, [p1.id, mate.id, filler.id, seedUser().id]);

    const pw = await checkFourthCallPlayedWith(db, session.id, NOW, { forceEscalate: true });
    expect(pw.fired).toBe(true);

    // The invite IS the claim grant — hasFourthCallInvite is via-agnostic.
    expect(hasFourthCallInvite(db, session.id, mate.id)).toBe(true);

    const claim = claimFourthCallSlot(db, session.id, mate.id, NOW);
    expect(claim).toEqual({ ok: true, status: "in", alreadyIn: false });

    // The slot is filled: p1, p2, mate are now confirmed "in".
    const confirmedIds = db
      .select({ userId: rsvps.userId })
      .from(rsvps)
      .where(eq(rsvps.sessionId, session.id))
      .all()
      .filter((r) => r.userId)
      .map((r) => r.userId);
    expect(confirmedIds).toContain(mate.id);
    expect(confirmedIds).toEqual(expect.arrayContaining([p1.id, p2.id, mate.id]));
  });

  it("played-with firing does not mark the geo ring as already-fired", async () => {
    const { circle, p1, session } = shortGame({ pinnedVenue: true });
    const stratford = seedVenue(STRATFORD);
    const filler = seedUser();
    seedVerifiedMatch(circle.id, [p1.id, seedUser({ rating: 4.1 }).id, filler.id, seedUser().id]);
    seedUser({ rating: 4.1, homeVenueId: stratford.id });

    await checkFourthCallPlayedWith(db, session.id, NOW, { forceEscalate: true });
    // The geo ring (level 2, no via) still fires — its marker is distinct.
    const geo = await checkFourthCallLocalRing(db, session.id, NOW, { forceEscalate: true });
    expect(geo.fired).toBe(true);
  });
});
