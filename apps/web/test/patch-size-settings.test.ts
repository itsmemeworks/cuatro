import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestClient, users, type CuatroClient, type CuatroDb } from "@cuatro/db";
import { eq } from "drizzle-orm";

// updateDiscoverySettingsAction now also persists the coarse patch size (THE
// ATLAS). Same harness as discovery-settings.test.ts — db, session, next/cache
// mocked, real FormData -> persist path against an in-memory DB.
const h = vi.hoisted(() => ({ db: null as unknown as CuatroDb, userId: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(async () => ({ id: h.userId, email: "u@e.com", displayName: "U", avatarUrl: null })),
}));
vi.mock("@/server/db", () => ({ getDb: vi.fn(async () => ({ db: h.db })) }));
vi.mock("@/server/geocode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/geocode")>()),
  geocodeAddress: vi.fn(),
}));

import { updateDiscoverySettingsAction } from "@/app/(app)/profile/discovery-actions";

describe("updateDiscoverySettingsAction · patch size", () => {
  let client: CuatroClient;

  beforeEach(async () => {
    client = await createTestClient();
    h.db = client.db;
    const [u] = await client.db.insert(users).values({ email: "u@e.com", displayName: "U" }).returning();
    h.userId = u.id;
  });

  afterEach(async () => {
    await client.close();
  });

  async function storedSize(): Promise<string | null | undefined> {
    const [row] = await client.db.select().from(users).where(eq(users.id, h.userId));
    return row?.patchSize;
  }

  it("defaults to 'local' for a fresh user", async () => {
    expect(await storedSize()).toBe("local");
  });

  it("persists a submitted patch size", async () => {
    const fd = new FormData();
    fd.set("findable", "on");
    fd.set("patchSize", "wide");
    await updateDiscoverySettingsAction(fd);
    expect(await storedSize()).toBe("wide");
  });

  it("ignores an out-of-range patch size rather than writing garbage", async () => {
    const fd = new FormData();
    fd.set("findable", "on");
    fd.set("patchSize", "enormous");
    await updateDiscoverySettingsAction(fd);
    expect(await storedSize()).toBe("local"); // untouched default
  });

  it("leaves the stored size untouched when a form omits patchSize entirely", async () => {
    // A legacy discovery form that predates the size control must never reset
    // the size back to the default.
    const first = new FormData();
    first.set("findable", "on");
    first.set("patchSize", "tight");
    await updateDiscoverySettingsAction(first);
    expect(await storedSize()).toBe("tight");

    const second = new FormData(); // no patchSize key
    second.set("findable", "on");
    await updateDiscoverySettingsAction(second);
    expect(await storedSize()).toBe("tight");
  });
});
