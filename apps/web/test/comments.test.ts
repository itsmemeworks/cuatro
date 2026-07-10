import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { circleMembers, circles, createTestClient, sessions, users, notifications, type CuatroClient, type CuatroDb } from "@cuatro/db";
import { createMatchesStoreFromClient, type MatchesStore } from "@/server/matches-db";
import { addComment, getCommentCounts, listComments, MAX_COMMENT_LENGTH } from "@/server/comments";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";
import { circleChannel } from "@/lib/realtime/channels";

const DAY_MS = 24 * 60 * 60 * 1000;

async function insertUser(db: CuatroDb, email: string, displayName: string) {
  const [u] = await db.insert(users).values({ email, displayName }).returning();
  return u;
}
async function insertCircle(db: CuatroDb, createdBy: string) {
  const [c] = await db
    .insert(circles)
    .values({ name: "Test Circle", inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy })
    .returning();
  return c;
}
async function addMember(db: CuatroDb, circleId: string, userId: string, role: "organiser" | "member" = "member") {
  await db.insert(circleMembers).values({ circleId, userId, role });
}
async function insertSession(db: CuatroDb, circleId: string, startsAt: Date) {
  const [s] = await db.insert(sessions).values({ circleId, startsAt: startsAt.getTime(), status: "played" }).returning();
  return s;
}

async function setUpVerifiedMatch(store: MatchesStore, db: CuatroDb) {
  const organiser = await insertUser(db, "org@example.com", "Organiser");
  const circle = await insertCircle(db, organiser.id);
  await addMember(db, circle.id, organiser.id, "organiser");
  const b = await insertUser(db, "b@example.com", "Bea");
  const c = await insertUser(db, "c@example.com", "Cal");
  const d = await insertUser(db, "d@example.com", "Dee");
  for (const u of [b, c, d]) await addMember(db, circle.id, u.id);
  const outsider = await insertUser(db, "outsider@example.com", "Outsider");

  const session = await insertSession(db, circle.id, new Date(Date.now() - DAY_MS));
  const { matchId } = await store.recordMatch({
    sessionId: session.id,
    reporterId: organiser.id,
    teamA: [organiser.id, b.id],
    teamB: [c.id, d.id],
    sets: [{ a: 6, b: 2 }],
  });
  await store.confirmMatch(matchId, c.id);

  return { organiser, b, c, d, outsider, circle, matchId };
}

describe("server/comments — 💬 on a verified match's Feed result post", () => {
  let client: CuatroClient;
  let store: MatchesStore;
  let db: CuatroDb;

  afterEach(async () => {
    await client?.close();
    __setRealtimeSenderForTests(null);
  });

  it("posts a comment, gates on circle membership and verified status", async () => {
    client = await createTestClient();
    store = createMatchesStoreFromClient(client);
    db = client.db;
    const { organiser, outsider, matchId } = await setUpVerifiedMatch(store, db);

    expect(await addComment(db, matchId, outsider.id, "nice one")).toEqual({ ok: false, error: "not_a_circle_member" });

    const result = await addComment(db, matchId, organiser.id, "  great game  ");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.comment.body).toBe("great game"); // trimmed
    expect(result.comment.displayName).toBe("Organiser");
    expect(result.count).toBe(1);
  });

  it("rejects an empty body and a body over MAX_COMMENT_LENGTH", async () => {
    client = await createTestClient();
    store = createMatchesStoreFromClient(client);
    db = client.db;
    const { organiser, matchId } = await setUpVerifiedMatch(store, db);

    expect(MAX_COMMENT_LENGTH).toBe(1000);
    expect(await addComment(db, matchId, organiser.id, "   ")).toEqual({ ok: false, error: "empty_body" });
    expect(await addComment(db, matchId, organiser.id, "x".repeat(MAX_COMMENT_LENGTH + 1))).toEqual({ ok: false, error: "too_long" });
  });

  it("rejects commenting on a match that hasn't been verified yet", async () => {
    client = await createTestClient();
    store = createMatchesStoreFromClient(client);
    db = client.db;
    const organiser = await insertUser(db, "org2@example.com", "Organiser2");
    const circle = await insertCircle(db, organiser.id);
    await addMember(db, circle.id, organiser.id, "organiser");
    const b = await insertUser(db, "b2@example.com", "B2");
    const c = await insertUser(db, "c2@example.com", "C2");
    const d = await insertUser(db, "d2@example.com", "D2");
    for (const u of [b, c, d]) await addMember(db, circle.id, u.id);

    const session = await insertSession(db, circle.id, new Date());
    const { matchId } = await store.recordMatch({
      sessionId: session.id,
      reporterId: organiser.id,
      teamA: [organiser.id, b.id],
      teamB: [c.id, d.id],
      sets: [{ a: 6, b: 2 }],
    });

    expect(await addComment(db, matchId, b.id, "hi")).toEqual({ ok: false, error: "match_not_verified" });
  });

  it("lists comments oldest-first, same gates as posting", async () => {
    client = await createTestClient();
    store = createMatchesStoreFromClient(client);
    db = client.db;
    const { organiser, b, outsider, matchId } = await setUpVerifiedMatch(store, db);

    await addComment(db, matchId, organiser.id, "first");
    await addComment(db, matchId, b.id, "second");

    const outcome = await listComments(db, matchId, organiser.id);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.comments.map((c) => c.body)).toEqual(["first", "second"]);

    expect(await listComments(db, matchId, outsider.id)).toEqual({ ok: false, error: "not_a_circle_member" });
  });

  it("notifies the OTHER three participants on the first comment only", async () => {
    client = await createTestClient();
    store = createMatchesStoreFromClient(client);
    db = client.db;
    const { organiser, b, c, d, matchId } = await setUpVerifiedMatch(store, db);

    await addComment(db, matchId, organiser.id, "first comment");
    const afterFirst = await db.select().from(notifications).where(eq(notifications.type, "match_comment"));
    const notifiedUserIds = afterFirst.map((n) => n.userId).sort();
    expect(notifiedUserIds).toEqual([b.id, c.id, d.id].sort());

    await addComment(db, matchId, b.id, "second comment");
    const afterSecond = await db.select().from(notifications).where(eq(notifications.type, "match_comment"));
    expect(afterSecond).toHaveLength(3); // no new notifications on the second comment
  });

  it("broadcasts a comment event on the circle channel", async () => {
    const events: { topic: string; type: string }[] = [];
    __setRealtimeSenderForTests(async (topic, type) => {
      events.push({ topic, type });
    });

    client = await createTestClient();
    store = createMatchesStoreFromClient(client);
    db = client.db;
    const { organiser, circle, matchId } = await setUpVerifiedMatch(store, db);
    events.length = 0; // drop match-record/confirm broadcasts

    await addComment(db, matchId, organiser.id, "hi");
    expect(events).toContainEqual({ topic: circleChannel(circle.id), type: "comment" });
  });

  it("getCommentCounts batches counts across matches, defaulting missing matches to absent (not zero-filled)", async () => {
    client = await createTestClient();
    store = createMatchesStoreFromClient(client);
    db = client.db;
    const { organiser, b, matchId } = await setUpVerifiedMatch(store, db);
    await addComment(db, matchId, organiser.id, "one");
    await addComment(db, matchId, b.id, "two");

    const counts = await getCommentCounts(db, [matchId, "no-such-match"]);
    expect(counts.get(matchId)).toBe(2);
    expect(counts.has("no-such-match")).toBe(false);
    expect(await getCommentCounts(db, [])).toEqual(new Map());
  });
});
