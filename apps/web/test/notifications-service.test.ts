import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestClient, notifications, users, type CuatroClient, type CuatroDb } from "@cuatro/db";
import { insertNotification } from "@/server/notify";
import { getUnreadCount, listNotificationsForUser, markAllNotificationsRead, markNotificationRead } from "@/server/notifications";

let client: CuatroClient;
let db: CuatroDb;

beforeEach(async () => {
  client = await createTestClient();
  db = client.db;
});

afterEach(async () => {
  await client.close();
});

async function seedUser(email = "a@example.com") {
  const [row] = await db.insert(users).values({ email, displayName: "Alex" }).returning();
  return row;
}

/** Backdates a just-written notification's createdAt (insertNotification always stamps "now"). createdAt is epoch-ms now. */
async function backdate(id: string, date: Date) {
  await db.update(notifications).set({ createdAt: date.getTime() }).where(eq(notifications.id, id));
}

describe("listNotificationsForUser", () => {
  it("groups by day, newest first within a day, newest day first", async () => {
    const user = await seedUser();
    const now = new Date("2026-08-10T18:00:00.000Z");
    const today1 = await insertNotification(db, { userId: user.id, type: "game_filled", payload: { sessionId: "s1" } });
    await backdate(today1.id, new Date("2026-08-10T09:00:00.000Z"));
    const today2 = await insertNotification(db, { userId: user.id, type: "slot_promoted", payload: { sessionId: "s2" } });
    await backdate(today2.id, new Date("2026-08-10T12:00:00.000Z"));
    const yesterday = await insertNotification(db, { userId: user.id, type: "dropout", payload: { sessionId: "s3", userId: user.id } });
    await backdate(yesterday.id, new Date("2026-08-09T10:00:00.000Z"));
    const lastWeek = await insertNotification(db, { userId: user.id, type: "result_disputed", payload: { matchId: "m1" } });
    await backdate(lastWeek.id, new Date("2026-08-01T10:00:00.000Z"));

    const groups = await listNotificationsForUser(db, user.id, now);

    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Saturday 1 August"]);
    // Within "Today", newest (12:00) comes before the 09:00 one.
    expect(groups[0]!.notifications.map((n) => n.id)).toEqual([today2.id, today1.id]);
  });

  it("renders title/href identically to notify.ts's own copy for the same payload", async () => {
    const user = await seedUser();
    await insertNotification(db, { userId: user.id, type: "result_verified", payload: { matchId: "m1", delta: 0.05, explanation: "x" } });

    const [group] = await listNotificationsForUser(db, user.id);
    const [row] = group!.notifications;
    expect(row!.title).toBe("Your Glass moved");
    expect(row!.body).toBe("+0.05. Both teams confirmed. Tap to see exactly why.");
    expect(row!.href).toBe("/profile/ledger");
    expect(row!.read).toBe(false);
  });

  it("only returns the requesting user's own notifications", async () => {
    const alex = await seedUser("alex@example.com");
    const priya = await seedUser("priya@example.com");
    await insertNotification(db, { userId: alex.id, type: "game_filled", payload: { sessionId: "s1" } });
    await insertNotification(db, { userId: priya.id, type: "game_filled", payload: { sessionId: "s1" } });

    const groups = await listNotificationsForUser(db, alex.id);
    const allIds = groups.flatMap((g) => g.notifications.map((n) => n.id));
    expect(allIds).toHaveLength(1);
  });
});

describe("read / unread", () => {
  it("getUnreadCount reflects only unread rows for that user", async () => {
    const user = await seedUser();
    await insertNotification(db, { userId: user.id, type: "game_filled", payload: { sessionId: "s1" } });
    await insertNotification(db, { userId: user.id, type: "slot_promoted", payload: { sessionId: "s2" } });
    expect(await getUnreadCount(db, user.id)).toBe(2);
  });

  it("markNotificationRead flips exactly one row and is idempotent", async () => {
    const user = await seedUser();
    const n = await insertNotification(db, { userId: user.id, type: "game_filled", payload: { sessionId: "s1" } });

    expect(await markNotificationRead(db, n.id, user.id)).toBe(true);
    expect(await getUnreadCount(db, user.id)).toBe(0);
    // Second call: already read, nothing changes.
    expect(await markNotificationRead(db, n.id, user.id)).toBe(false);
  });

  it("markNotificationRead refuses to touch another user's notification", async () => {
    const alex = await seedUser("alex@example.com");
    const priya = await seedUser("priya@example.com");
    const n = await insertNotification(db, { userId: alex.id, type: "game_filled", payload: { sessionId: "s1" } });

    expect(await markNotificationRead(db, n.id, priya.id)).toBe(false);
    expect(await getUnreadCount(db, alex.id)).toBe(1);
  });

  it("markAllNotificationsRead clears every unread row for that user only", async () => {
    const alex = await seedUser("alex@example.com");
    const priya = await seedUser("priya@example.com");
    await insertNotification(db, { userId: alex.id, type: "game_filled", payload: { sessionId: "s1" } });
    await insertNotification(db, { userId: alex.id, type: "slot_promoted", payload: { sessionId: "s2" } });
    await insertNotification(db, { userId: priya.id, type: "game_filled", payload: { sessionId: "s1" } });

    const changed = await markAllNotificationsRead(db, alex.id);

    expect(changed).toBe(2);
    expect(await getUnreadCount(db, alex.id)).toBe(0);
    expect(await getUnreadCount(db, priya.id)).toBe(1);
  });
});
