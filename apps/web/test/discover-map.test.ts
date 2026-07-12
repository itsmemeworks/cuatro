import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestClient,
  circleMembers,
  circles,
  rsvps,
  sessions,
  standingGames,
  users,
  venues,
  type CuatroClient,
} from "@cuatro/db";
import type { AtlasMarker } from "@/server/atlas";
import { getDiscoverView } from "@/server/discover-page";
import { pickCoralVenueId, isSparsePatch } from "@/components/discover/discover-map-mode";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A server AtlasMarker with sane defaults; override just what a case exercises. */
function mkMarker(over: Partial<AtlasMarker> & { venueId: string }): AtlasMarker {
  return {
    venueId: over.venueId,
    slug: over.slug ?? over.venueId,
    name: over.name ?? over.venueId,
    lat: over.lat ?? 51.5,
    lng: over.lng ?? -0.08,
    facts: over.facts ?? { indoorOutdoor: null, courtCount: null },
    timezone: over.timezone ?? "Europe/London",
    openSeatCount: over.openSeatCount ?? 0,
    soonestOpenSeat: over.soonestOpenSeat ?? null,
    circleCount: over.circleCount ?? 0,
    homeToCount: over.homeToCount ?? 0,
    isViewerHome: over.isViewerHome ?? false,
    quiet: over.quiet ?? false,
  };
}

const seat = (startsAtMs: number, inBand: boolean) => ({ sessionId: `s-${startsAtMs}`, startsAtMs, inBand });

describe("pickCoralVenueId — the one coral moment on the map panel", () => {
  it("returns null when nothing has an open seat", () => {
    expect(pickCoralVenueId([mkMarker({ venueId: "a" }), mkMarker({ venueId: "b", circleCount: 3 })])).toBeNull();
  });

  it("returns null when open seats exist but none is in band", () => {
    const markers = [
      mkMarker({ venueId: "a", openSeatCount: 1, soonestOpenSeat: seat(1000, false) }),
      mkMarker({ venueId: "b", openSeatCount: 2, soonestOpenSeat: seat(2000, false) }),
    ];
    expect(pickCoralVenueId(markers)).toBeNull();
  });

  it("picks the single in-band open seat", () => {
    const markers = [
      mkMarker({ venueId: "off", openSeatCount: 1, soonestOpenSeat: seat(500, false) }),
      mkMarker({ venueId: "in", openSeatCount: 1, soonestOpenSeat: seat(3000, true) }),
    ];
    expect(pickCoralVenueId(markers)).toBe("in");
  });

  it("picks the SOONEST in-band open seat when several qualify", () => {
    const markers = [
      mkMarker({ venueId: "later", openSeatCount: 1, soonestOpenSeat: seat(9000, true) }),
      mkMarker({ venueId: "soonest", openSeatCount: 1, soonestOpenSeat: seat(4000, true) }),
      mkMarker({ venueId: "mid", openSeatCount: 1, soonestOpenSeat: seat(6000, true) }),
    ];
    expect(pickCoralVenueId(markers)).toBe("soonest");
    // Exactly one coral: tag markers and count.
    const coral = markers.filter((m) => m.venueId === pickCoralVenueId(markers));
    expect(coral).toHaveLength(1);
  });

  it("on a tie keeps the first (server order = nearer/busier first)", () => {
    const markers = [
      mkMarker({ venueId: "first", openSeatCount: 1, soonestOpenSeat: seat(4000, true) }),
      mkMarker({ venueId: "second", openSeatCount: 1, soonestOpenSeat: seat(4000, true) }),
    ];
    expect(pickCoralVenueId(markers)).toBe("first");
  });

  it("ignores a soonest seat whose openSeatCount somehow reads 0", () => {
    const markers = [mkMarker({ venueId: "a", openSeatCount: 0, soonestOpenSeat: seat(1000, true) })];
    expect(pickCoralVenueId(markers)).toBeNull();
  });
});

describe("isSparsePatch — courts, but no queue", () => {
  it("is false with no markers at all (nothing to invite into)", () => {
    expect(isSparsePatch([])).toBe(false);
  });

  it("is true when every marker has no open seat and no discoverable Circle", () => {
    const markers = [
      mkMarker({ venueId: "home", isViewerHome: true, homeToCount: 1 }),
      mkMarker({ venueId: "quiet", quiet: true }),
    ];
    expect(isSparsePatch(markers)).toBe(true);
  });

  it("is false the moment any marker has an open seat", () => {
    const markers = [
      mkMarker({ venueId: "quiet", quiet: true }),
      mkMarker({ venueId: "seat", openSeatCount: 1, soonestOpenSeat: seat(1000, true) }),
    ];
    expect(isSparsePatch(markers)).toBe(false);
  });

  it("is false the moment any marker has a Circle running", () => {
    expect(isSparsePatch([mkMarker({ venueId: "a", circleCount: 1 })])).toBe(false);
  });
});

