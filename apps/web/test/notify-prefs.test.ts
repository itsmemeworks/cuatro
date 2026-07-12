import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import { createTestClient, notifications, users, tabEntries, type CuatroClient, type CuatroDb } from "@cuatro/db";
import { insertNotification, type NotificationInput } from "@/server/notify";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";

// Per-type notification preferences (the Settings NOTIFICATIONS card):
// server/notify.ts checks the TARGET user's users.notify_* column before
// creating anything. Opted out = NOTHING (no row, no push, no realtime).
// Push is mocked so "no push" is a real assertion, not an inference.
const pushCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/lib/push", () => ({
  sendPushToUser: vi.fn(async () => {
    pushCalls.count += 1;
  }),
}));

// The settings action's app-level context (same harness as
// discovery-settings.test.ts): shared db, signed-in user, next/cache.
const h = vi.hoisted(() => ({ db: null as unknown as CuatroDb, userId: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(async () => ({ id: h.userId, email: "u@e.com", displayName: "U", avatarUrl: null })),
}));
vi.mock("@/server/db", () => ({ getDb: vi.fn(async () => ({ db: h.db })) }));

import { updateNotificationPrefsAction } from "@/app/(app)/profile/notification-prefs-actions";
import { nudgeEntry, addSplitEntry } from "@/server/tab";
import { seedCircle, type Fixture } from "./support/games-fixtures";

let client: CuatroClient;
let db: CuatroDb;
let broadcasts: number;

beforeEach(async () => {
  client = await createTestClient();
  db = client.db;
  h.db = db;
  pushCalls.count = 0;
  broadcasts = 0;
  __setRealtimeSenderForTests(async () => {
    broadcasts += 1;
  });
});

afterEach(async () => {
  await client.close();
  __setRealtimeSenderForTests(null);
});

async function seedUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const [row] = await db
    .insert(users)
    .values({ email: `u-${Math.random().toString(36).slice(2, 10)}@example.com`, displayName: "Alex", ...overrides })
    .returning();
  return row;
}

/** Flush the setImmediate the push/realtime sends are deferred onto. */
async function flushDeferred() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function rowCountFor(userId: string) {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
  return rows.length;
}

const GATED_CASES: { pref: Partial<typeof users.$inferInsert>; input: NotificationInput }[] = [
  { pref: { notifyFourthCall: false }, input: { type: "fourth_call", payload: { sessionId: "s1", level: 1 } } },
  { pref: { notifyRotation: false }, input: { type: "rotation_selected", payload: { sessionId: "s1" } } },
  { pref: { notifyRotation: false }, input: { type: "rotation_sitting_out", payload: { sessionId: "s1" } } },
  {
    pref: { notifyTabNudge: false },
    input: { type: "tab_nudge", payload: { circleId: "c1", tabEntryId: "t1", amountMinor: 800, currency: "GBP" } },
  },
];

describe("insertNotification — per-type preference gate", () => {
  it("an opted-out type creates NOTHING: no row, no push, no realtime, returns null", async () => {
    for (const { pref, input } of GATED_CASES) {
      const user = await seedUser(pref);
      const result = await insertNotification(db, { userId: user.id, ...input });
      await flushDeferred();

      expect(result).toBeNull();
      expect(await rowCountFor(user.id)).toBe(0);
      expect(pushCalls.count).toBe(0);
      expect(broadcasts).toBe(0);
    }
  });

  it("defaults deliver: a fresh user (all prefs true by default) gets every gated type", async () => {
    for (const { input } of GATED_CASES) {
      const user = await seedUser();
      const result = await insertNotification(db, { userId: user.id, ...input });
      expect(result).not.toBeNull();
      expect(await rowCountFor(user.id)).toBe(1);
    }
    await flushDeferred();
    expect(pushCalls.count).toBe(GATED_CASES.length);
    expect(broadcasts).toBe(GATED_CASES.length);
  });

  it("the gate reads the TARGET user's prefs, not anyone else's", async () => {
    const optedOut = await seedUser({ notifyFourthCall: false });
    const optedIn = await seedUser();
    const input: NotificationInput = { type: "fourth_call", payload: { sessionId: "s1", level: 1 } };
    expect(await insertNotification(db, { userId: optedOut.id, ...input })).toBeNull();
    expect(await insertNotification(db, { userId: optedIn.id, ...input })).not.toBeNull();
  });

  it("every other type is unaffected even with all three prefs off — consequences of your own commitments stay always-on", async () => {
    const user = await seedUser({ notifyFourthCall: false, notifyRotation: false, notifyTabNudge: false });
    const alwaysOn: NotificationInput[] = [
      { type: "game_filled", payload: { sessionId: "s1" } },
      { type: "slot_promoted", payload: { sessionId: "s1" } },
      { type: "confirm_result", payload: { matchId: "m1", sessionId: "s1" } },
      { type: "tab_settled", payload: { entryId: "t1", confirmedBy: user.id } },
      { type: "knock_accepted", payload: { knockId: "k1", kind: "circle", targetId: "c1" } },
    ];
    for (const input of alwaysOn) {
      expect(await insertNotification(db, { userId: user.id, ...input })).not.toBeNull();
    }
    expect(await rowCountFor(user.id)).toBe(alwaysOn.length);
  });
});

