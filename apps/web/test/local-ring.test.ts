import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestClient,
  circleMembers,
  circles,
  notifications,
  rsvps,
  sessions,
  standingGames,
  users,
  venues,
  type CuatroClient,
  type CuatroDb,
} from "@cuatro/db";
import { localRingCandidates, LOCAL_RING_FANOUT_CAP } from "@/server/local-ring";
import { checkFourthCallLocalRing, FOURTH_CALL_LOCAL_RING_DELAY_MS } from "@/server/games-service";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";
import { circleChannel, sessionChannel } from "@/lib/realtime/channels";

// The three pinned London venues from the geo contract §7. Shoreditch is the
// anchor; Stratford is ~5.1 km away (INSIDE the 10 km default), Wandsworth is
// ~11.0 km away (JUST outside — the boundary case discovery must exclude).
const SHOREDITCH = { name: "Powerleague Shoreditch", lat: 51.5265, lng: -0.0805 };
const STRATFORD = { name: "Padel Social Club Stratford", lat: 51.5432, lng: -0.0125 };
const WANDSWORTH = { name: "Rocket Padel Wandsworth", lat: 51.4571, lng: -0.1931 };

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
    patchLat?: number | null;
    patchLng?: number | null;
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
      patchLat: opts.patchLat ?? null,
      patchLng: opts.patchLng ?? null,
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

