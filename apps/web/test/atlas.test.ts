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
import { PATCH_SIZES, patchRadiusKm } from "@/lib/geo";
import { generateVenueSlug, getVenueBySlug, slugifyVenueName } from "@/server/venues";
import { resolvePatch } from "@/server/patch";
import { getAtlasView } from "@/server/atlas";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";

const DAY_MS = 24 * 60 * 60 * 1000;

// Shoreditch anchor + nearby pins (all well inside a 'wide' 5 km patch) plus
// Wandsworth (~11 km) as the out-of-patch control.
const HOME = { lat: 51.5265, lng: -0.0805 };
const OPEN = { lat: 51.53, lng: -0.08 };
const OFFBAND = { lat: 51.532, lng: -0.07 };
const PRIVATE = { lat: 51.52, lng: -0.09 };
const QUIET = { lat: 51.535, lng: -0.065 };
const FAR = { lat: 51.4571, lng: -0.1931 };

describe("geo patch sizes", () => {
  it("maps each size to its fixed radius", () => {
    expect(PATCH_SIZES).toEqual({ tight: 1.2, local: 2.5, wide: 5 });
    expect(patchRadiusKm("tight")).toBe(1.2);
    expect(patchRadiusKm("local")).toBe(2.5);
    expect(patchRadiusKm("wide")).toBe(5);
  });

  it("falls back to local for anything unrecognised", () => {
    expect(patchRadiusKm(null)).toBe(2.5);
    expect(patchRadiusKm(undefined)).toBe(2.5);
    expect(patchRadiusKm("enormous")).toBe(2.5);
  });
});

describe("venue slugs", () => {
  let client: CuatroClient;
  let db: CuatroClient["db"];

  beforeEach(async () => {
    client = await createTestClient();
    db = client.db;
  });
  afterEach(async () => {
    await client.close();
  });

  it("slugifies world-ready (diacritics folded, non-alphanumerics collapsed)", () => {
    expect(slugifyVenueName("Café Padel!")).toBe("cafe-padel");
    expect(slugifyVenueName("  Powerleague   Shoreditch  ")).toBe("powerleague-shoreditch");
    expect(slugifyVenueName("")).toBe("");
  });

  it("returns the plain base when it is free", async () => {
    const slug = await generateVenueSlug(db, "Hoxton Padel Club", "London N1 6SH");
    expect(slug).toBe("hoxton-padel-club");
  });

  it("disambiguates a name collision with the area, then a number", async () => {
    await db.insert(venues).values({ name: "Padel Social Club", slug: "padel-social-club" });
    const withArea = await generateVenueSlug(db, "Padel Social Club", "London E9 5EN");
    expect(withArea).toBe("padel-social-club-e9");

    await db.insert(venues).values({ name: "Padel Social Club", slug: "padel-social-club-e9" });
    // Same area again → falls through to a numeric suffix.
    const numbered = await generateVenueSlug(db, "Padel Social Club", "London E9 7DE");
    expect(numbered).toBe("padel-social-club-2");
  });

  it("getVenueBySlug round-trips, null for an unknown slug", async () => {
    const [v] = await db.insert(venues).values({ name: "Round Trip", slug: "round-trip" }).returning();
    expect((await getVenueBySlug(db, "round-trip"))?.id).toBe(v.id);
    expect(await getVenueBySlug(db, "nope")).toBeNull();
  });
});

describe("resolvePatch carries patch size + radius", () => {
  let client: CuatroClient;
  let db: CuatroClient["db"];

  beforeEach(async () => {
    client = await createTestClient();
    db = client.db;
  });
  afterEach(async () => {
    await client.close();
  });

  it("attaches size + radiusKm from users.patchSize", async () => {
    const [v] = await db.insert(venues).values({ name: "Home", slug: "home", ...HOME }).returning();
    const [u] = await db
      .insert(users)
      .values({ displayName: "U", email: "p@e.com", homeVenueId: v.id, patchSize: "wide" })
      .returning();
    const patch = await resolvePatch(db, u.id);
    expect(patch).toMatchObject({ source: "home_venue", size: "wide", radiusKm: 5 });
  });
});