describe("updateNotificationPrefsAction", () => {
  it("persists all three toggles together (presence = on)", async () => {
    const user = await seedUser();
    h.userId = user.id;

    const fd = new FormData();
    fd.set("fourthCall", "on");
    // rotation + tabNudge absent = off
    await updateNotificationPrefsAction(fd);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.notifyFourthCall).toBe(true);
    expect(row?.notifyRotation).toBe(false);
    expect(row?.notifyTabNudge).toBe(false);
  });

  it("flipping back on restores delivery", async () => {
    const user = await seedUser({ notifyTabNudge: false });
    h.userId = user.id;

    const fd = new FormData();
    fd.set("fourthCall", "on");
    fd.set("rotation", "on");
    fd.set("tabNudge", "on");
    await updateNotificationPrefsAction(fd);

    const result = await insertNotification(db, {
      userId: user.id,
      type: "tab_nudge",
      payload: { circleId: "c1", tabEntryId: "t1", amountMinor: 800, currency: "GBP" },
    });
    expect(result).not.toBeNull();
  });
});

describe("nudgeEntry × an opted-out debtor — nudge-once still holds", () => {
  let fixture: Fixture | undefined;
  afterEach(async () => {
    await fixture?.close();
    fixture = undefined;
  });

  it("the nudge marker is written and consumed even though no notification lands; opting back in notifies the next entry", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const debtor = fixture.memberIds[0]!;
    await fixture.db.update(users).set({ notifyTabNudge: false }).where(eq(users.id, debtor));

    const created = await addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [debtor],
      totalAmountMinor: 1600,
    });
    if (!created.ok) throw new Error("fixture entry failed");
    const entryId = created.entries[0]!.id;

    // The nudge succeeds for the payer ("Nudged" shows), the marker is set...
    expect(await nudgeEntry(fixture.db, entryId, fixture.organiserId)).toEqual({ ok: true, status: "nudged" });
    const [entry] = await fixture.db.select().from(tabEntries).where(eq(tabEntries.id, entryId));
    expect(entry?.status).toBe("nudged");
    expect(entry?.nudgedAt).not.toBeNull();

    // ...but the opted-out debtor got NOTHING, and the entry is not
    // re-nudgeable: the one nudge is spent, quiet or not.
    const debtorRows = await fixture.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, debtor), eq(notifications.type, "tab_nudge")));
    expect(debtorRows).toHaveLength(0);
    expect(await nudgeEntry(fixture.db, entryId, fixture.organiserId)).toEqual({ ok: false, error: "already_nudged" });

    // Flip the pref back on: the next nudge-able entry notifies normally.
    await fixture.db.update(users).set({ notifyTabNudge: true }).where(eq(users.id, debtor));
    const second = await addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [debtor],
      totalAmountMinor: 800,
    });
    if (!second.ok) throw new Error("fixture entry failed");
    expect(await nudgeEntry(fixture.db, second.entries[0]!.id, fixture.organiserId)).toEqual({ ok: true, status: "nudged" });
    const afterOptIn = await fixture.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, debtor), eq(notifications.type, "tab_nudge")));
    expect(afterOptIn).toHaveLength(1);
  });
});
