import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestClient,
  circles,
  matches,
  rsvps,
  sessions,
  users,
  venues,
  type CuatroClient,
} from "@cuatro/db";
import { resolvePatch } from "@/server/patch";

// resolvePatch priority: home_venue pin -> explicit patchLat/Lng -> inferred
// (most-frequent pinned venue from played/RSVP'd sessions) -> null.
describe("resolvePatch", () => {
  let client: CuatroClient;

  const mkUser = async (overrides: Partial<typeof users.$inferInsert> = {}) => {
    const [u] = await client.db
      .insert(users)
      .values({ displayName: "U", email: `u${Math.random()}@e.com`, ...overrides })
      .returning();
    return u;
  };

  const mkVenue = async (pinned: boolean) => {
    const [v] = await client.db
      .insert(venues)
      .values(
        pinned
          ? { name: "Pinned", address: "London EC2A 3AR", lat: 51.5265, lng: -0.0805 }
          : { name: "Unpinned", address: "London" },
      )
      .returning();
    return v;
  };

  const mkCircle = async (createdBy: string) => {
    const [c] = await client.db
      .insert(circles)
      .values({ name: "C", inviteCode: `INV${Math.random()}`.slice(0, 12), createdBy })
      .returning();
    return c;
  };

  beforeEach(async () => {
    client = await createTestClient();
  });

  afterEach(async () => {
    await client.close();
  });

  it("returns null for an unknown user", async () => {
    expect(await resolvePatch(client.db, "nope")).toBeNull();
  });

  it("returns null when the user has no anchor at all", async () => {
    const u = await mkUser();
    expect(await resolvePatch(client.db, u.id)).toBeNull();
  });

  it("resolves a home venue pin first", async () => {
    const v = await mkVenue(true);
    const u = await mkUser({ homeVenueId: v.id });
    expect(await resolvePatch(client.db, u.id)).toEqual({
      lat: 51.5265,
      lng: -0.0805,
      source: "home_venue",
    });
  });

  it("falls through to explicit when the home venue is not geocoded", async () => {
    const v = await mkVenue(false);
    const u = await mkUser({ homeVenueId: v.id, patchLat: 51.51, patchLng: -0.12 });
    expect(await resolvePatch(client.db, u.id)).toEqual({
      lat: 51.51,
      lng: -0.12,
      source: "explicit",
    });
  });

  it("resolves an explicit patch when there is no home venue", async () => {
    const u = await mkUser({ patchLat: 51.5432, patchLng: -0.0125 });
    const patch = await resolvePatch(client.db, u.id);
    expect(patch?.source).toBe("explicit");
    expect(patch?.lat).toBe(51.5432);
  });

  it("infers the most-frequent pinned venue from RSVP'd + played sessions", async () => {
    const home = await mkVenue(true); // will be the frequent one
    const other = await mkVenue(true);
    const u = await mkUser();
    const c = await mkCircle(u.id);

    const mkSession = async (venueId: string) => {
      const [s] = await client.db
        .insert(sessions)
        .values({ circleId: c.id, venueId, startsAt: Date.now(), status: "played" })
        .returning();
      return s;
    };

    // Two sessions at `home`, one at `other` -> home wins.
    const s1 = await mkSession(home.id);
    const s2 = await mkSession(home.id);
    const s3 = await mkSession(other.id);
    await client.db.insert(rsvps).values([
      { sessionId: s1.id, userId: u.id, status: "in" },
      { sessionId: s2.id, userId: u.id, status: "in" },
      { sessionId: s3.id, userId: u.id, status: "in" },
    ]);

    const patch = await resolvePatch(client.db, u.id);
    expect(patch?.source).toBe("inferred");
    expect(patch?.lat).toBe(home.lat);
    expect(patch?.lng).toBe(home.lng);
  });

  it("infers from a played match even without an RSVP row", async () => {
    const v = await mkVenue(true);
    const u = await mkUser();
    const opp = await mkUser();
    const p2 = await mkUser();
    const p3 = await mkUser();
    const c = await mkCircle(u.id);
    const [s] = await client.db
      .insert(sessions)
      .values({ circleId: c.id, venueId: v.id, startsAt: Date.now(), status: "played" })
      .returning();
    await client.db.insert(matches).values({
      sessionId: s.id,
      teamAPlayer1Id: u.id,
      teamAPlayer2Id: p2.id,
      teamBPlayer1Id: opp.id,
      teamBPlayer2Id: p3.id,
      score: [{ a: 6, b: 3 }],
      status: "verified",
      playedAt: Date.now(),
    });
    const patch = await resolvePatch(client.db, u.id);
    expect(patch?.source).toBe("inferred");
    expect(patch?.lat).toBe(v.lat);
  });

  it("does not infer from an unpinned venue", async () => {
    const v = await mkVenue(false);
    const u = await mkUser();
    const c = await mkCircle(u.id);
    const [s] = await client.db
      .insert(sessions)
      .values({ circleId: c.id, venueId: v.id, startsAt: Date.now(), status: "played" })
      .returning();
    await client.db.insert(rsvps).values({ sessionId: s.id, userId: u.id, status: "in" });
    expect(await resolvePatch(client.db, u.id)).toBeNull();
  });
});
