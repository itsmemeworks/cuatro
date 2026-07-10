import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestClient,
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

beforeEach(async () => {
  client = await createTestClient();
  db = client.db;
  n = 0;
});

afterEach(async () => {
  await client.close();
  __setRealtimeSenderForTests(null);
});

async function seedVenue(pin: { name: string; lat: number | null; lng: number | null }) {
  const [row] = await db.insert(venues).values({ name: pin.name, lat: pin.lat, lng: pin.lng }).returning();
  return row;
}

async function seedUser(
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
  const [row] = await db
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
    .returning();
  return row;
}

async function seedCircle(createdBy: string) {
  const [row] = await db
    .insert(circles)
    .values({ name: `Circle ${++n}`, inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy })
    .returning();
  return row;
}

async function addMember(circleId: string, userId: string, role: "organiser" | "member" = "member") {
  await db.insert(circleMembers).values({ circleId, userId, role });
}

async function seedSession(circleId: string, venueId: string | null, opts: { slots?: number; startsAt?: Date } = {}) {
  let standingGameId: string | undefined;
  if (opts.slots) {
    const [sg] = await db
      .insert(standingGames)
      .values({ circleId, venueId, weekday: 2, startTime: "20:00", slots: opts.slots })
      .returning();
    standingGameId = sg.id;
  }
  const [row] = await db
    .insert(sessions)
    .values({
      circleId,
      venueId,
      standingGameId,
      startsAt: (opts.startsAt ?? new Date("2026-08-04T20:00:00.000Z")).getTime(),
      status: "upcoming",
    })
    .returning();
  return row;
}

async function confirm(sessionId: string, userId: string) {
  await db.insert(rsvps).values({ sessionId, userId, status: "in" });
}

async function reserve(sessionId: string, userId: string, position = 1) {
  await db.insert(rsvps).values({ sessionId, userId, status: "reserve", position });
}

/** A verified match on its own (played) session, so the four share a real, earned court history. */
async function seedVerifiedMatch(
  circleId: string,
  four: [string, string, string, string],
  playedAt = new Date("2026-07-01T20:00:00.000Z"),
  status: "verified" | "pending_confirmation" | "disputed" = "verified",
) {
  const [session] = await db
    .insert(sessions)
    .values({ circleId, venueId: null, startsAt: playedAt.getTime(), status: "played" })
    .returning();
  await db.insert(matches).values({
    sessionId: session.id,
    teamAPlayer1Id: four[0],
    teamAPlayer2Id: four[1],
    teamBPlayer1Id: four[2],
    teamBPlayer2Id: four[3],
    score: WIN,
    status,
    playedAt: playedAt.getTime(),
  });
}

/**
 * A short upcoming game in `circle` with two confirmed slot-holders (p1, p2).
 * The venue is unpinned by default (played-with is connection-based, not geo).
 */
async function shortGame(opts: { slots?: number; pinnedVenue?: boolean } = {}) {
  const venue = await seedVenue(opts.pinnedVenue ? SHOREDITCH : { name: "Unpinned", lat: null, lng: null });
  const organiser = await seedUser();
  const circle = await seedCircle(organiser.id);
  await addMember(circle.id, organiser.id, "organiser");
  const p1 = await seedUser({ rating: 4.0 });
  const p2 = await seedUser({ rating: 4.2 });
  await addMember(circle.id, p1.id);
  await addMember(circle.id, p2.id);
  const session = await seedSession(circle.id, venue.id, { slots: opts.slots ?? 4 });
  await confirm(session.id, p1.id);
  await confirm(session.id, p2.id);
  return { venue, organiser, circle, p1, p2, session };
}