async function seedSession(circleId: string, venueId: string, opts: { slots?: number; startsAt?: Date } = {}) {
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

/**
 * A game short a player at pinned Shoreditch, with two confirmed slot-holders
 * rated 4.0 and 4.2 (average 4.1 → Glass band [3.35, 4.85]). Returns the ids a
 * candidate test needs.
 */
async function shortGameAtShoreditch(slots = 4) {
  const shoreditch = await seedVenue(SHOREDITCH);
  const organiser = await seedUser();
  const circle = await seedCircle(organiser.id);
  await addMember(circle.id, organiser.id, "organiser");
  const p1 = await seedUser({ rating: 4.0, homeVenueId: shoreditch.id });
  const p2 = await seedUser({ rating: 4.2, homeVenueId: shoreditch.id });
  await addMember(circle.id, p1.id);
  await addMember(circle.id, p2.id);
  const session = await seedSession(circle.id, shoreditch.id, { slots });
  await confirm(session.id, p1.id);
  await confirm(session.id, p2.id);
  return { shoreditch, organiser, circle, p1, p2, session };
}

describe("localRingCandidates — the geo candidate query", () => {
  it("includes an in-radius, in-band, findable player and excludes the 11 km, non-findable, guest, and out-of-band ones", async () => {
    const { session } = await shortGameAtShoreditch();
    const stratford = await seedVenue(STRATFORD);
    const wandsworth = await seedVenue(WANDSWORTH);

    const near = await seedUser({ rating: 4.3, homeVenueId: stratford.id }); // ~5.1 km, in band → IN
    const eleftKm = await seedUser({ rating: 4.1, homeVenueId: wandsworth.id }); // ~11 km → OUT (boundary)
    const marcus = await seedUser({ rating: 4.1, homeVenueId: stratford.id, findable: false }); // opted out → OUT
    const guest = await seedUser({ rating: 4.1, homeVenueId: stratford.id, isGuest: true }); // guest → OUT
    const tooStrong = await seedUser({ rating: 6.0, homeVenueId: stratford.id }); // 1.9 above the 4.1 centre → OUT

    const candidates = await localRingCandidates(db, session.id);
    const ids = candidates.map((c) => c.userId);

    expect(ids).toContain(near.id);
    expect(ids).not.toContain(eleftKm.id);
    expect(ids).not.toContain(marcus.id);
    expect(ids).not.toContain(guest.id);
    expect(ids).not.toContain(tooStrong.id);
  });

  it("an unrated nearby player matches any band; the confirmed slot-holders are never candidates", async () => {
    const { session, p1, p2 } = await shortGameAtShoreditch();
    const stratford = await seedVenue(STRATFORD);

    const unrated = await seedUser({ rating: null, homeVenueId: stratford.id });

    const ids = (await localRingCandidates(db, session.id)).map((c) => c.userId);
    expect(ids).toContain(unrated.id);
    expect(ids).not.toContain(p1.id);
    expect(ids).not.toContain(p2.id);
  });

  it("places explicit-patch and inferred-only players, not just home-venue-pinned ones", async () => {
    const { session, circle } = await shortGameAtShoreditch();
    const stratford = await seedVenue(STRATFORD);

    // Explicit patch dropped right on Stratford, no home venue.
    const explicit = await seedUser({ rating: 4.2, patchLat: STRATFORD.lat, patchLng: STRATFORD.lng });

    // Inferred-only: no home, no patch — but plays at Stratford (an RSVP to a
    // played session there), which resolvePatch derives as their pin.
    const inferred = await seedUser({ rating: 4.0 });
    const priorSession = await seedSession(circle.id, stratford.id, {});
    await db.update(sessions).set({ status: "played" }).where(eq(sessions.id, priorSession.id));
    await confirm(priorSession.id, inferred.id);

    const ids = (await localRingCandidates(db, session.id)).map((c) => c.userId);
    expect(ids).toContain(explicit.id);
    expect(ids).toContain(inferred.id);
  });

  it("a pinned home venue outside the radius wins over an in-radius explicit patch (resolvePatch priority)", async () => {
    const { session } = await shortGameAtShoreditch();
    await seedVenue(STRATFORD);
    const wandsworth = await seedVenue(WANDSWORTH);

    // Home venue is the far Wandsworth (their true anchor), even though their
    // explicit patch happens to sit on nearby Stratford — home wins, so OUT.
    const conflicted = await seedUser({
      rating: 4.1,
      homeVenueId: wandsworth.id,
      patchLat: STRATFORD.lat,
      patchLng: STRATFORD.lng,
    });

    const ids = (await localRingCandidates(db, session.id)).map((c) => c.userId);
    expect(ids).not.toContain(conflicted.id);
  });

  it("orders by Reliability first, then proximity", async () => {
    const { session } = await shortGameAtShoreditch();
    const stratford = await seedVenue(STRATFORD);
    const shoreditch2 = await seedVenue({ name: "Shoreditch annex", lat: SHOREDITCH.lat, lng: SHOREDITCH.lng });

    // Reliable-but-farther should sort ahead of unreliable-but-closer.
    const reliableFar = await seedUser({ rating: 4.1, homeVenueId: stratford.id, showUpCount: 10, rsvpInCount: 10 }); // 100%
    const flakeyNear = await seedUser({ rating: 4.1, homeVenueId: shoreditch2.id, showUpCount: 5, rsvpInCount: 10 }); // 50%, ~0 km

    const ordered = (await localRingCandidates(db, session.id)).map((c) => c.userId);
    expect(ordered.indexOf(reliableFar.id)).toBeLessThan(ordered.indexOf(flakeyNear.id));
  });

  it("excludes explicitly-passed ids and caps the fan-out", async () => {
    const { session } = await shortGameAtShoreditch();
    const stratford = await seedVenue(STRATFORD);

    const many: { id: string }[] = [];
    for (let i = 0; i < LOCAL_RING_FANOUT_CAP + 3; i++) {
      many.push(await seedUser({ rating: 4.1, homeVenueId: stratford.id, showUpCount: 1, rsvpInCount: 1 }));
    }

    const excluded = many[0].id;
    const candidates = await localRingCandidates(db, session.id, { excludeUserIds: [excluded] });
    expect(candidates).toHaveLength(LOCAL_RING_FANOUT_CAP);
    expect(candidates.map((c) => c.userId)).not.toContain(excluded);
  });

  it("returns nothing when the session's venue is unpinned", async () => {
    const unpinned = await seedVenue({ name: "Unpinned club", lat: null, lng: null });
    const organiser = await seedUser();
    const circle = await seedCircle(organiser.id);
    const session = await seedSession(circle.id, unpinned.id, { slots: 4 });
    const stratford = await seedVenue(STRATFORD);
    await seedUser({ rating: 4.1, homeVenueId: stratford.id });

    expect(await localRingCandidates(db, session.id)).toEqual([]);
  });
});

describe("checkFourthCallLocalRing — escalation", () => {
  const NOW = new Date("2026-08-04T18:00:00.000Z");

  it("forceEscalate invites the in-radius candidates with level-2 notifications and fires realtime", async () => {
    const { session, circle } = await shortGameAtShoreditch();
    const stratford = await seedVenue(STRATFORD);
    const wandsworth = await seedVenue(WANDSWORTH);
    const near = await seedUser({ rating: 4.2, homeVenueId: stratford.id });
    const far = await seedUser({ rating: 4.2, homeVenueId: wandsworth.id });

    const calls: { topic: string; type: string; fields: Record<string, unknown> }[] = [];
    __setRealtimeSenderForTests(async (topic, type, fields) => {
      calls.push({ topic, type, fields });
    });

    const result = await checkFourthCallLocalRing(db, session.id, NOW, { forceEscalate: true });
    expect(result.fired).toBe(true);
    if (!result.fired) throw new Error("unreachable");
    expect(result.notifiedUserIds).toContain(near.id);
    expect(result.notifiedUserIds).not.toContain(far.id);

    // Each candidate holds a level-2 fourth_call notification (the invite).
    const level2 = (await db.select().from(notifications).where(eq(notifications.type, "fourth_call"))).filter(
      (r) => (r.payload as { level: number }).level === 2,
    );
    expect(level2.map((r) => r.userId).sort()).toEqual([...result.notifiedUserIds].sort());

    // Realtime fired to both channels, level 2, after commit.
    const fc = calls.filter((c) => c.type === "fourth_call");
    expect(fc).toHaveLength(2);
    expect(fc.map((c) => c.topic).sort()).toEqual([sessionChannel(session.id), circleChannel(circle.id)].sort());
    expect(fc.every((c) => c.fields.level === 2)).toBe(true);
  });

  it("never nags twice: a second escalation is a no-op and re-notifies nobody", async () => {
    const { session } = await shortGameAtShoreditch();
    const stratford = await seedVenue(STRATFORD);
    const near = await seedUser({ rating: 4.2, homeVenueId: stratford.id });

    const first = await checkFourthCallLocalRing(db, session.id, NOW, { forceEscalate: true });
    expect(first.fired).toBe(true);

    const second = await checkFourthCallLocalRing(db, session.id, new Date(NOW.getTime() + 60_000), { forceEscalate: true });
    expect(second).toEqual({ fired: false, reason: "already_notified" });

    const forNear = (await db.select().from(notifications).where(eq(notifications.type, "fourth_call"))).filter(
      (r) => r.userId === near.id,
    );
    expect(forNear).toHaveLength(1);
  });

  it("without forceEscalate, waits for the 20-minute window after ring 1", async () => {
    const { session, p1 } = await shortGameAtShoreditch();
    const stratford = await seedVenue(STRATFORD);
    await seedUser({ rating: 4.2, homeVenueId: stratford.id });

    const ring1At = new Date("2026-08-04T18:00:00.000Z");
    const [row] = await db
      .insert(notifications)
      .values({ userId: p1.id, type: "fourth_call", payload: { sessionId: session.id, level: 1 } })
      .returning();
    await db.update(notifications).set({ createdAt: ring1At.getTime() }).where(eq(notifications.id, row.id));

    const tooSoon = await checkFourthCallLocalRing(
      db,
      session.id,
      new Date(ring1At.getTime() + FOURTH_CALL_LOCAL_RING_DELAY_MS - 1000),
    );
    expect(tooSoon).toEqual({ fired: false, reason: "not_yet" });

    const ready = await checkFourthCallLocalRing(db, session.id, new Date(ring1At.getTime() + FOURTH_CALL_LOCAL_RING_DELAY_MS));
    expect(ready.fired).toBe(true);
  });

  it("declines when the four is already full", async () => {
    const shoreditch = await seedVenue(SHOREDITCH);
    const organiser = await seedUser();
    const circle = await seedCircle(organiser.id);
    const p1 = await seedUser({ rating: 4 });
    const p2 = await seedUser({ rating: 4 });
    await addMember(circle.id, p1.id);
    await addMember(circle.id, p2.id);
    const session = await seedSession(circle.id, shoreditch.id, { slots: 2 });
    await confirm(session.id, p1.id);
    await confirm(session.id, p2.id);

    const result = await checkFourthCallLocalRing(db, session.id, NOW, { forceEscalate: true });
    expect(result).toEqual({ fired: false, reason: "already_full" });
  });

  it("returns no_candidates when nobody nearby matches", async () => {
    const { session } = await shortGameAtShoreditch();
    const wandsworth = await seedVenue(WANDSWORTH);
    await seedUser({ rating: 4.2, homeVenueId: wandsworth.id }); // 11 km away — too far

    const result = await checkFourthCallLocalRing(db, session.id, NOW, { forceEscalate: true });
    expect(result).toEqual({ fired: false, reason: "no_candidates" });
  });
});
