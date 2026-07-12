import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  circleMembers,
  circles,
  createTestClient,
  rsvps,
  sessions,
  standingGames,
  users,
  venues,
  type CuatroClient,
  type CuatroDb,
} from "@cuatro/db";
import { createMatchesStoreFromClient, type MatchesStore } from "@/server/matches-db";
import {
  buildHomeFeed,
  HOME_FEED_BOARD_CAP,
  HOME_FEED_OPEN_SLOT_CAP,
} from "@/server/home-feed";

// A Saturday, 12:00 UTC — the reference "now" (same anchor as week.test.ts).
const NOW = new Date(Date.UTC(2026, 6, 11, 12, 0, 0));
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

async function insertUser(db: CuatroDb, email: string, displayName: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db.insert(users).values({ email, displayName, ...extra }).returning();
  return u;
}

async function insertCircle(db: CuatroDb, name: string, createdBy: string, extra: Partial<typeof circles.$inferInsert> = {}) {
  const [c] = await db
    .insert(circles)
    .values({ name, inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy, ...extra })
    .returning();
  return c;
}

async function addMember(db: CuatroDb, circleId: string, userId: string, role: "organiser" | "member" = "member") {
  await db.insert(circleMembers).values({ circleId, userId, role });
}

async function insertSession(
  db: CuatroDb,
  circleId: string,
  opts: Partial<typeof sessions.$inferInsert> & { startsAt: number },
) {
  const [s] = await db.insert(sessions).values({ circleId, status: "played", ...opts }).returning();
  return s;
}

/** A verified doubles result at `playedAt` (recordMatch snapshots the session's startsAt as playedAt). */
async function sealResult(
  db: CuatroDb,
  store: MatchesStore,
  circleId: string,
  four: [string, string, string, string],
  playedAt: number,
) {
  const session = await insertSession(db, circleId, { startsAt: playedAt });
  const { matchId } = await store.recordMatch({
    sessionId: session.id,
    reporterId: four[0],
    teamA: [four[0], four[1]],
    teamB: [four[2], four[3]],
    sets: [{ a: 6, b: 3 }],
  });
  await store.confirmMatch(matchId, four[2]);
  return matchId;
}

