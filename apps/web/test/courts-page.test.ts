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
import { getVenueBySlug } from "@/server/venues";
import { getCourtPageView, venueFactsLine, homeCourtLine } from "@/server/court-page";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("court page read model", () => {
  let client: CuatroClient;
  let db: CuatroClient["db"];
  let inviteSeq = 0;

  const mkVenue = async (overrides: Partial<typeof venues.$inferInsert> = {}) => {
    const [v] = await db
      .insert(venues)
      .values({ name: "Court", lat: 51.5, lng: -0.08, ...overrides })
      .returning();
    return v;
  };

  const mkUser = async (overrides: Partial<typeof users.$inferInsert> = {}) => {
    const [u] = await db
      .insert(users)
      .values({ displayName: "U", email: `u${Math.random()}@e.com`, ...overrides })
      .returning();
    return u;
  };

  const mkCircle = async (createdBy: string, overrides: Partial<typeof circles.$inferInsert> = {}) => {
    const [c] = await db
      .insert(circles)
      .values({ name: "C", inviteCode: `INV${inviteSeq++}`, createdBy, ...overrides })
      .returning();
    return c;
  };

  const addMember = async (circleId: string, userId: string, role: "organiser" | "member" = "member") => {
    await db.insert(circleMembers).values({ circleId, userId, role });
  };

  const addStandingGame = async (circleId: string, venueId: string, overrides: Partial<typeof standingGames.$inferInsert> = {}) => {
    const [sg] = await db
      .insert(standingGames)
      .values({ circleId, venueId, weekday: 2, startTime: "20:00", ...overrides })
      .returning();
    return sg;
  };

  /** An upcoming session with `confirmed` players already IN (RSVP window open by default). */
  const addSession = async (
    circleId: string,
    venueId: string,
    opts: { standingGameId?: string; confirmed?: string[]; startsInDays?: number; bookingPlatform?: string } = {},
  ) => {
    const startsAt = Date.now() + (opts.startsInDays ?? 2) * DAY_MS;
    const [s] = await db
      .insert(sessions)
      .values({
        circleId,
        venueId,
        standingGameId: opts.standingGameId ?? null,
        startsAt,
        status: "upcoming",
        bookingPlatform: (opts.bookingPlatform as never) ?? null,
      })
      .returning();
    for (const userId of opts.confirmed ?? []) {
      await db.insert(rsvps).values({ sessionId: s.id, userId, status: "in", respondedAt: Date.now() });
    }
    return s;
  };

  beforeEach(async () => {
    client = await createTestClient();
    db = client.db;
    inviteSeq = 0;
  });

  afterEach(async () => {
    await client.close();
  });

  describe("pure formatters", () => {
    it("venueFactsLine matches the DC shape", () => {
      expect(venueFactsLine({ indoorOutdoor: "indoor", courtCount: 4, address: "E1 6PJ" })).toBe("INDOOR · 4 COURTS · E1 6PJ");
      expect(venueFactsLine({ indoorOutdoor: "outdoor", courtCount: 1, address: "E3 4HL" })).toBe("OUTDOOR · 1 COURT · E3 4HL");
      // no environment, no count → "<postcode> · facts wanted"
      expect(venueFactsLine({ indoorOutdoor: null, courtCount: null, address: "E9 5EN" })).toBe("E9 5EN · facts wanted");
      // nothing at all
      expect(venueFactsLine({ indoorOutdoor: null, courtCount: null, address: null })).toBe("facts wanted");
    });

    it("homeCourtLine special-cases 1 and none", () => {
      expect(homeCourtLine(14)).toBe("home court to 14 players");
      expect(homeCourtLine(1)).toBe("home court to 1 player");
      expect(homeCourtLine(0)).toBe("home court to no one yet");
    });
  });

  describe("getVenueBySlug + getCourtPageView", () => {
    it("resolves a venue by slug and returns its view", async () => {
      const v = await mkVenue({ name: "Victoria Park Padel", slug: "victoria-park-padel", indoorOutdoor: "outdoor", courtCount: 4, address: "E9 7DE" });
      const resolved = await getVenueBySlug(db, "victoria-park-padel");
      expect(resolved?.id).toBe(v.id);

      const view = await getCourtPageView(db, v.id);
      expect(view).not.toBeNull();
      expect(view!.name).toBe("Victoria Park Padel");
      expect(view!.slug).toBe("victoria-park-padel");
      expect(view!.factsLine).toBe("OUTDOOR · 4 COURTS · E9 7DE");
    });

    it("returns null for an unknown slug / venue (the 404 data path)", async () => {
      expect(await getVenueBySlug(db, "does-not-exist")).toBeNull();
      expect(await getCourtPageView(db, "no-such-venue-id")).toBeNull();
    });

    it("excludes PRIVATE circles from WHO PLAYS HERE at the query level", async () => {
      const v = await mkVenue({ slug: "the-venue" });
      const org = await mkUser();

      const open = await mkCircle(org.id, { name: "Open Lot", openDoor: true, boardEnabled: true });
      const invite = await mkCircle(org.id, { name: "Invite Lot", openDoor: false, boardEnabled: true });
      const priv = await mkCircle(org.id, { name: "Private Lot", openDoor: false, boardEnabled: false });

      // All three play here (a Standing Game at the venue).
      await addStandingGame(open.id, v.id);
      await addStandingGame(invite.id, v.id);
      await addStandingGame(priv.id, v.id);

      const view = await getCourtPageView(db, v.id);
      const names = view!.circles.map((c) => c.name);
      expect(names).toContain("Open Lot");
      expect(names).toContain("Invite Lot");
      expect(names).not.toContain("Private Lot");

      const byName = new Map(view!.circles.map((c) => [c.name, c]));
      expect(byName.get("Open Lot")!.tier).toBe("open");
      expect(byName.get("Invite Lot")!.tier).toBe("invite_only");
      // open-first ordering
      expect(view!.circles[0].name).toBe("Open Lot");
    });

    it("counts only findable, non-guest home-court players", async () => {
      const v = await mkVenue({ slug: "home-court" });
      await mkUser({ homeVenueId: v.id, findable: true, isGuest: false }); // counts
      await mkUser({ homeVenueId: v.id, findable: true, isGuest: false }); // counts
      await mkUser({ homeVenueId: v.id, findable: false, isGuest: false }); // not findable → excluded
      await mkUser({ homeVenueId: v.id, findable: true, isGuest: true }); // guest → excluded
      await mkUser({ homeVenueId: null, findable: true, isGuest: false }); // elsewhere → excluded

      const view = await getCourtPageView(db, v.id);
      expect(view!.homeToCount).toBe(2);
      expect(view!.homeLine).toBe("home court to 2 players");
    });

    it("lists open games from visible circles and hides a private circle's game", async () => {
      const v = await mkVenue({ slug: "games-court" });
      const org = await mkUser({ displayName: "Org", rating: 4.5 });
      const p1 = await mkUser({ rating: 4.3 });

      const open = await mkCircle(org.id, { name: "Leo's Lot", openDoor: true, boardEnabled: true });
      await addMember(open.id, org.id, "organiser");
      const sgOpen = await addStandingGame(open.id, v.id, { bookingPlatform: "playtomic", bookingUrl: null });
      await addSession(open.id, v.id, { standingGameId: sgOpen.id, confirmed: [p1.id] }); // 1 of 4 → open

      const priv = await mkCircle(org.id, { name: "Private Lot", openDoor: false, boardEnabled: false });
      const sgPriv = await addStandingGame(priv.id, v.id);
      await addSession(priv.id, v.id, { standingGameId: sgPriv.id });

      const view = await getCourtPageView(db, v.id);
      expect(view!.openGames).toHaveLength(1);
      expect(view!.openGames[0].line).toContain("Leo's Lot");
      expect(view!.openGames[0].slotsOpen).toBe(3);
      // booking tile derived from the open game's platform
      expect(view!.booking?.platform).toBe("playtomic");
      expect(view!.booking?.tile).toBe("PT");
    });

    it("shows the quiet state (no circles, no games) as an empty view, still valid", async () => {
      const v = await mkVenue({ slug: "quiet-court", indoorOutdoor: "outdoor", courtCount: 2, address: "E8 3EU" });
      const view = await getCourtPageView(db, v.id);
      expect(view!.circles).toHaveLength(0);
      expect(view!.openGames).toHaveLength(0);
      expect(view!.booking).toBeNull();
      expect(view!.homeLine).toBe("home court to no one yet");
      expect(view!.factsLine).toBe("OUTDOOR · 2 COURTS · E8 3EU");
    });
  });
});
