import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestClient, users, venues, type CuatroClient, type CuatroDb } from "@cuatro/db";
import { eq } from "drizzle-orm";
import { resolvePatch } from "@/server/patch";

// The settings action reaches for the shared db, the signed-in user, and
// next/cache — all mocked here so we exercise the real FormData→persist→patch
// path against an in-memory DB.
const h = vi.hoisted(() => ({ db: null as unknown as CuatroDb, userId: "" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(async () => ({ id: h.userId, email: "u@e.com", displayName: "U", avatarUrl: null })),
}));
vi.mock("@/server/db", () => ({ getDb: vi.fn(async () => ({ db: h.db })) }));

import { updateDiscoverySettingsAction } from "@/app/(app)/profile/discovery-actions";

describe("updateDiscoverySettingsAction", () => {
  let client: CuatroClient;

  beforeEach(async () => {
    client = await createTestClient();
    h.db = client.db;
    const [u] = await client.db.insert(users).values({ email: "u@e.com", displayName: "U", findable: true }).returning();
    h.userId = u.id;
  });

  afterEach(async () => {
    await client.close();
  });

  it("persists a home venue and findable, and the patch then resolves there", async () => {
    const [venue] = await client.db
      .insert(venues)
      .values({ name: "Shoreditch", lat: 51.5265, lng: -0.0805 })
      .returning();

    const fd = new FormData();
    fd.set("findable", "on");
    fd.set("homeVenueId", venue.id);
    await updateDiscoverySettingsAction(fd);

    const [row] = await client.db.select().from(users).where(eq(users.id, h.userId));
    expect(row?.findable).toBe(true);
    expect(row?.homeVenueId).toBe(venue.id);

    const patch = await resolvePatch(client.db, h.userId);
    expect(patch).toEqual({ lat: 51.5265, lng: -0.0805, source: "home_venue" });
  });

  it("an unchecked findable box turns discovery off", async () => {
    const fd = new FormData(); // no "findable" key => unchecked
    await updateDiscoverySettingsAction(fd);
    const [row] = await client.db.select().from(users).where(eq(users.id, h.userId));
    expect(row?.findable).toBe(false);
  });

  it("drops a stale home-venue id rather than breaking the FK", async () => {
    const fd = new FormData();
    fd.set("findable", "on");
    fd.set("homeVenueId", "does-not-exist");
    await updateDiscoverySettingsAction(fd);
    const [row] = await client.db.select().from(users).where(eq(users.id, h.userId));
    expect(row?.homeVenueId).toBeNull();
  });
});
