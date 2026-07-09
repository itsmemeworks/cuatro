import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  createClient,
  circleMembers,
  circles,
  knocks,
  notifications,
  standingGames,
  users,
  venues,
  type CuatroClient,
} from "@cuatro/db";
import {
  circleAnchor,
  circleKnocks,
  circlePreview,
  createCircleKnock,
  decideCircleKnock,
  nearbyCircles,
  withdrawCircleKnock,
} from "@/server/open-door";
import { NotMemberError, NotOrganiserError, createCirclesStore, __resetCirclesStoreForTests } from "@/server/circles";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";

// Real London pins from the geo contract §7. Distances from Shoreditch:
// Stratford ≈ 5.1 km (inside 10), Wandsworth ≈ 11.0 km (just OUTSIDE 10).
const SHOREDITCH = { lat: 51.5265, lng: -0.0805 };
const STRATFORD = { lat: 51.5432, lng: -0.0125 };
const WANDSWORTH = { lat: 51.4571, lng: -0.1931 };

describe("Open Door", () => {
  let client: CuatroClient;
  let db: CuatroClient["db"];
  let inviteSeq = 0;

  const mkVenue = async (name: string, pin: { lat: number; lng: number } | null) => {
    const [v] = await db
      .insert(venues)
      .values({ name, lat: pin?.lat ?? null, lng: pin?.lng ?? null })
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

  const mkCircle = async (
    createdBy: string,
    overrides: Partial<typeof circles.$inferInsert> = {},
  ) => {
    const [c] = await db
      .insert(circles)
      .values({ name: "C", inviteCode: `INV${inviteSeq++}`, createdBy, ...overrides })
      .returning();
    return c;
  };

  const addMember = async (circleId: string, userId: string, role: "organiser" | "member" = "member") => {
    await db.insert(circleMembers).values({ circleId, userId, role });
  };

  const addStandingGame = async (circleId: string, venueId: string) => {
    await db.insert(standingGames).values({ circleId, venueId, weekday: 2, startTime: "20:00" });
  };

  beforeEach(() => {
    client = createClient(":memory:");
    db = client.db;
    __setRealtimeSenderForTests(null);
    __resetCirclesStoreForTests();
    inviteSeq = 0;
  });

  afterEach(() => {
    client.close();
    __setRealtimeSenderForTests(null);
    __resetCirclesStoreForTests();
  });

  async function scenario() {
    const shoreditch = await mkVenue("Powerleague Shoreditch", SHOREDITCH);
    const stratford = await mkVenue("Padel Social Club Stratford", STRATFORD);
    const wandsworth = await mkVenue("Rocket Padel Wandsworth", WANDSWORTH);

    // Viewer anchored at Shoreditch via home venue.
    const viewer = await mkUser({ displayName: "Viewer", homeVenueId: shoreditch.id });
    const organiser = await mkUser({ displayName: "Olive Organiser", rating: 4.0 });

    // A Stratford-anchored OPEN circle the viewer isn't in (should surface, 5 km).
    const stratOpen = await mkCircle(organiser.id, {
      name: "Stratford Open",
      vibeLine: "Friendly Tuesday four in Stratford.",
    });
    await addStandingGame(stratOpen.id, stratford.id);
    await addMember(stratOpen.id, organiser.id, "organiser");
    // members: two rated + one unrated + one guest (guest must be ignored).
    await addMember(stratOpen.id, (await mkUser({ displayName: "Rated A", rating: 3.4 })).id);
    await addMember(stratOpen.id, (await mkUser({ displayName: "Rated B", rating: 4.1 })).id);
    await addMember(stratOpen.id, (await mkUser({ displayName: "New", rating: null })).id);
    await addMember(stratOpen.id, (await mkUser({ displayName: "Guest", isGuest: true, rating: 6.0 })).id);

    // A Wandsworth-anchored open circle — 11 km, OUTSIDE the default radius.
    const wandOpen = await mkCircle(organiser.id, { name: "Wandsworth Open" });
    await addStandingGame(wandOpen.id, wandsworth.id);

    // A Stratford circle the viewer already belongs to (must be excluded).
    const memberCircle = await mkCircle(organiser.id, { name: "My Circle" });
    await addStandingGame(memberCircle.id, stratford.id);
    await addMember(memberCircle.id, viewer.id);

    // A Stratford circle with the door CLOSED (must be excluded).
    const closed = await mkCircle(organiser.id, { name: "Closed Circle", openDoor: false });
    await addStandingGame(closed.id, stratford.id);

    return { viewer, organiser, stratOpen, wandOpen, memberCircle, closed, shoreditch, stratford, wandsworth };
  }

  it("anchors a circle to its most-used pinned venue", async () => {
    const organiser = await mkUser();
    const stratford = await mkVenue("Stratford", STRATFORD);
    const shoreditch = await mkVenue("Shoreditch", SHOREDITCH);
    const c = await mkCircle(organiser.id);
    // Two standing games at Stratford, one at Shoreditch → Stratford wins.
    await addStandingGame(c.id, stratford.id);
    await addStandingGame(c.id, stratford.id);
    await addStandingGame(c.id, shoreditch.id);
    const anchor = await circleAnchor(db, c.id);
    expect(anchor?.venueName).toBe("Stratford");
  });

  it("surfaces a nearby open circle but not the 11 km one, the joined one, or the closed one", async () => {
    const { viewer, stratOpen } = await scenario();
    const near = await nearbyCircles(db, viewer.id);
    expect(near.map((c) => c.circleId)).toEqual([stratOpen.id]);
    const card = near[0];
    expect(card.name).toBe("Stratford Open");
    expect(card.vibeLine).toBe("Friendly Tuesday four in Stratford.");
    expect(card.venueArea).toBe("Padel Social Club Stratford");
    expect(card.distanceLabel).toMatch(/km away$/);
    expect(card.cadence).toBe("Tuesdays 20:00");
    // organiser(4.0) + Rated A(3.4) + Rated B(4.1) + unrated New; guest excluded.
    expect(card.memberCount).toBe(4);
    expect(card.level).toEqual({ min: 3.4, max: 4.1 });
    expect(card.unratedCount).toBe(1);
    expect(card.hasPendingKnock).toBe(false);
  });

  it("returns an empty directory for a viewer with no patch", async () => {
    await scenario();
    const noPatch = await mkUser({ displayName: "Nomad" });
    expect(await nearbyCircles(db, noPatch.id)).toEqual([]);
  });

  it("keeps a pending-knock circle in the directory, flagged", async () => {
    const { viewer, stratOpen } = await scenario();
    const created = await createCircleKnock(db, { circleId: stratOpen.id, userId: viewer.id });
    expect(created.ok).toBe(true);
    const near = await nearbyCircles(db, viewer.id);
    expect(near).toHaveLength(1);
    expect(near[0].hasPendingKnock).toBe(true);
  });

  it("notifies every organiser when a knock arrives", async () => {
    const { viewer, organiser, stratOpen } = await scenario();
    const coOrg = await mkUser({ displayName: "Co Organiser" });
    await addMember(stratOpen.id, coOrg.id, "organiser");

    const res = await createCircleKnock(db, { circleId: stratOpen.id, userId: viewer.id, message: "hi!" });
    expect(res.ok).toBe(true);

    for (const orgId of [organiser.id, coOrg.id]) {
      const rows = await db.select().from(notifications).where(and(eq(notifications.userId, orgId), eq(notifications.type, "knock_received")));
      expect(rows).toHaveLength(1);
    }
    // organiser panel sees it
    const panel = await circleKnocks(db, stratOpen.id, organiser.id);
    expect(panel).toHaveLength(1);
    expect(panel[0].message).toBe("hi!");
    expect(panel[0].distanceLabel).toMatch(/km away$/); // viewer's Shoreditch → Stratford anchor
  });

  it("accept creates a real membership, notifies the knocker, and the circle appears in their list", async () => {
    const { viewer, organiser, stratOpen } = await scenario();
    const created = await createCircleKnock(db, { circleId: stratOpen.id, userId: viewer.id });
    if (!created.ok) throw new Error("knock failed");

    const decided = await decideCircleKnock(db, { knockId: created.knockId, organiserId: organiser.id, action: "accept" });
    expect(decided.ok).toBe(true);

    // real circle_members row
    const membership = await db
      .select()
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, stratOpen.id), eq(circleMembers.userId, viewer.id)));
    expect(membership).toHaveLength(1);
    expect(membership[0].role).toBe("member");

    // knock accepted
    const [k] = await db.select().from(knocks).where(eq(knocks.id, created.knockId));
    expect(k.status).toBe("accepted");
    expect(k.decidedBy).toBe(organiser.id);

    // knocker notified
    const notif = await db.select().from(notifications).where(and(eq(notifications.userId, viewer.id), eq(notifications.type, "knock_accepted")));
    expect(notif).toHaveLength(1);

    // circle is now theirs (via the shared listCirclesForUser path) and gone from their directory
    const boundStore = createCirclesStore(db);
    const mine = await boundStore.listCirclesForUser(viewer.id);
    expect(mine.map((c) => c.id)).toContain(stratOpen.id);
    const near = await nearbyCircles(db, viewer.id);
    expect(near.map((c) => c.circleId)).not.toContain(stratOpen.id);
  });

  it("decline notifies the knocker and creates no membership", async () => {
    const { viewer, organiser, stratOpen } = await scenario();
    const created = await createCircleKnock(db, { circleId: stratOpen.id, userId: viewer.id });
    if (!created.ok) throw new Error("knock failed");

    const decided = await decideCircleKnock(db, { knockId: created.knockId, organiserId: organiser.id, action: "decline" });
    expect(decided.ok).toBe(true);

    const membership = await db
      .select()
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, stratOpen.id), eq(circleMembers.userId, viewer.id)));
    expect(membership).toHaveLength(0);

    const notif = await db.select().from(notifications).where(and(eq(notifications.userId, viewer.id), eq(notifications.type, "knock_declined")));
    expect(notif).toHaveLength(1);
  });

  it("rejects a duplicate pending knock but allows a re-knock after withdraw", async () => {
    const { viewer, stratOpen } = await scenario();
    const first = await createCircleKnock(db, { circleId: stratOpen.id, userId: viewer.id });
    expect(first.ok).toBe(true);

    const dup = await createCircleKnock(db, { circleId: stratOpen.id, userId: viewer.id });
    expect(dup).toEqual({ ok: false, error: "already_knocked" });

    await withdrawCircleKnock(db, { circleId: stratOpen.id, userId: viewer.id });
    const again = await createCircleKnock(db, { circleId: stratOpen.id, userId: viewer.id });
    expect(again.ok).toBe(true);
  });

  it("rejects knocks on a closed door, on a circle you're in, and from a guest", async () => {
    const { viewer, memberCircle, closed } = await scenario();
    expect((await createCircleKnock(db, { circleId: closed.id, userId: viewer.id })).ok).toBe(false);
    expect(await createCircleKnock(db, { circleId: closed.id, userId: viewer.id })).toEqual({ ok: false, error: "door_closed" });
    expect(await createCircleKnock(db, { circleId: memberCircle.id, userId: viewer.id })).toEqual({ ok: false, error: "already_member" });

    const guest = await mkUser({ displayName: "Guest", isGuest: true });
    const { stratOpen } = await scenario();
    expect(await createCircleKnock(db, { circleId: stratOpen.id, userId: guest.id })).toEqual({ ok: false, error: "is_guest" });
  });

  it("only an organiser can read the knock inbox", async () => {
    const { viewer, stratOpen } = await scenario();
    const stranger = await mkUser();
    await expect(circleKnocks(db, stratOpen.id, stranger.id)).rejects.toBeInstanceOf(NotMemberError);
    const plainMember = await mkUser();
    await addMember(stratOpen.id, plainMember.id, "member");
    await expect(circleKnocks(db, stratOpen.id, plainMember.id)).rejects.toBeInstanceOf(NotOrganiserError);
    void viewer;
  });

  it("only an organiser can decide, and a knock can't be decided twice", async () => {
    const { viewer, organiser, stratOpen } = await scenario();
    const created = await createCircleKnock(db, { circleId: stratOpen.id, userId: viewer.id });
    if (!created.ok) throw new Error("knock failed");

    const stranger = await mkUser();
    expect(await decideCircleKnock(db, { knockId: created.knockId, organiserId: stranger.id, action: "accept" })).toEqual({
      ok: false,
      error: "not_organiser",
    });

    expect((await decideCircleKnock(db, { knockId: created.knockId, organiserId: organiser.id, action: "accept" })).ok).toBe(true);
    expect(await decideCircleKnock(db, { knockId: created.knockId, organiserId: organiser.id, action: "decline" })).toEqual({
      ok: false,
      error: "already_decided",
    });
  });

  it("exposes only public group facts in the preview", async () => {
    const { viewer, stratOpen } = await scenario();
    const preview = await circlePreview(db, stratOpen.id, viewer.id);
    expect(preview).not.toBeNull();
    expect(preview!.name).toBe("Stratford Open");
    expect(preview!.venueArea).toBe("Padel Social Club Stratford");
    expect(preview!.cadence).toBe("Tuesdays 20:00");
    expect(preview!.level).toEqual({ min: 3.4, max: 4.1 });
    expect(preview!.unratedCount).toBe(1);
    expect(preview!.memberCount).toBe(4);
    // The preview object has no member list, chat, tab, or coordinates.
    expect(Object.keys(preview!).sort()).toEqual(
      ["cadence", "circleId", "colour", "distanceLabel", "emblem", "hasPendingKnock", "level", "memberCount", "name", "unratedCount", "venueArea", "vibeLine"].sort(),
    );
  });

  it("respects a custom radius that reaches Wandsworth", async () => {
    const { viewer, stratOpen, wandOpen } = await scenario();
    const near = await nearbyCircles(db, viewer.id, { radiusKm: 15 });
    const ids = near.map((c) => c.circleId);
    expect(ids).toContain(stratOpen.id);
    expect(ids).toContain(wandOpen.id);
  });

  it("persists door settings and clears the vibe line on empty", async () => {
    const organiser = await mkUser();
    const stratford = await mkVenue("Stratford", STRATFORD);
    const c = await mkCircle(organiser.id, { vibeLine: "old line" });
    await addStandingGame(c.id, stratford.id);
    await addMember(c.id, organiser.id, "organiser");

    // Bind a store to our in-memory db (getCirclesStore would open its own).
    const boundStore = createCirclesStore(db);
    await boundStore.updateCircleSettings(c.id, organiser.id, { openDoor: false, vibeLine: "new vibe" });
    let [row] = await db.select().from(circles).where(eq(circles.id, c.id));
    expect(row.openDoor).toBe(false);
    expect(row.vibeLine).toBe("new vibe");

    await boundStore.updateCircleSettings(c.id, organiser.id, { vibeLine: "   " });
    [row] = await db.select().from(circles).where(eq(circles.id, c.id));
    expect(row.vibeLine).toBeNull();
  });
});