describe("getAtlasView", () => {
  let client: CuatroClient;
  let db: CuatroClient["db"];
  let inviteSeq = 0;

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

  const mkVenue = async (
    name: string,
    slug: string,
    pin: { lat: number; lng: number } | null,
    facts: { indoorOutdoor?: "indoor" | "outdoor" | "mixed"; courtCount?: number; address?: string } = {},
  ) => {
    const [v] = await db
      .insert(venues)
      .values({ name, slug, lat: pin?.lat ?? null, lng: pin?.lng ?? null, ...facts })
      .returning();
    return v;
  };

  const mkUser = async (overrides: Partial<typeof users.$inferInsert> = {}) => {
    const [u] = await db
      .insert(users)
      .values({ displayName: "P", email: `u${Math.random()}@e.com`, ...overrides })
      .returning();
    return u;
  };

  /** A Circle anchored at a venue via a session; optional board game with N confirmed players. */
  const mkCircle = async (
    venueId: string,
    opts: {
      openDoor?: boolean;
      boardEnabled?: boolean;
      confirmedRatings?: number[];
      startsAt?: Date;
    } = {},
  ) => {
    const owner = await mkUser({ rating: 4 });
    const [c] = await db
      .insert(circles)
      .values({
        name: "C",
        inviteCode: `INV${inviteSeq++}`,
        createdBy: owner.id,
        openDoor: opts.openDoor ?? true,
        boardEnabled: opts.boardEnabled ?? true,
      })
      .returning();
    await db.insert(circleMembers).values({ circleId: c.id, userId: owner.id, role: "organiser" });

    const [sg] = await db
      .insert(standingGames)
      .values({ circleId: c.id, venueId, weekday: 3, startTime: "19:00", slots: 4 })
      .returning();
    const [session] = await db
      .insert(sessions)
      .values({
        standingGameId: sg.id,
        circleId: c.id,
        venueId,
        startsAt: (opts.startsAt ?? new Date(Date.now() + 2 * DAY_MS)).getTime(),
        status: "upcoming",
      })
      .returning();
    for (const rating of opts.confirmedRatings ?? []) {
      const p = await mkUser({ rating });
      await db.insert(circleMembers).values({ circleId: c.id, userId: p.id, role: "member" });
      await db.insert(rsvps).values({ sessionId: session.id, userId: p.id, status: "in" });
    }
    return { circle: c, sessionId: session.id };
  };

  const markerBy = (view: Awaited<ReturnType<typeof getAtlasView>>, venueId: string) =>
    view.markers.find((m) => m.venueId === venueId)!;

  it("gives the country view (clusters only, no markers) with no viewer", async () => {
    await mkVenue("A", "a", HOME);
    await mkVenue("B", "b", FAR);
    const view = await getAtlasView(db, null);
    expect(view.patch).toBeNull();
    expect(view.markers).toEqual([]);
    expect(view.clusters.reduce((n, c) => n + c.venueCount, 0)).toBe(2);
  });

  it("gives the country view when the viewer has no resolvable patch", async () => {
    const u = await mkUser({}); // no home / patch / play history
    await mkVenue("A", "a", HOME);
    const view = await getAtlasView(db, u.id);
    expect(view.patch).toBeNull();
    expect(view.markers).toEqual([]);
  });

  it("projects Discover onto venue markers with facts, seats, circles, home counts, and quiet/far rules", async () => {
    const home = await mkVenue("Home Court", "home-court", HOME, { indoorOutdoor: "mixed", courtCount: 6, address: "London E9 5EN" });
    const openV = await mkVenue("Open Court", "open-court", OPEN, { indoorOutdoor: "indoor", courtCount: 4 });
    const offV = await mkVenue("Off Court", "off-court", OFFBAND);
    const privV = await mkVenue("Private Court", "private-court", PRIVATE);
    const quietV = await mkVenue("Quiet Court", "quiet-court", QUIET);
    const farV = await mkVenue("Far Court", "far-court", FAR);
    await mkVenue("Unpinned Court", "unpinned-court", null);

    const viewer = await mkUser({ rating: 4.1, homeVenueId: home.id, patchSize: "wide" });

    // Open seat, in Alex's band (players ~3.6) — dashed coral eligible.
    await mkCircle(openV.id, { confirmedRatings: [3.6, 3.6, 3.6] });
    // Open seat, OFF band (players ~5.9) — dashed bone.
    await mkCircle(offV.id, { confirmedRatings: [5.9, 5.9, 5.9] });
    // A private circle anchored at privV — must NOT count anywhere.
    await mkCircle(privV.id, { openDoor: false, boardEnabled: false });
    // A circle the VIEWER belongs to, anchored at home — excluded from counts
    // (Discover's own rule), so home's circleCount stays 0.
    const ownCircle = await mkCircle(home.id, {});
    await db.insert(circleMembers).values({ circleId: ownCircle.circle.id, userId: viewer.id, role: "member" });

    // "home court to N players": the viewer + 2 findable non-guests = 3; a
    // guest and a non-findable player who call it home do NOT count.
    await mkUser({ homeVenueId: home.id, findable: true });
    await mkUser({ homeVenueId: home.id, findable: true });
    await mkUser({ homeVenueId: home.id, findable: true, isGuest: true });
    await mkUser({ homeVenueId: home.id, findable: false });

    const view = await getAtlasView(db, viewer.id);

    expect(view.patch).toMatchObject({ size: "wide", radiusKm: 5, source: "home_venue", areaLabel: "E9" });
    expect(view.band).toEqual({ min: 4.1 - 0.75, max: 4.1 + 0.75 });

    // Far + unpinned excluded.
    expect(view.markers.find((m) => m.venueId === farV.id)).toBeUndefined();
    expect(view.markers.map((m) => m.slug)).not.toContain("unpinned-court");

    const homeM = markerBy(view, home.id);
    expect(homeM.isViewerHome).toBe(true);
    expect(homeM.timezone).toBe("Europe/London"); // venue default — format startsAtMs in this zone
    expect(homeM.facts).toEqual({ indoorOutdoor: "mixed", courtCount: 6 });
    expect(homeM.homeToCount).toBe(3);
    expect(homeM.circleCount).toBe(0); // own circle not counted
    expect(homeM.quiet).toBe(false);

    const openM = markerBy(view, openV.id);
    expect(openM.facts).toEqual({ indoorOutdoor: "indoor", courtCount: 4 });
    expect(openM.openSeatCount).toBe(1);
    expect(openM.soonestOpenSeat?.inBand).toBe(true);
    expect(openM.circleCount).toBe(1);

    const offM = markerBy(view, offV.id);
    expect(offM.openSeatCount).toBe(1);
    expect(offM.soonestOpenSeat?.inBand).toBe(false);

    const privM = markerBy(view, privV.id);
    expect(privM.circleCount).toBe(0); // private circle never counts
    expect(privM.openSeatCount).toBe(0);

    const quietM = markerBy(view, quietV.id);
    expect(quietM.quiet).toBe(true);
    expect(quietM.circleCount).toBe(0);
    expect(quietM.openSeatCount).toBe(0);
    expect(quietM.homeToCount).toBe(0);
  });

  it("shrinks the marker set with a tighter patch size", async () => {
    const home = await mkVenue("Home", "home", HOME);
    await mkVenue("Near", "near", OPEN); // ~0.4 km
    await mkVenue("Edge", "edge", QUIET); // ~1.6 km

    const tight = await mkUser({ rating: 4, homeVenueId: home.id, patchSize: "tight" }); // 1.2 km
    const wide = await mkUser({ rating: 4, homeVenueId: home.id, patchSize: "wide" }); // 5 km

    const tightView = await getAtlasView(db, tight.id);
    const wideView = await getAtlasView(db, wide.id);
    expect(tightView.markers.map((m) => m.slug).sort()).toEqual(["home", "near"]);
    expect(wideView.markers.map((m) => m.slug).sort()).toEqual(["edge", "home", "near"]);
  });
});