describe("playedWithCandidates — the shared-history query", () => {
  it("includes a player from another circle who shared a verified match with a confirmed slot-holder", async () => {
    const { circle, p1, session } = await shortGame();
    // A separate circle whose members aren't in the target circle.
    const otherOrg = await seedUser();
    const other = await seedCircle(otherOrg.id);
    const mate = await seedUser({ rating: 4.1 });
    const filler = await seedUser();
    await addMember(other.id, mate.id);

    // p1 (confirmed) once played a verified match with `mate`.
    await seedVerifiedMatch(circle.id, [p1.id, mate.id, filler.id, otherOrg.id]);

    const ids = (await playedWithCandidates(db, session.id)).map((c) => c.userId);
    expect(ids).toContain(mate.id);
  });

  it("excludes circle members, guests, opted-out players, current participants, and explicitly-excluded ids", async () => {
    const { circle, p1, p2, session } = await shortGame();

    const memberMate = await seedUser({ rating: 4.0 });
    await addMember(circle.id, memberMate.id); // in THIS circle → ring 1's job, not played-with
    const guestMate = await seedUser({ rating: 4.0, isGuest: true });
    const optedOut = await seedUser({ rating: 4.0, findable: false });
    const reserveMate = await seedUser({ rating: 4.0 });
    const excludedMate = await seedUser({ rating: 4.0 });
    const goodMate = await seedUser({ rating: 4.0 });
    const filler = await seedUser();

    for (const m of [memberMate, guestMate, optedOut, reserveMate, excludedMate, goodMate]) {
      await seedVerifiedMatch(circle.id, [p1.id, m.id, p2.id, filler.id]);
    }
    await reserve(session.id, reserveMate.id);

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
    const { circle, p1, session } = await shortGame();
    const filler = await seedUser();
    const pendingMate = await seedUser({ rating: 4.0 });
    const disputedMate = await seedUser({ rating: 4.0 });
    const verifiedMate = await seedUser({ rating: 4.0 });

    await seedVerifiedMatch(circle.id, [p1.id, pendingMate.id, filler.id, (await seedUser()).id], undefined, "pending_confirmation");
    await seedVerifiedMatch(circle.id, [p1.id, disputedMate.id, filler.id, (await seedUser()).id], undefined, "disputed");
    await seedVerifiedMatch(circle.id, [p1.id, verifiedMate.id, filler.id, (await seedUser()).id], undefined, "verified");

    const ids = (await playedWithCandidates(db, session.id)).map((c) => c.userId);
    expect(ids).toContain(verifiedMate.id);
    expect(ids).not.toContain(pendingMate.id);
    expect(ids).not.toContain(disputedMate.id);
  });

  it("orders by shared-match count, then recency, then Reliability", async () => {
    const { circle, p1, p2, session } = await shortGame();
    const filler = await seedUser();

    // Two shared matches → strongest connection, sorts first regardless of reliability.
    const twice = await seedUser({ rating: 4.0, showUpCount: 0, rsvpInCount: 10 }); // 0% reliability
    await seedVerifiedMatch(circle.id, [p1.id, twice.id, filler.id, (await seedUser()).id], new Date("2026-06-01T20:00:00Z"));
    await seedVerifiedMatch(circle.id, [p2.id, twice.id, filler.id, (await seedUser()).id], new Date("2026-06-08T20:00:00Z"));

    // One match each; recentOnce played more recently than staleOnce → sorts ahead.
    const recentOnce = await seedUser({ rating: 4.0, showUpCount: 1, rsvpInCount: 10 });
    await seedVerifiedMatch(circle.id, [p1.id, recentOnce.id, filler.id, (await seedUser()).id], new Date("2026-07-05T20:00:00Z"));
    const staleOnce = await seedUser({ rating: 4.0, showUpCount: 10, rsvpInCount: 10 }); // 100% but older
    await seedVerifiedMatch(circle.id, [p1.id, staleOnce.id, filler.id, (await seedUser()).id], new Date("2026-05-01T20:00:00Z"));

    const ordered = (await playedWithCandidates(db, session.id)).map((c) => c.userId);
    expect(ordered.indexOf(twice.id)).toBeLessThan(ordered.indexOf(recentOnce.id));
    expect(ordered.indexOf(recentOnce.id)).toBeLessThan(ordered.indexOf(staleOnce.id));

    const twiceCandidate = (await playedWithCandidates(db, session.id)).find((c) => c.userId === twice.id)!;
    expect(twiceCandidate.sharedMatchCount).toBe(2);
    expect(twiceCandidate.lastPlayedWithLabel).toContain("played together 2 times");
  });

  it("caps the fan-out", async () => {
    const { circle, p1, session } = await shortGame();
    const filler = await seedUser();
    for (let i = 0; i < PLAYED_WITH_FANOUT_CAP + 3; i++) {
      const mate = await seedUser({ rating: 4.0 });
      await seedVerifiedMatch(circle.id, [p1.id, mate.id, filler.id, (await seedUser()).id]);
    }
    expect(await playedWithCandidates(db, session.id)).toHaveLength(PLAYED_WITH_FANOUT_CAP);
  });

  it("returns nothing when there are no confirmed players or no shared history", async () => {
    // No confirmed players.
    const venue = await seedVenue({ name: "V", lat: null, lng: null });
    const org = await seedUser();
    const circle = await seedCircle(org.id);
    const emptySession = await seedSession(circle.id, venue.id, { slots: 4 });
    expect(await playedWithCandidates(db, emptySession.id)).toEqual([]);

    // Confirmed players, but no verified match history at all.
    const { session } = await shortGame();
    expect(await playedWithCandidates(db, session.id)).toEqual([]);
  });
});

