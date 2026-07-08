import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createClient, notifications, users, type CuatroClient, type CuatroDb } from "@cuatro/db";
import { insertNotification } from "@/server/notify";
import { getUnreadCount, listNotificationsForUser, markAllNotificationsRead, markNotificationRead } from "@/server/notifications";

let client: CuatroClient;
let db: CuatroDb;

beforeEach(() => {
  client = createClient(":memory:");
  db = client.db;
});

afterEach(() => {
  client.close();
});

function seedUser(email = "a@example.com") {
  return db.insert(users).values({ email, displayName: "Alex" }).returning().get();
}

/** Backdates a just-written notification's createdAt (insertNotification always stamps "now"). */
function backdate(id: string, date: Date) {
  db.update(notifications).set({ createdAt: date }).where(eq(notifications.id, id)).run();
}

describe("listNotificationsForUser", () => {
  it("groups by day, newest first within a day, newest day first", () => {
    const user = seedUser();
    const now = new Date("2026-08-10T18:00:00.000Z");
    const today1 = insertNotification(db, { userId: user.id, type: "game_filled", payload: { sessionId: "s1" } });
    backdate(today1.id, new Date("2026-08-10T09:00:00.000Z"));
    const today2 = insertNotification(db, { userId: user.id, type: "slot_promoted", payload: { sessionId: "s2" } });
    backdate(today2.id, new Date("2026-08-10T12:00:00.000Z"));
    const yesterday = insertNotification(db, { userId: user.id, type: "dropout", payload: { sessionId: "s3", userId: user.id } });
    backdate(yesterday.id, new Date("2026-08-09T10:00:00.000Z"));
    const lastWeek = insertNotification(db, { userId: user.id, type: "result_disputed", payload: { matchId: "m1" } });
    backdate(lastWeek.id, new Date("2026-08-01T10:00:00.000Z"));

    const groups = listNotificationsForUser(db, user.id, now);

    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Saturday 1 August"]);
    // Within "Today", newest (12:00) comes before the 09:00 one.
    expect(groups[0]!.notifications.map((n) => n.id)).toEqual([today2.id, today1.id]);
  });

  it("renders title/href identically to notify.ts's own copy for the same payload", () => {
    const user = seedUser();
    insertNotification(db, { userId: user.id, type: "result_verified", payload: { matchId: "m1", delta: 0.05, explanation: "x" } });

    const [group] = listNotificationsForUser(db, user.id);
    const [row] = group!.notifications;
    expect(row!.title).toBe("Your Glass moved");
    expect(row!.body).toBe("+0.05. Both teams confirmed. Tap to see exactly why.");
    expect(row!.href).toBe("/profile/ledger");
    expect(row!.read).toBe(false);
  });

  it("only returns the requesting user's own notifications", () => {
    const alex = seedUser("alex@example.com");
    const priya = seedUser("priya@example.com");
    insertNotification(db, { userId: alex.id, type: "game_filled", payload: { sessionId: "s1" } });
    insertNotification(db, { userId: priya.id, type: "game_filled", payload: { sessionId: "s1" } });

    const groups = listNotificationsForUser(db, alex.id);
    const allIds = groups.flatMap((g) => g.notifications.map((n) => n.id));
    expect(allIds).toHaveLength(1);
  });
});

describe("read / unread", () => {
  it("getUnreadCount reflects only unread rows for that user", () => {
    const user = seedUser();
    insertNotification(db, { userId: user.id, type: "game_filled", payload: { sessionId: "s1" } });
    insertNotification(db, { userId: user.id, type: "slot_promoted", payload: { sessionId: "s2" } });
    expect(getUnreadCount(db, user.id)).toBe(2);
  });

  it("markNotificationRead flips exactly one row and is idempotent", () => {
    const user = seedUser();
    const n = insertNotification(db, { userId: user.id, type: "game_filled", payload: { sessionId: "s1" } });

    expect(markNotificationRead(db, n.id, user.id)).toBe(true);
    expect(getUnreadCount(db, user.id)).toBe(0);
    // Second call: already read, nothing changes.
    expect(markNotificationRead(db, n.id, user.id)).toBe(false);
  });

  it("markNotificationRead refuses to touch another user's notification", () => {
    const alex = seedUser("alex@example.com");
    const priya = seedUser("priya@example.com");
    const n = insertNotification(db, { userId: alex.id, type: "game_filled", payload: { sessionId: "s1" } });

    expect(markNotificationRead(db, n.id, priya.id)).toBe(false);
    expect(getUnreadCount(db, alex.id)).toBe(1);
  });

  it("markAllNotificationsRead clears every unread row for that user only", () => {
    const alex = seedUser("alex@example.com");
    const priya = seedUser("priya@example.com");
    insertNotification(db, { userId: alex.id, type: "game_filled", payload: { sessionId: "s1" } });
    insertNotification(db, { userId: alex.id, type: "slot_promoted", payload: { sessionId: "s2" } });
    insertNotification(db, { userId: priya.id, type: "game_filled", payload: { sessionId: "s1" } });

    const changed = markAllNotificationsRead(db, alex.id);

    expect(changed).toBe(2);
    expect(getUnreadCount(db, alex.id)).toBe(0);
    expect(getUnreadCount(db, priya.id)).toBe(1);
  });
});