describe("getDiscoverView carries the Atlas payload", () => {
  let client: CuatroClient;
  let db: CuatroClient["db"];
  let inviteSeq = 0;

  const HOME = { lat: 51.5265, lng: -0.0805 };
  const OPEN = { lat: 51.53, lng: -0.08 };

  beforeEach(async () => {
    client = await createTestClient();
    db = client.db;
    __setRealtimeSenderForTests(null);
    inviteSeq = 0;
  });
  afterEach(async () => {
    await client.close();
    __setRealtimeSenderForTests(null);
  });

  const mkUser = async (over: Partial<typeof users.$inferInsert> = {}) => {
    const [u] = await db
      .insert(users)
      .values({ displayName: "P", email: `u${Math.random()}@e.com`, ...over })
      .returning();
    return u;
  };

  it("gives the country view (clusters, no markers, no patch) when the viewer has no patch", async () => {
    await db.insert(venues).values({ name: "A", slug: "a", ...HOME });
    await db.insert(venues).values({ name: "B", slug: "b", lat: 53.48, lng: -2.24 });
    const u = await mkUser({}); // no home / patch / history

    const view = await getDiscoverView(db, u.id, { viewerRating: null, patchAreaLabel: null });

    expect(view.hasPatch).toBe(false);
    expect(view.atlas.patch).toBeNull();
    expect(view.atlas.markers).toEqual([]);
    expect(view.atlas.clusters.reduce((n, c) => n + c.venueCount, 0)).toBe(2);
    // The PatchChip still has its data even with no patch (it's how you set one).
    expect(view.patchControl.size).toBe("local"); // default when never set
    expect(view.patchControl.homeVenueId).toBeNull();
    expect(view.patchControl.venueOptions).toHaveLength(2);
  });

  it("carries patched markers + band that agree with the list's patch", async () => {
    const [home] = await db.insert(venues).values({ name: "Home", slug: "home", ...HOME }).returning();
    const [openV] = await db.insert(venues).values({ name: "Open", slug: "open", ...OPEN }).returning();
    const viewer = await mkUser({ rating: 4.1, homeVenueId: home.id, patchSize: "wide" });

    // A board game with an open seat at openV, confirmed players in the viewer's band.
    const owner = await mkUser({ rating: 4 });
    const [c] = await db
      .insert(circles)
      .values({ name: "C", inviteCode: `INV${inviteSeq++}`, createdBy: owner.id, openDoor: true, boardEnabled: true })
      .returning();
    await db.insert(circleMembers).values({ circleId: c.id, userId: owner.id, role: "organiser" });
    const [sg] = await db
      .insert(standingGames)
      .values({ circleId: c.id, venueId: openV.id, weekday: 3, startTime: "19:00", slots: 4 })
      .returning();
    const [session] = await db
      .insert(sessions)
      .values({ standingGameId: sg.id, circleId: c.id, venueId: openV.id, startsAt: Date.now() + 2 * DAY_MS, status: "upcoming" })
      .returning();
    for (const rating of [3.9, 3.9, 3.9]) {
      const p = await mkUser({ rating });
      await db.insert(circleMembers).values({ circleId: c.id, userId: p.id, role: "member" });
      await db.insert(rsvps).values({ sessionId: session.id, userId: p.id, status: "in" });
    }

    const view = await getDiscoverView(db, viewer.id, { viewerRating: 4.1, patchAreaLabel: "Home" });

    expect(view.hasPatch).toBe(true);
    expect(view.atlas.patch).toMatchObject({ size: "wide", radiusKm: 5, source: "home_venue" });
    expect(view.atlas.band).toEqual({ min: 4.1 - 0.75, max: 4.1 + 0.75 });
    const openMarker = view.atlas.markers.find((m) => m.venueId === openV.id)!;
    expect(openMarker.openSeatCount).toBe(1);
    expect(openMarker.soonestOpenSeat?.inBand).toBe(true);
    // The coral decision that Map mode makes lands on that in-band seat.
    expect(pickCoralVenueId(view.atlas.markers)).toBe(openV.id);

    // PatchChip data reflects the viewer's patch + the pickable venues (name-ordered).
    expect(view.patchControl.size).toBe("wide");
    expect(view.patchControl.homeVenueId).toBe(home.id);
    expect(view.patchControl.homeVenueName).toBe("Home");
    expect(view.patchControl.venueOptions.map((v) => v.id).sort()).toEqual([home.id, openV.id].sort());
  });
});
