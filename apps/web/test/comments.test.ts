import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { circleMembers, circles, sessions, users, notifications, type CuatroDb } from "@cuatro/db";
import { createMatchesStore, type MatchesStore } from "@/server/matches-db";
import { addComment, getCommentCounts, listComments, MAX_COMMENT_LENGTH } from "@/server/comments";
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

async function setUpVerifiedMatch(store: MatchesStore, db: CuatroDb) {
  const organiser = insertUser(db, "org@example.com", "Organiser");
  const circle = insertCircle(db, organiser.id);
  addMember(db, circle.id, organiser.id, "organiser");
  const b = insertUser(db, "b@example.com", "Bea");
  const c = insertUser(db, "c@example.com", "Cal");
  const d = insertUser(db, "d@example.com", "Dee");
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

  return { organiser, b, c, d, outsider, circle, matchId };
}

describe("server/comments — 💬 on a verified match's Feed result post", () => {
  let store: MatchesStore;
  let db: CuatroDb;

  afterEach(() => {
    store?.close();
    __setRealtimeSenderForTests(null);
  });

  it("posts a comment, gates on circle membership and verified status", async () => {
    store = createMatchesStore(":memory:");
    db = store.db;
    const { organiser, outsider, matchId } = await setUpVerifiedMatch(store, db);

    expect(addComment(db, matchId, outsider.id, "nice one")).toEqual({ ok: false, error: "not_a_circle_member" });

    const result = addComment(db, matchId, organiser.id, "  great game  ");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.comment.body).toBe("great game"); // trimmed
    expect(result.comment.displayName).toBe("Organiser");
    expect(result.count).toBe(1);
  });

  it("rejects an empty body and a body over MAX_COMMENT_LENGTH", async () => {
    store = createMatchesStore(":memory:");
    db = store.db;
    const { organiser, matchId } = await setUpVerifiedMatch(store, db);

    expect(MAX_COMMENT_LENGTH).toBe(1000);
    expect(addComment(db, matchId, organiser.id, "   ")).toEqual({ ok: false, error: "empty_body" });
    expect(addComment(db, matchId, organiser.id, "x".repeat(MAX_COMMENT_LENGTH + 1))).toEqual({ ok: false, error: "too_long" });
  });

  it("rejects commenting on a match that hasn't been verified yet", async () => {
    store = createMatchesStore(":memory:");
    db = store.db;
    const organiser = insertUser(db, "org2@example.com", "Organiser2");
    const circle = insertCircle(db, organiser.id);
    addMember(db, circle.id, organiser.id, "organiser");
    const b = insertUser(db, "b2@example.com", "B2");
    const c = insertUser(db, "c2@example.com", "C2");
    const d = insertUser(db, "d2@example.com", "D2");
    for (const u of [b, c, d]) addMember(db, circle.id, u.id);

    const session = insertSession(db, circle.id, new Date());
    const { matchId } = await store.recordMatch({
      sessionId: session.id,
      reporterId: organiser.id,
      teamA: [organiser.id, b.id],
      teamB: [c.id, d.id],
      sets: [{ a: 6, b: 2 }],
    });

    expect(addComment(db, matchId, b.id, "hi")).toEqual({ ok: false, error: "match_not_verified" });
  });

  it("lists comments oldest-first, same gates as posting", async () => {
    store = createMatchesStore(":memory:");
    db = store.db;
    const { organiser, b, outsider, matchId } = await setUpVerifiedMatch(store, db);

    addComment(db, matchId, organiser.id, "first");
    addComment(db, matchId, b.id, "second");

    const outcome = listComments(db, matchId, organiser.id);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.comments.map((c) => c.body)).toEqual(["first", "second"]);

    expect(listComments(db, matchId, outsider.id)).toEqual({ ok: false, error: "not_a_circle_member" });
  });

  it("notifies the OTHER three participants on the first comment only", async () => {
    store = createMatchesStore(":memory:");
    db = store.db;
    const { organiser, b, c, d, matchId } = await setUpVerifiedMatch(store, db);

    addComment(db, matchId, organiser.id, "first comment");
    const afterFirst = db.select().from(notifications).where(eq(notifications.type, "match_comment")).all();
    const notifiedUserIds = afterFirst.map((n) => n.userId).sort();
    expect(notifiedUserIds).toEqual([b.id, c.id, d.id].sort());

    addComment(db, matchId, b.id, "second comment");
    const afterSecond = db.select().from(notifications).where(eq(notifications.type, "match_comment")).all();
    expect(afterSecond).toHaveLength(3); // no new notifications on the second comment
  });

  it("broadcasts a comment event on the circle channel", async () => {
    const events: { topic: string; type: string }[] = [];
    __setRealtimeSenderForTests(async (topic, type) => {
      events.push({ topic, type });
    });

    store = createMatchesStore(":memory:");
    db = store.db;
    const { organiser, circle, matchId } = await setUpVerifiedMatch(store, db);
    events.length = 0; // drop match-record/confirm broadcasts

    addComment(db, matchId, organiser.id, "hi");
    expect(events).toContainEqual({ topic: circleChannel(circle.id), type: "comment" });
  });

  it("getCommentCounts batches counts across matches, defaulting missing matches to absent (not zero-filled)", async () => {
    store = createMatchesStore(":memory:");
    db = store.db;
    const { organiser, b, matchId } = await setUpVerifiedMatch(store, db);
    addComment(db, matchId, organiser.id, "one");
    addComment(db, matchId, b.id, "two");

    const counts = getCommentCounts(db, [matchId, "no-such-match"]);
    expect(counts.get(matchId)).toBe(2);
    expect(counts.has("no-such-match")).toBe(false);
    expect(getCommentCounts(db, [])).toEqual(new Map());
  });
});
