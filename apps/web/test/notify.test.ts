import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestClient, notifications, users, circles, sessions, type CuatroClient, type CuatroDb } from "@cuatro/db";
import { deepLinkFor, insertNotification, renderNotificationCopy, type NotificationInput } from "@/server/notify";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";
import { userChannel } from "@/lib/realtime/channels";

let client: CuatroClient;
let db: CuatroDb;

beforeEach(async () => {
  client = await createTestClient();
  db = client.db;
});

afterEach(async () => {
  await client.close();
  __setRealtimeSenderForTests(null);
});

async function seedUser(email = "a@example.com", displayName = "Alex") {
  const [row] = await db.insert(users).values({ email, displayName }).returning();
  return row;
}

async function seedSession() {
  const owner = await seedUser("owner@example.com", "Owner");
  const [circle] = await db
    .insert(circles)
    .values({ name: "Tuesday Four", inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy: owner.id })
    .returning();
  const [session] = await db
    .insert(sessions)
    .values({ circleId: circle.id, startsAt: new Date("2026-08-04T19:00:00.000Z").getTime(), status: "upcoming" })
    .returning();
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
  it("never uses an exclamation mark in title or body, for every notification type", async () => {
    for (const input of SAMPLE_INPUTS) {
      const copy = await renderNotificationCopy(db, input);
      expect(copy.title).not.toContain("!");
      expect(copy.body).not.toContain("!");
    }
  });

  it("title says WHAT happened, body says WHY — they're never identical, and title stays short", async () => {
    for (const input of SAMPLE_INPUTS) {
      const copy = await renderNotificationCopy(db, input);
      expect(copy.title).not.toBe(copy.body);
      expect(copy.title.length).toBeLessThan(40);
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });

  it("result_verified matches the handoff's literal example shape: delta, then the confirmation fact, then the CTA", async () => {
    const copy = await renderNotificationCopy(db, { type: "result_verified", payload: { matchId: "m1", delta: 0.05, explanation: "x" } });
    expect(copy.body).toBe("+0.05. Both teams confirmed. Tap to see exactly why.");
  });

  it("negative deltas render with a minus sign, not a doubled one", async () => {
    const copy = await renderNotificationCopy(db, { type: "result_verified", payload: { matchId: "m1", delta: -0.03, explanation: "x" } });
    expect(copy.body.startsWith("-0.03")).toBe(true);
  });

  it("weaves in real session/circle context when available", async () => {
    const { session } = await seedSession();
    const copy = await renderNotificationCopy(db, { type: "fourth_call", payload: { sessionId: session.id, level: 1 } });
    expect(copy.body).toContain("Tuesday Four");
  });

  it("falls back gracefully when the referenced session no longer resolves", async () => {
    const copy = await renderNotificationCopy(db, { type: "fourth_call", payload: { sessionId: "does-not-exist", level: 1 } });
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
  it("writes an identical row to a raw insert, keyed by userId/type/payload", async () => {
    const user = await seedUser();
    const row = await insertNotification(db, { userId: user.id, type: "game_filled", payload: { sessionId: "s1" } });

    const [stored] = await db.select().from(notifications).where(eq(notifications.id, row.id));
    expect(stored.userId).toBe(user.id);
    expect(stored.type).toBe("game_filled");
    expect(stored.payload).toEqual({ sessionId: "s1" });
    expect(stored.readAt).toBeNull();
  });

  it("never throws even though push isn't configured in the test environment", async () => {
    const user = await seedUser();
    await expect(
      insertNotification(db, { userId: user.id, type: "dropout", payload: { sessionId: "s1", userId: user.id } }),
    ).resolves.toBeTruthy();
    // The push send is deferred via setImmediate — flush the macrotask queue
    // so a rejected, uncaught promise inside it would have already surfaced.
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("broadcasts a 'notification' event on the recipient's user channel — the single hook every notification type funnels through", async () => {
    const user = await seedUser();
    const calls: { topic: string; type: string; fields: Record<string, unknown> }[] = [];
    __setRealtimeSenderForTests(async (topic, type, fields) => {
      calls.push({ topic, type, fields });
    });

    const row = await insertNotification(db, { userId: user.id, type: "game_filled", payload: { sessionId: "s1" } });
    // Deferred via setImmediate, same "after commit" timing as the push send.
    await new Promise((resolve) => setImmediate(resolve));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      topic: userChannel(user.id),
      type: "notification",
      fields: { userId: user.id, notificationId: row.id, notificationType: "game_filled" },
    });
  });

  it("broadcasts for every notification type, not just a subset", async () => {
    const user = await seedUser();
    const calls: { type: string }[] = [];
    __setRealtimeSenderForTests(async (_topic, type) => {
      calls.push({ type });
    });

    for (const input of SAMPLE_INPUTS) {
      await insertNotification(db, { userId: user.id, ...input });
    }
    await new Promise((resolve) => setImmediate(resolve));

    expect(calls.filter((c) => c.type === "notification")).toHaveLength(SAMPLE_INPUTS.length);
  });
});