describe("buildHomeFeed — the cross-circle home feed", () => {
  let client: CuatroClient;
  let db: CuatroDb;
  let store: MatchesStore;

  beforeEach(async () => {
    client = await createTestClient();
    db = client.db;
    store = createMatchesStoreFromClient(client);
  });

  afterEach(async () => {
    await client.close();
  });

  /** Viewer + three others, members of a fresh circle. */
  async function circleOfFour(name: string, viewerId: string, tag: string) {
    const circle = await insertCircle(db, name, viewerId);
    await addMember(db, circle.id, viewerId, "organiser");
    const others: string[] = [];
    for (let i = 0; i < 3; i++) {
      const u = await insertUser(db, `${tag}-${i}@example.com`, `${tag} ${i}`);
      await addMember(db, circle.id, u.id);
      others.push(u.id);
    }
    return { circle, others };
  }

  it("is empty with hasNoCircles for a viewer in no circle", async () => {
    const loner = await insertUser(db, "loner@example.com", "Lone");
    const feed = await buildHomeFeed(db, loner.id, { now: NOW });
    expect(feed).toEqual({ items: [], hasNoCircles: true });
  });

  it("is empty (but NOT circle-less) when the circles have no activity yet", async () => {
    const viewer = await insertUser(db, "v@example.com", "Viewer");
    await circleOfFour("Sunday Lot", viewer.id, "sl");
    const feed = await buildHomeFeed(db, viewer.id, { now: NOW });
    expect(feed.hasNoCircles).toBe(false);
    expect(feed.items).toEqual([]);
  });

  it("merges results across circles newest first, each carrying its circle's name and flag", async () => {
    const viewer = await insertUser(db, "v@example.com", "Viewer");
    const a = await circleOfFour("Sunday Lot", viewer.id, "sl");
    const b = await circleOfFour("Tuesday Crew", viewer.id, "tc");

    const older = await sealResult(db, store, a.circle.id, [viewer.id, a.others[0], a.others[1], a.others[2]], NOW.getTime() - 3 * DAY_MS);
    const newer = await sealResult(db, store, b.circle.id, [viewer.id, b.others[0], b.others[1], b.others[2]], NOW.getTime() - 1 * DAY_MS);

    const feed = await buildHomeFeed(db, viewer.id, { now: NOW });
    expect(feed.items.map((i) => i.kind)).toEqual(["result", "result"]);
    const [first, second] = feed.items;
    if (first.kind !== "result" || second.kind !== "result") throw new Error("unreachable");
    expect(first.post.matchId).toBe(newer);
    expect(first.circle).toMatchObject({ circleId: b.circle.id, circleName: "Tuesday Crew" });
    expect(second.post.matchId).toBe(older);
    expect(second.circle).toMatchObject({ circleId: a.circle.id, circleName: "Sunday Lot" });
  });

  it("caps the whole feed to `limit`", async () => {
    const viewer = await insertUser(db, "v@example.com", "Viewer");
    const a = await circleOfFour("Sunday Lot", viewer.id, "sl");
    for (let i = 0; i < 3; i++) {
      await sealResult(db, store, a.circle.id, [viewer.id, a.others[0], a.others[1], a.others[2]], NOW.getTime() - (i + 1) * DAY_MS);
    }
    const feed = await buildHomeFeed(db, viewer.id, { now: NOW, limit: 2 });
    expect(feed.items).toHaveLength(2);
  });

  it("leads with an open-slot opportunity when the viewer hasn't answered an open upcoming game", async () => {
    const viewer = await insertUser(db, "v@example.com", "Viewer");
    const a = await circleOfFour("Sunday Lot", viewer.id, "sl");
    await sealResult(db, store, a.circle.id, [viewer.id, a.others[0], a.others[1], a.others[2]], NOW.getTime() - DAY_MS);

    const upcoming = await insertSession(db, a.circle.id, { startsAt: NOW.getTime() + DAY_MS, status: "upcoming" });
    await db.insert(rsvps).values({ sessionId: upcoming.id, userId: a.others[0], status: "in" });
    await db.insert(rsvps).values({ sessionId: upcoming.id, userId: a.others[1], status: "in" });

    const feed = await buildHomeFeed(db, viewer.id, { now: NOW });
    expect(feed.items[0].kind).toBe("open_slot");
    if (feed.items[0].kind !== "open_slot") throw new Error("unreachable");
    expect(feed.items[0].slot).toMatchObject({
      sessionId: upcoming.id,
      circleName: "Sunday Lot",
      slots: 4,
      slotsOpen: 2,
    });
    expect(feed.items[1].kind).toBe("result");
  });

  it("gates opportunities: answered, full, pre-lock rotation and unopened-window games never nag", async () => {
    const viewer = await insertUser(db, "v@example.com", "Viewer");
    const a = await circleOfFour("Sunday Lot", viewer.id, "sl");

    // Answered (even with 'out') — the viewer said no, don't re-ask.
    const answered = await insertSession(db, a.circle.id, { startsAt: NOW.getTime() + DAY_MS, status: "upcoming" });
    await db.insert(rsvps).values({ sessionId: answered.id, userId: viewer.id, status: "out" });

    // Full — nothing to offer.
    const full = await insertSession(db, a.circle.id, { startsAt: NOW.getTime() + 2 * DAY_MS, status: "upcoming" });
    for (const id of a.others) {
      await db.insert(rsvps).values({ sessionId: full.id, userId: id, status: "in" });
    }
    const filler = await insertUser(db, "filler@example.com", "Filler");
    await addMember(db, a.circle.id, filler.id);
    await db.insert(rsvps).values({ sessionId: full.id, userId: filler.id, status: "in" });

    // Rotation pre-lock — available-not-grab, no slot to offer yet.
    const [sg] = await db
      .insert(standingGames)
      .values({ circleId: a.circle.id, weekday: 2, startTime: "20:00", rotationEnabled: true, rotationMode: "limited" })
      .returning();
    await insertSession(db, a.circle.id, {
      startsAt: NOW.getTime() + 3 * DAY_MS,
      status: "upcoming",
      standingGameId: sg.id,
      rotationLockedAt: null,
    });

    // RSVP window not open yet (1-day window, game 3 days out).
    const [narrow] = await db
      .insert(standingGames)
      .values({ circleId: a.circle.id, weekday: 3, startTime: "19:00", rsvpWindowDays: 1 })
      .returning();
    await insertSession(db, a.circle.id, {
      startsAt: NOW.getTime() + 3 * DAY_MS + HOUR_MS,
      status: "upcoming",
      standingGameId: narrow.id,
    });

    const feed = await buildHomeFeed(db, viewer.id, { now: NOW });
    expect(feed.items.filter((i) => i.kind === "open_slot")).toEqual([]);
  });

  it("offers a locked rotation game's open slot (post-lock drops become real spots)", async () => {
    const viewer = await insertUser(db, "v@example.com", "Viewer");
    const a = await circleOfFour("Sunday Lot", viewer.id, "sl");
    const [sg] = await db
      .insert(standingGames)
      .values({ circleId: a.circle.id, weekday: 2, startTime: "20:00", rotationEnabled: true, rotationMode: "limited" })
      .returning();
    const s = await insertSession(db, a.circle.id, {
      startsAt: NOW.getTime() + DAY_MS,
      status: "upcoming",
      standingGameId: sg.id,
      rotationLockedAt: NOW.getTime() - HOUR_MS,
    });
    await db.insert(rsvps).values({ sessionId: s.id, userId: a.others[0], status: "in" });

    const feed = await buildHomeFeed(db, viewer.id, { now: NOW });
    expect(feed.items[0]).toMatchObject({ kind: "open_slot", slot: { sessionId: s.id, slotsOpen: 3 } });
  });

  it("sorts open slots soonest first and caps them", async () => {
    const viewer = await insertUser(db, "v@example.com", "Viewer");
    const a = await circleOfFour("Sunday Lot", viewer.id, "sl");
    const ids: string[] = [];
    for (let i = 0; i < HOME_FEED_OPEN_SLOT_CAP + 2; i++) {
      const s = await insertSession(db, a.circle.id, { startsAt: NOW.getTime() + (6 - i) * 12 * HOUR_MS, status: "upcoming" });
      ids.push(s.id);
    }
    const feed = await buildHomeFeed(db, viewer.id, { now: NOW });
    const slots = feed.items.filter((i) => i.kind === "open_slot");
    expect(slots).toHaveLength(HOME_FEED_OPEN_SLOT_CAP);
    const starts = slots.map((i) => (i.kind === "open_slot" ? i.slot.startsAt : 0));
    expect(starts).toEqual([...starts].sort((x, y) => x - y));
  });

  describe("Board opportunities", () => {
    async function seedBoardWorld(viewerHasPatch: boolean, boardSessionCount = 1) {
      const [pinned] = await db.insert(venues).values({ name: "Viewer Home", lat: 51.5, lng: -0.05 }).returning();
      const viewer = await insertUser(db, "v@example.com", "Viewer", viewerHasPatch ? { homeVenueId: pinned.id } : {});
      const a = await circleOfFour("Sunday Lot", viewer.id, "sl");

      // A nearby circle the viewer is NOT in, with open upcoming games at a pinned venue.
      const stranger = await insertUser(db, "stranger@example.com", "Stranger");
      const nearby = await insertCircle(db, "Bethnal Ballers", stranger.id); // boardEnabled defaults true
      await addMember(db, nearby.id, stranger.id, "organiser");
      const [court] = await db.insert(venues).values({ name: "Nearby Court", lat: 51.505, lng: -0.049 }).returning();
      for (let i = 0; i < boardSessionCount; i++) {
        await db
          .insert(sessions)
          .values({ circleId: nearby.id, venueId: court.id, startsAt: NOW.getTime() + (i + 1) * 6 * HOUR_MS, status: "upcoming" });
      }
      return { viewer, a };
    }

    it("suppresses Board games entirely when no patch resolves", async () => {
      const { viewer } = await seedBoardWorld(false);
      const feed = await buildHomeFeed(db, viewer.id, { now: NOW });
      expect(feed.items.filter((i) => i.kind === "board_game")).toEqual([]);
    });

    it("caps Board games and places them after own-circle open slots, before activity", async () => {
      const { viewer, a } = await seedBoardWorld(true, HOME_FEED_BOARD_CAP + 2);
      await sealResult(db, store, a.circle.id, [viewer.id, a.others[0], a.others[1], a.others[2]], NOW.getTime() - DAY_MS);
      const own = await insertSession(db, a.circle.id, { startsAt: NOW.getTime() + DAY_MS, status: "upcoming" });

      const feed = await buildHomeFeed(db, viewer.id, { now: NOW });
      const kinds = feed.items.map((i) => i.kind);
      expect(kinds).toEqual(["open_slot", "board_game", "board_game", "board_game", "result"]);
      expect(feed.items[0]).toMatchObject({ kind: "open_slot", slot: { sessionId: own.id } });
    });

    it("uses a caller-provided Board list without re-querying discovery", async () => {
      const { viewer } = await seedBoardWorld(true, 2);
      const feed = await buildHomeFeed(db, viewer.id, { now: NOW, board: [] });
      expect(feed.items.filter((i) => i.kind === "board_game")).toEqual([]);
    });
  });
});
