import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { circleMembers, circles, sessions, standingGames, users, type CuatroDb } from "@cuatro/db";
import { createMatchesStore, type MatchesStore } from "@/server/matches-db";
import { computeRivalryCallout, listRecentResultsForCircle, toggleRespect, MIN_RIVALRY_STREAK } from "@/server/feed";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";
import { circleChannel } from "@/lib/realtime/channels";

const DAY_MS = 24 * 60 * 60 * 1000;

function insertUser(db: CuatroDb, email: string, displayName: string) {
  return db.insert(users).values({ email, displayName }).returning().get();
}

function insertCircle(db: CuatroDb, createdBy: string) {
  return db
    .insert(circles)
    .values({ name: "Test Circle", inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy })
    .returning()
    .get();
}

function addMember(db: CuatroDb, circleId: string, userId: string, role: "organiser" | "member" = "member") {
  db.insert(circleMembers).values({ circleId, userId, role }).run();
}

function insertSession(db: CuatroDb, circleId: string, startsAt: Date) {
  return db.insert(sessions).values({ circleId, startsAt, status: "played" }).returning().get();
}

describe("server/feed — circle Feed read model", () => {
  let store: MatchesStore;
  let db: CuatroDb;

  beforeEach(() => {
    store = createMatchesStore(":memory:");
    db = store.db;
  });

  afterEach(() => {
    store.close();
    __setRealtimeSenderForTests(null);
  });

  it("returns verified matches with both teams' Glass deltas and a rematch link to the circle when there's no standing game", async () => {
    const organiser = insertUser(db, "org@example.com", "Organiser");
    const circle = insertCircle(db, organiser.id);
    addMember(db, circle.id, organiser.id, "organiser");

    const a = organiser;
    const b = insertUser(db, "b@example.com", "Bea");
    const c = insertUser(db, "c@example.com", "Cal");
    const d = insertUser(db, "d@example.com", "Dee");
    for (const u of [b, c, d]) addMember(db, circle.id, u.id);

    const session = insertSession(db, circle.id, new Date(Date.now() - DAY_MS));
    const { matchId } = await store.recordMatch({
      sessionId: session.id,
      reporterId: a.id,
      teamA: [a.id, b.id],
      teamB: [c.id, d.id],
      sets: [{ a: 6, b: 3 }],
    });
    await store.confirmMatch(matchId, c.id);

    const { posts, rivalry } = listRecentResultsForCircle(db, circle.id, a.id);
    expect(posts).toHaveLength(1);
    const post = posts[0];
    expect(post.matchId).toBe(matchId);
    expect(post.winner).toBe("A");
    expect(post.teamA.players.map((p) => p.userId).sort()).toEqual([a.id, b.id].sort());
    expect(post.teamB.players.map((p) => p.userId).sort()).toEqual([c.id, d.id].sort());
    expect(post.teamA.avgDelta).not.toBeNull();
    expect(post.teamB.avgDelta).not.toBeNull();
    expect(post.teamA.avgDelta!).toBeGreaterThan(0); // winners gain
    expect(post.teamB.avgDelta!).toBeLessThan(0); // losers lose
    expect(post.respectCount).toBe(0);
    expect(post.viewerRespected).toBe(false);
    expect(post.rematchHref).toBe(`/circles/${circle.id}`);
    // No rivalry yet — only one match played between any pairing.
    expect(rivalry).toBeNull();
  });

  it("links rematch to the circle's active standing game when one exists", async () => {
    const organiser = insertUser(db, "org2@example.com", "Organiser2");
    const circle = insertCircle(db, organiser.id);
    addMember(db, circle.id, organiser.id, "organiser");
    const sg = db.insert(standingGames).values({ circleId: circle.id, weekday: 2, startTime: "20:00" }).returning().get();

    const b = insertUser(db, "b2@example.com", "B2");
    const c = insertUser(db, "c2@example.com", "C2");
    const d = insertUser(db, "d2@example.com", "D2");
    for (const u of [b, c, d]) addMember(db, circle.id, u.id);

    const session = insertSession(db, circle.id, new Date(Date.now() - DAY_MS));
    const { matchId } = await store.recordMatch({
      sessionId: session.id,
      reporterId: organiser.id,
      teamA: [organiser.id, b.id],
      teamB: [c.id, d.id],
      sets: [{ a: 6, b: 2 }],
    });
    await store.confirmMatch(matchId, c.id);

    const { posts } = listRecentResultsForCircle(db, circle.id, organiser.id);
    expect(posts[0].rematchHref).toBe(`/games/standing/${sg.id}`);
  });

  it("excludes unverified matches and caps to `limit` most recent, newest first", async () => {
    const organiser = insertUser(db, "org3@example.com", "Organiser3");
    const circle = insertCircle(db, organiser.id);
    addMember(db, circle.id, organiser.id, "organiser");
    const b = insertUser(db, "b3@example.com", "B3");
    const c = insertUser(db, "c3@example.com", "C3");
    const d = insertUser(db, "d3@example.com", "D3");
    for (const u of [b, c, d]) addMember(db, circle.id, u.id);

    const matchIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const session = insertSession(db, circle.id, new Date(Date.now() - (5 - i) * DAY_MS));
      const { matchId } = await store.recordMatch({
        sessionId: session.id,
        reporterId: organiser.id,
        teamA: [organiser.id, b.id],
        teamB: [c.id, d.id],
        sets: [{ a: 6, b: 2 }],
      });
      matchIds.push(matchId);
      await store.confirmMatch(matchId, c.id);
    }
    // An unverified (pending) match should never show up in the Feed.
    const pendingSession = insertSession(db, circle.id, new Date());
    await store.recordMatch({
      sessionId: pendingSession.id,
      reporterId: organiser.id,
      teamA: [organiser.id, b.id],
      teamB: [c.id, d.id],
      sets: [{ a: 6, b: 1 }],
    });

    const { posts } = listRecentResultsForCircle(db, circle.id, organiser.id, 2);
    expect(posts).toHaveLength(2);
    expect(posts.map((p) => p.matchId)).toEqual([matchIds[2], matchIds[1]]); // newest first
  });

  describe("toggleRespect", () => {
    it("is idempotent — toggling twice returns to unrespected with the count back at zero", async () => {
      const organiser = insertUser(db, "org4@example.com", "Organiser4");
      const circle = insertCircle(db, organiser.id);
      addMember(db, circle.id, organiser.id, "organiser");
      const b = insertUser(db, "b4@example.com", "B4");
      const c = insertUser(db, "c4@example.com", "C4");
      const d = insertUser(db, "d4@example.com", "D4");
      for (const u of [b, c, d]) addMember(db, circle.id, u.id);

      const session = insertSession(db, circle.id, new Date(Date.now() - DAY_MS));
      const { matchId } = await store.recordMatch({
        sessionId: session.id,
        reporterId: organiser.id,
        teamA: [organiser.id, b.id],
        teamB: [c.id, d.id],
        sets: [{ a: 6, b: 2 }],
      });
      await store.confirmMatch(matchId, c.id);

      const first = toggleRespect(db, matchId, b.id);
      expect(first).toEqual({ ok: true, respected: true, count: 1 });

      const second = toggleRespect(db, matchId, b.id);
      expect(second).toEqual({ ok: true, respected: false, count: 0 });

      // A repeat "respect" from someone else still counts correctly.
      const third = toggleRespect(db, matchId, c.id);
      expect(third).toEqual({ ok: true, respected: true, count: 1 });
    });

    it("rejects a non-circle-member", async () => {
      const organiser = insertUser(db, "org5@example.com", "Organiser5");
      const circle = insertCircle(db, organiser.id);
      addMember(db, circle.id, organiser.id, "organiser");
      const b = insertUser(db, "b5@example.com", "B5");
      const c = insertUser(db, "c5@example.com", "C5");
      const d = insertUser(db, "d5@example.com", "D5");
      for (const u of [b, c, d]) addMember(db, circle.id, u.id);
      const outsider = insertUser(db, "outsider@example.com", "Outsider");

      const session = insertSession(db, circle.id, new Date(Date.now() - DAY_MS));
      const { matchId } = await store.recordMatch({
        sessionId: session.id,
        reporterId: organiser.id,
        teamA: [organiser.id, b.id],
        teamB: [c.id, d.id],
        sets: [{ a: 6, b: 2 }],
      });
      await store.confirmMatch(matchId, c.id);

      expect(toggleRespect(db, matchId, outsider.id)).toEqual({ ok: false, error: "not_a_circle_member" });
    });

    it("rejects a match that hasn't been verified yet", async () => {
      const organiser = insertUser(db, "org6@example.com", "Organiser6");
      const circle = insertCircle(db, organiser.id);
      addMember(db, circle.id, organiser.id, "organiser");
      const b = insertUser(db, "b6@example.com", "B6");
      const c = insertUser(db, "c6@example.com", "C6");
      const d = insertUser(db, "d6@example.com", "D6");
      for (const u of [b, c, d]) addMember(db, circle.id, u.id);

      const session = insertSession(db, circle.id, new Date());
      const { matchId } = await store.recordMatch({
        sessionId: session.id,
        reporterId: organiser.id,
        teamA: [organiser.id, b.id],
        teamB: [c.id, d.id],
        sets: [{ a: 6, b: 2 }],
      });

      expect(toggleRespect(db, matchId, b.id)).toEqual({ ok: false, error: "match_not_verified" });
    });

    it("broadcasts a reaction event on the circle channel", async () => {
      const events: { topic: string; type: string }[] = [];
      __setRealtimeSenderForTests(async (topic, type) => {
        events.push({ topic, type });
      });

      const organiser = insertUser(db, "org7@example.com", "Organiser7");
      const circle = insertCircle(db, organiser.id);
      addMember(db, circle.id, organiser.id, "organiser");
      const b = insertUser(db, "b7@example.com", "B7");
      const c = insertUser(db, "c7@example.com", "C7");
      const d = insertUser(db, "d7@example.com", "D7");
      for (const u of [b, c, d]) addMember(db, circle.id, u.id);

      const session = insertSession(db, circle.id, new Date(Date.now() - DAY_MS));
      const { matchId } = await store.recordMatch({
        sessionId: session.id,
        reporterId: organiser.id,
        teamA: [organiser.id, b.id],
        teamB: [c.id, d.id],
        sets: [{ a: 6, b: 2 }],
      });
      await store.confirmMatch(matchId, c.id);
      events.length = 0; // drop the match-confirm broadcasts, keep only the reaction one

      toggleRespect(db, matchId, b.id);
      expect(events).toContainEqual({ topic: circleChannel(circle.id), type: "reaction" });
    });
  });
});

