import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestClient, pushSubscriptions, users, type CuatroClient, type CuatroDb } from "@cuatro/db";

// lib/push reaches Postgres through the app-wide singleton in @/server/db.
// Point it at the per-test PGlite client, same seam the scheduler test uses.
let currentDb: CuatroDb | null = null;
vi.mock("@/server/db", () => ({
  getDb: async () => ({ db: currentDb, close: async () => {} }),
  __resetDbForTests: () => {},
}));

// VAPID must look configured so ensureConfigured() doesn't short-circuit the
// send path. Set before importing the module under test (module reads env at
// load time). web-push validates the key FORMAT in setVapidDetails, so use a
// real generated pair; delivery itself is stubbed via
// __setPushTransportForTests, so nothing is actually signed or sent.
const { default: webpush } = await import("web-push");
const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;

const {
  saveSubscription,
  removeSubscription,
  sendPushToUser,
  __setPushTransportForTests,
} = await import("@/lib/push");

let client: CuatroClient;
let db: CuatroDb;

beforeEach(async () => {
  client = await createTestClient();
  db = client.db;
  currentDb = db;
});

afterEach(async () => {
  __setPushTransportForTests(null);
  currentDb = null;
  await client.close();
});

async function seedUser(email = "a@example.com", displayName = "Alex") {
  const [row] = await db.insert(users).values({ email, displayName }).returning();
  return row;
}

function sub(endpoint: string): { endpoint: string; keys: { p256dh: string; auth: string } } {
  return { endpoint, keys: { p256dh: `p-${endpoint}`, auth: `a-${endpoint}` } };
}

describe("saveSubscription", () => {
  it("stores a subscription row for the user", async () => {
    const user = await seedUser();
    await saveSubscription(user.id, sub("https://push.example/1"));

    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].endpoint).toBe("https://push.example/1");
    expect(rows[0].keysP256dh).toBe("p-https://push.example/1");
    expect(rows[0].lastUsedAt).toBeTypeOf("number");
  });

  it("upserts on endpoint: re-subscribing the same endpoint refreshes keys instead of duplicating", async () => {
    const user = await seedUser();
    await saveSubscription(user.id, sub("https://push.example/1"));
    await saveSubscription(user.id, {
      endpoint: "https://push.example/1",
      keys: { p256dh: "rotated-p", auth: "rotated-a" },
    });

    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, "https://push.example/1"));
    expect(rows).toHaveLength(1);
    expect(rows[0].keysP256dh).toBe("rotated-p");
  });

  it("keeps multiple devices for one user (keyed on endpoint, not user)", async () => {
    const user = await seedUser();
    await saveSubscription(user.id, sub("https://push.example/phone"));
    await saveSubscription(user.id, sub("https://push.example/laptop"));

    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id));
    expect(rows).toHaveLength(2);
  });

  it("re-homes an endpoint to whichever user last subscribed it (shared device)", async () => {
    const alex = await seedUser("alex@example.com", "Alex");
    const sam = await seedUser("sam@example.com", "Sam");
    await saveSubscription(alex.id, sub("https://push.example/shared"));
    await saveSubscription(sam.id, sub("https://push.example/shared"));

    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, "https://push.example/shared"));
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(sam.id);
  });
});

describe("removeSubscription", () => {
  it("removes only the given endpoint, leaving the user's other devices", async () => {
    const user = await seedUser();
    await saveSubscription(user.id, sub("https://push.example/phone"));
    await saveSubscription(user.id, sub("https://push.example/laptop"));

    await removeSubscription("https://push.example/phone");

    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id));
    expect(rows.map((r) => r.endpoint)).toEqual(["https://push.example/laptop"]);
  });
});

describe("sendPushToUser", () => {
  it("fans out to every one of the user's subscriptions", async () => {
    const user = await seedUser();
    await saveSubscription(user.id, sub("https://push.example/phone"));
    await saveSubscription(user.id, sub("https://push.example/laptop"));

    const hit: string[] = [];
    __setPushTransportForTests(async (subscription) => {
      hit.push(subscription.endpoint);
    });

    const res = await sendPushToUser(user.id, { title: "Your four is set", body: "All slots filled." });
    expect(res.sent).toBe(true);
    expect(hit.sort()).toEqual(["https://push.example/laptop", "https://push.example/phone"]);
  });

  it("delivers the JSON payload the service worker expects", async () => {
    const user = await seedUser();
    await saveSubscription(user.id, sub("https://push.example/1"));

    let delivered = "";
    __setPushTransportForTests(async (_s, payload) => {
      delivered = payload;
    });

    await sendPushToUser(user.id, { title: "T", body: "B", url: "/games/x" });
    expect(JSON.parse(delivered)).toEqual({ title: "T", body: "B", url: "/games/x" });
  });

  it("prunes a subscription the push service reports as expired (410) and keeps live ones", async () => {
    const user = await seedUser();
    await saveSubscription(user.id, sub("https://push.example/dead"));
    await saveSubscription(user.id, sub("https://push.example/live"));

    __setPushTransportForTests(async (subscription) => {
      if (subscription.endpoint === "https://push.example/dead") {
        throw Object.assign(new Error("gone"), { statusCode: 410 });
      }
    });

    const res = await sendPushToUser(user.id, { title: "T" });
    expect(res.sent).toBe(true); // the live one delivered

    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id));
    expect(rows.map((r) => r.endpoint)).toEqual(["https://push.example/live"]);
  });

  it("leaves a subscription in place on a transient (non-404/410) failure", async () => {
    const user = await seedUser();
    await saveSubscription(user.id, sub("https://push.example/1"));

    __setPushTransportForTests(async () => {
      throw Object.assign(new Error("server error"), { statusCode: 500 });
    });

    const res = await sendPushToUser(user.id, { title: "T" });
    expect(res.sent).toBe(false);

    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id));
    expect(rows).toHaveLength(1);
  });

  it("no-ops with a reason when the user has no subscriptions", async () => {
    const user = await seedUser();
    const res = await sendPushToUser(user.id, { title: "T" });
    expect(res).toEqual({ sent: false, reason: "no subscription for user" });
  });
});