describe("checkFourthCallPlayedWith — escalation", () => {
  const NOW = new Date("2026-08-04T18:00:00.000Z");

  it("forceEscalate invites played-with candidates with level-2 via=played_with notifications and fires realtime", async () => {
    const { circle, p1, session } = await shortGame();
    const filler = await seedUser();
    const mate = await seedUser({ rating: 4.1 });
    await seedVerifiedMatch(circle.id, [p1.id, mate.id, filler.id, (await seedUser()).id]);

    const calls: { topic: string; type: string; fields: Record<string, unknown> }[] = [];
    __setRealtimeSenderForTests(async (topic, type, fields) => {
      calls.push({ topic, type, fields });
    });

    const result = await checkFourthCallPlayedWith(db, session.id, NOW, { forceEscalate: true });
    expect(result.fired).toBe(true);
    if (!result.fired) throw new Error("unreachable");
    expect(result.notifiedUserIds).toContain(mate.id);

    const notif = (await db.select().from(notifications).where(eq(notifications.type, "fourth_call"))).find(
      (r) => r.userId === mate.id,
    )!;
    expect((notif.payload as { level: number; via?: string }).level).toBe(2);
    expect((notif.payload as { via?: string }).via).toBe("played_with");

    const fc = calls.filter((c) => c.type === "fourth_call");
    expect(fc).toHaveLength(2);
    expect(fc.map((c) => c.topic).sort()).toEqual([sessionChannel(session.id), circleChannel(circle.id)].sort());
    expect(fc.every((c) => c.fields.via === "played_with")).toBe(true);
  });

  it("the invitee sees the played-with notification copy and can claim (receive side)", async () => {
    const { session } = await shortGame();
    const copy = await renderNotificationCopy(db, {
      type: "fourth_call",
      payload: { sessionId: session.id, level: 2, via: "played_with" },
    });
    expect(copy.title).toBe("A four you know needs a player");
    expect(copy.body).toContain("played with this lot before");
    expect(copy.title).not.toContain("!");
  });

  it("individual invites reach exactly one person at a time, never nagging anyone twice", async () => {
    const { circle, p1, session } = await shortGame();
    const filler = await seedUser();
    const a = await seedUser({ rating: 4.0 });
    const b = await seedUser({ rating: 4.0 });
    await seedVerifiedMatch(circle.id, [p1.id, a.id, filler.id, (await seedUser()).id]);
    await seedVerifiedMatch(circle.id, [p1.id, b.id, filler.id, (await seedUser()).id]);

    const first = await checkFourthCallPlayedWith(db, session.id, NOW, { forceEscalate: true, onlyUserIds: [a.id] });
    expect(first.fired).toBe(true);
    if (!first.fired) throw new Error("unreachable");
    expect(first.notifiedUserIds).toEqual([a.id]);

    // Inviting a again is a no-op; inviting b still works.
    const again = await checkFourthCallPlayedWith(db, session.id, NOW, { forceEscalate: true, onlyUserIds: [a.id] });
    expect(again).toEqual({ fired: false, reason: "already_notified" });

    const second = await checkFourthCallPlayedWith(db, session.id, NOW, { forceEscalate: true, onlyUserIds: [b.id] });
    expect(second.fired).toBe(true);

    expect((await playedWithInvitedUserIds(db, session.id)).sort()).toEqual([a.id, b.id].sort());
    // Exactly one notification per person.
    expect(await db.select().from(notifications).where(eq(notifications.type, "fourth_call"))).toHaveLength(2);
  });

  it("never nags twice: a second invite-all reaches nobody new", async () => {
    const { circle, p1, session } = await shortGame();
    const filler = await seedUser();
    const mate = await seedUser({ rating: 4.0 });
    await seedVerifiedMatch(circle.id, [p1.id, mate.id, filler.id, (await seedUser()).id]);

    const first = await checkFourthCallPlayedWith(db, session.id, NOW, { forceEscalate: true });
    expect(first.fired).toBe(true);
    const second = await checkFourthCallPlayedWith(db, session.id, NOW, { forceEscalate: true });
    expect(second).toEqual({ fired: false, reason: "already_notified" });

    const forMate = (await db.select().from(notifications).where(eq(notifications.type, "fourth_call"))).filter(
      (r) => r.userId === mate.id,
    );
    expect(forMate).toHaveLength(1);
  });

  it("declines when the four is full, and reports no_candidates when there's no shared history", async () => {
    const full = await shortGame({ slots: 2 });
    expect(await checkFourthCallPlayedWith(db, full.session.id, NOW, { forceEscalate: true })).toEqual({
      fired: false,
      reason: "already_full",
    });

    const empty = await shortGame();
    expect(await checkFourthCallPlayedWith(db, empty.session.id, NOW, { forceEscalate: true })).toEqual({
      fired: false,
      reason: "no_candidates",
    });
  });

  it("without forceEscalate, waits for the 20-minute window after ring 1", async () => {
    const { circle, p1, p2, session } = await shortGame();
    const filler = await seedUser();
    await seedVerifiedMatch(circle.id, [p1.id, (await seedUser({ rating: 4.0 })).id, filler.id, (await seedUser()).id]);

    const ring1At = new Date("2026-08-04T18:00:00.000Z");
    const [row] = await db
      .insert(notifications)
      .values({ userId: p2.id, type: "fourth_call", payload: { sessionId: session.id, level: 1 } })
      .returning();
    await db.update(notifications).set({ createdAt: ring1At.getTime() }).where(eq(notifications.id, row.id));

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
    const { venue, circle, p1, session } = await shortGame({ pinnedVenue: true });
    const stratford = await seedVenue(STRATFORD);
    void venue;

    const filler = await seedUser();
    const mate = await seedUser({ rating: 4.1, homeVenueId: stratford.id }); // played-with AND nearby
    await seedVerifiedMatch(circle.id, [p1.id, mate.id, filler.id, (await seedUser()).id]);
    const geoOnly = await seedUser({ rating: 4.1, homeVenueId: stratford.id }); // nearby only, no shared history

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
    const forMate = (await db.select().from(notifications).where(eq(notifications.type, "fourth_call"))).filter(
      (r) => r.userId === mate.id,
    );
    expect(forMate).toHaveLength(1);
    expect((forMate[0].payload as { via?: string }).via).toBe("played_with");
  });

  it("the geo ring's auto-open waits for the played-with ring's first-refusal window", async () => {
    const { circle, p1, session } = await shortGame({ pinnedVenue: true });
    const stratford = await seedVenue(STRATFORD);
    const filler = await seedUser();
    await seedVerifiedMatch(circle.id, [p1.id, (await seedUser({ rating: 4.1 })).id, filler.id, (await seedUser()).id]);
    await seedUser({ rating: 4.1, homeVenueId: stratford.id }); // a geo candidate

    // Ring 1 fired long ago (its own gate is already satisfied)...
    const longAgo = new Date("2026-08-01T00:00:00.000Z");
    const [r1] = await db
      .insert(notifications)
      .values({ userId: p1.id, type: "fourth_call", payload: { sessionId: session.id, level: 1 } })
      .returning();
    await db.update(notifications).set({ createdAt: longAgo.getTime() }).where(eq(notifications.id, r1.id));

    // ...but played-with only just fired (pin its notif to a fixed T).
    const pw = await checkFourthCallPlayedWith(db, session.id, NOW, { forceEscalate: true });
    expect(pw.fired).toBe(true);
    const T = new Date("2026-08-04T19:00:00.000Z");
    await db.update(notifications).set({ createdAt: T.getTime() }).where(eq(notifications.type, "fourth_call"));
    // Re-stamp ring 1 back to longAgo (the blanket update above touched it too).
    await db.update(notifications).set({ createdAt: longAgo.getTime() }).where(eq(notifications.id, r1.id));

    // The geo ring must wait 20 min after PLAYED-WITH (T), not just after ring 1.
    const tooSoon = await checkFourthCallLocalRing(db, session.id, new Date(T.getTime() + FOURTH_CALL_LOCAL_RING_DELAY_MS - 1000));
    expect(tooSoon).toEqual({ fired: false, reason: "not_yet" });

    const ready = await checkFourthCallLocalRing(db, session.id, new Date(T.getTime() + FOURTH_CALL_LOCAL_RING_DELAY_MS));
    expect(ready.fired).toBe(true);
  });

  it("a played-with invitee holds a claim grant and claiming fills the slot (receive side, no new machinery)", async () => {
    const { circle, p1, p2, session } = await shortGame(); // slots 4, two confirmed
    const filler = await seedUser();
    const mate = await seedUser({ rating: 4.1 });
    await seedVerifiedMatch(circle.id, [p1.id, mate.id, filler.id, (await seedUser()).id]);

    const pw = await checkFourthCallPlayedWith(db, session.id, NOW, { forceEscalate: true });
    expect(pw.fired).toBe(true);

    // The invite IS the claim grant — hasFourthCallInvite is via-agnostic.
    expect(await hasFourthCallInvite(db, session.id, mate.id)).toBe(true);

    const claim = await claimFourthCallSlot(db, session.id, mate.id, NOW);
    expect(claim).toEqual({ ok: true, status: "in", alreadyIn: false });

    // The slot is filled: p1, p2, mate are now confirmed "in".
    const confirmedIds = (await db.select({ userId: rsvps.userId }).from(rsvps).where(eq(rsvps.sessionId, session.id)))
      .filter((r) => r.userId)
      .map((r) => r.userId);
    expect(confirmedIds).toContain(mate.id);
    expect(confirmedIds).toEqual(expect.arrayContaining([p1.id, p2.id, mate.id]));
  });

  it("played-with firing does not mark the geo ring as already-fired", async () => {
    const { circle, p1, session } = await shortGame({ pinnedVenue: true });
    const stratford = await seedVenue(STRATFORD);
    const filler = await seedUser();
    await seedVerifiedMatch(circle.id, [p1.id, (await seedUser({ rating: 4.1 })).id, filler.id, (await seedUser()).id]);
    await seedUser({ rating: 4.1, homeVenueId: stratford.id });

    await checkFourthCallPlayedWith(db, session.id, NOW, { forceEscalate: true });
    // The geo ring (level 2, no via) still fires — its marker is distinct.
    const geo = await checkFourthCallLocalRing(db, session.id, NOW, { forceEscalate: true });
    expect(geo.fired).toBe(true);
  });
});