describe("computeRivalryCallout (pure)", () => {
  const nameOf = (id: string) => ({ v: "Viewer", k: "K", m: "M" })[id] ?? id;

  function match(id: string, playedAtMs: number, teamA: [string, string], teamB: [string, string], winner: "A" | "B") {
    return { id, playedAt: new Date(playedAtMs), teamA, teamB, winner: winner as "A" | "B" };
  }

  it("returns null below MIN_RIVALRY_STREAK", () => {
    expect(MIN_RIVALRY_STREAK).toBe(3);
    const matches = [
      match("1", 3, ["v", "x1"], ["k", "x2"], "B"), // k's team won
      match("2", 2, ["v", "x1"], ["k", "x2"], "B"),
    ];
    expect(matches).toHaveLength(MIN_RIVALRY_STREAK - 1);
    expect(computeRivalryCallout(matches, "v", nameOf)).toBeNull();
  });

  it("detects a losing streak against the same opponent (\"K has beaten you N times running\")", () => {
    const matches = [
      match("1", 5, ["v", "x1"], ["k", "x2"], "B"),
      match("2", 4, ["v", "x1"], ["k", "x2"], "B"),
      match("3", 3, ["v", "x1"], ["k", "x2"], "B"),
    ];
    const callout = computeRivalryCallout(matches, "v", nameOf);
    expect(callout).toEqual({ opponentUserId: "k", opponentName: "K", count: 3, direction: "lost_to" });
  });

  it("detects a winning streak (\"You've beaten K N times running\")", () => {
    const matches = [
      match("1", 5, ["v", "x1"], ["k", "x2"], "A"),
      match("2", 4, ["v", "x1"], ["k", "x2"], "A"),
      match("3", 3, ["v", "x1"], ["k", "x2"], "A"),
    ];
    const callout = computeRivalryCallout(matches, "v", nameOf);
    expect(callout).toEqual({ opponentUserId: "k", opponentName: "K", count: 3, direction: "beaten" });
  });

  it("resets the streak count at the most recent flip rather than counting through it", () => {
    // Chronological order (playedAt ascending, so higher = more recent):
    // v beat k four times, then LOST to k once, then beat k three more
    // times (most recent). The *current* streak (walking back from the
    // most recent match) is 3, not 7 — the loss in between resets it
    // rather than merely interrupting a running total. (The post-reset
    // streak is deliberately kept >= MIN_RIVALRY_STREAK here so this test
    // isn't conflated with the separate below-threshold behaviour.)
    const matches = [
      match("1", 1, ["v", "x1"], ["k", "x2"], "A"), // oldest: v won
      match("2", 2, ["v", "x1"], ["k", "x2"], "A"),
      match("3", 3, ["v", "x1"], ["k", "x2"], "A"),
      match("4", 4, ["v", "x1"], ["k", "x2"], "A"),
      match("5", 5, ["v", "x1"], ["k", "x2"], "B"), // v lost
      match("6", 6, ["v", "x1"], ["k", "x2"], "A"),
      match("7", 7, ["v", "x1"], ["k", "x2"], "A"),
      match("8", 8, ["v", "x1"], ["k", "x2"], "A"), // newest: v won
    ];
    const callout = computeRivalryCallout(matches, "v", nameOf);
    expect(callout).toEqual({ opponentUserId: "k", opponentName: "K", count: 3, direction: "beaten" });
  });

  it("breaks ties in identical playedAt timestamps deterministically by match id", () => {
    // Two matches share the exact same instant; ordering must not depend on
    // array insertion order for the result to be reproducible.
    const sameInstant = 1000;
    const forward = [
      match("aaa", sameInstant, ["v", "x1"], ["k", "x2"], "B"),
      match("bbb", sameInstant, ["v", "x1"], ["k", "x2"], "B"),
      match("ccc", sameInstant - 1, ["v", "x1"], ["k", "x2"], "B"),
    ];
    const reversed = [...forward].reverse();

    const a = computeRivalryCallout(forward, "v", nameOf);
    const b = computeRivalryCallout(reversed, "v", nameOf);
    expect(a).toEqual(b);
    expect(a).toEqual({ opponentUserId: "k", opponentName: "K", count: 3, direction: "lost_to" });
  });

  it("picks the longest streak across multiple opponents", () => {
    // Distinct partner ids per opponent (x2k vs x2m) so the two rivalries'
    // matches don't conflate into one shared "partner" streak.
    const matches = [
      // vs k: only 2 in a row (below threshold)
      match("1", 10, ["v", "x1"], ["k", "x2k"], "B"),
      match("2", 9, ["v", "x1"], ["k", "x2k"], "B"),
      // vs m: 4 in a row
      match("3", 8, ["v", "x1"], ["m", "x2m"], "B"),
      match("4", 7, ["v", "x1"], ["m", "x2m"], "B"),
      match("5", 6, ["v", "x1"], ["m", "x2m"], "B"),
      match("6", 5, ["v", "x1"], ["m", "x2m"], "B"),
    ];
    const callout = computeRivalryCallout(matches, "v", nameOf);
    expect(callout?.opponentUserId).toBe("m");
    expect(callout?.count).toBe(4);
  });

  it("ignores matches the viewer wasn't part of", () => {
    const matches = [match("1", 1, ["k", "m"], ["x1", "x2"], "A")];
    expect(computeRivalryCallout(matches, "v", nameOf)).toBeNull();
  });
});
