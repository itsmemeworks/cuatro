import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createClient, notifications, users, circles, sessions, type CuatroClient, type CuatroDb } from "@cuatro/db";
import { deepLinkFor, insertNotification, renderNotificationCopy, type NotificationInput } from "@/server/notify";

let client: CuatroClient;
let db: CuatroDb;

beforeEach(() => {
  client = createClient(":memory:");
  db = client.db;
});

afterEach(() => {
  client.close();
});

function seedUser(email = "a@example.com", displayName = "Alex") {
  return db.insert(users).values({ email, displayName }).returning().get();
}

function seedSession() {
  const owner = seedUser("owner@example.com", "Owner");
  const circle = db
    .insert(circles)
    .values({ name: "Tuesday Four", inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy: owner.id })
    .returning()
    .get();
  const session = db
    .insert(sessions)
    .values({ circleId: circle.id, startsAt: new Date("2026-08-04T19:00:00.000Z"), status: "upcoming" })
    .returning()
    .get();
  return { owner, circle, session };
}

const SAMPLE_INPUTS: NotificationInput[] = [
  { type: "game_filled", payload: { sessionId: "s1" } },
  { type: "slot_promoted", payload: { sessionId: "s1" } },
  { type: "dropout", payload: { sessionId: "s1", userId: "u1" } },
  { type: "fourth_call", payload: { sessionId: "s1", level: 1 } },
  { type: "fourth_call", payload: { sessionId: "s1", level: 2 } },
  { type: "placement_complete", payload: { matchId: "m1", rating: 4.12 } },
  { type: "result_verified", payload: { matchId: "m1", delta: 0.05, explanation: "beat a stronger pair" } },
  { type: "result_disputed", payload: { matchId: "m1" } },
  { type: "confirm_result", payload: { matchId: "m1", sessionId: "s1" } },
  { type: "tab_nudge", payload: { circleId: "c1", tabEntryId: "t1", amountMinor: 800, currency: "GBP" } },
];

describe("renderNotificationCopy — screen 11 copy rules", () => {
  it("never uses an exclamation mark in title or body, for every notification type", () => {
    for (const input of SAMPLE_INPUTS) {
      const copy = renderNotificationCopy(db, input);
      expect(copy.title).not.toContain("!");
      expect(copy.body).not.toContain("!");
    }
  });

  it("title says WHAT happened, body says WHY — they're never identical, and title stays short", () => {
    for (const input of SAMPLE_INPUTS) {
      const copy = renderNotificationCopy(db, input);
      expect(copy.title).not.toBe(copy.body);
      expect(copy.title.length).toBeLessThan(40);
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });

  it("result_verified matches the handoff's literal example shape: delta, then the confirmation fact, then the CTA", () => {
    const copy = renderNotificationCopy(db, { type: "result_verified", payload: { matchId: "m1", delta: 0.05, explanation: "x" } });
    expect(copy.body).toBe("+0.05. Both teams confirmed. Tap to see exactly why.");
  });

  it("negative deltas render with a minus sign, not a doubled one", () => {
    const copy = renderNotificationCopy(db, { type: "result_verified", payload: { matchId: "m1", delta: -0.03, explanation: "x" } });
    expect(copy.body.startsWith("-0.03")).toBe(true);
  });

  it("weaves in real session/circle context when available", () => {
    const { session } = seedSession();
    const copy = renderNotificationCopy(db, { type: "fourth_call", payload: { sessionId: session.id, level: 1 } });
    expect(copy.body).toContain("Tuesday Four");
  });

  it("falls back gracefully when the referenced session no longer resolves", () => {
    const copy = renderNotificationCopy(db, { type: "fourth_call", payload: { sessionId: "does-not-exist", level: 1 } });
    expect(copy.body).not.toContain("undefined");
  });
});

describe("deepLinkFor", () => {
  it("routes game/session events to the session page", () => {
    expect(deepLinkFor({ type: "game_filled", payload: { sessionId: "s1" } })).toBe("/games/s1");
    expect(deepLinkFor({ type: "fourth_call", payload: { sessionId: "s1", level: 2 } })).toBe("/games/s1");
  });

  it("routes Glass events to the ledger", () => {
    expect(deepLinkFor({ type: "result_verified", payload: { matchId: "m1", delta: 0.1, explanation: "x" } })).toBe(
      "/profile/ledger",
    );
    expect(deepLinkFor({ type: "placement_complete", payload: { matchId: "m1", rating: 4 } })).toBe("/profile/ledger");
  });

  it("routes result confirmation/dispute to the match page", () => {
    expect(deepLinkFor({ type: "confirm_result", payload: { matchId: "m1", sessionId: "s1" } })).toBe("/matches/m1");
    expect(deepLinkFor({ type: "result_disputed", payload: { matchId: "m1" } })).toBe("/matches/m1");
  });
});

describe("insertNotification", () => {
  it("writes an identical row to a raw insert, keyed by userId/type/payload", () => {
    const user = seedUser();
    const row = insertNotification(db, { userId: user.id, type: "game_filled", payload: { sessionId: "s1" } });

    const [stored] = db.select().from(notifications).where(eq(notifications.id, row.id)).all();
    expect(stored.userId).toBe(user.id);
    expect(stored.type).toBe("game_filled");
    expect(stored.payload).toEqual({ sessionId: "s1" });
    expect(stored.readAt).toBeNull();
  });

  it("never throws even though push isn't configured in the test environment", async () => {
    const user = seedUser();
    expect(() => insertNotification(db, { userId: user.id, type: "dropout", payload: { sessionId: "s1", userId: user.id } })).not.toThrow();
    // The push send is deferred via setImmediate — flush the macrotask queue
    // so a rejected, uncaught promise inside it would have already surfaced.
    await new Promise((resolve) => setImmediate(resolve));
  });
});
