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
// Stub ONLY the network call (postcodes.io); extractUkPostcode and friends
// stay real so the dedupe path exercises genuine postcode extraction.
vi.mock("@/server/geocode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/geocode")>()),
  geocodeAddress: vi.fn(),
}));

import { updateDiscoverySettingsAction } from "@/app/(app)/profile/discovery-actions";
import { geocodeAddress } from "@/server/geocode";

const geocodeAddressMock = vi.mocked(geocodeAddress);

describe("updateDiscoverySettingsAction", () => {
  let client: CuatroClient;

  beforeEach(async () => {
    geocodeAddressMock.mockReset();
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
    expect(patch).toEqual({ lat: 51.5265, lng: -0.0805, source: "home_venue", size: "local", radiusKm: 2.5 });
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

  // ---- Add a new court (choose-OR-ADD, GEO clarity wave) ----

  function addCourtForm(name: string, address: string): FormData {
    const fd = new FormData();
    fd.set("findable", "on");
    fd.set("newCourtName", name);
    fd.set("newCourtAddress", address);
    return fd;
  }

  it("dedupe-matches a free-form entry onto an existing pinned venue (same postcode) — no new row, no geocode call", async () => {
    const [existing] = await client.db
      .insert(venues)
      .values({ name: "Powerleague Shoreditch", address: "Braithwaite St, London E1 6GJ", lat: 51.523, lng: -0.073 })
      .returning();

    const result = await updateDiscoverySettingsAction(
      addCourtForm("Shoreditch Padel Centre", "Braithwaite Street E1 6GJ"),
    );

    expect(result).toEqual({ ok: true, homeVenueId: existing.id });
    expect(geocodeAddressMock).not.toHaveBeenCalled();
    expect(await client.db.select().from(venues)).toHaveLength(1);
    const [row] = await client.db.select().from(users).where(eq(users.id, h.userId));
    expect(row?.homeVenueId).toBe(existing.id);
  });

  it("dedupe-matches by normalised name and pins the matched venue when it was unpinned", async () => {
    const [existing] = await client.db.insert(venues).values({ name: "Rocket Padel Battersea" }).returning();
    geocodeAddressMock.mockResolvedValueOnce({ lat: 51.4745, lng: -0.1499 });

    const result = await updateDiscoverySettingsAction(
      addCourtForm("rocket padel battersea club", "SW11 8DD"),
    );

    expect(result).toEqual({ ok: true, homeVenueId: existing.id });
    const [venueRow] = await client.db.select().from(venues).where(eq(venues.id, existing.id));
    expect(venueRow?.lat).toBeCloseTo(51.4745);
    expect(venueRow?.lng).toBeCloseTo(-0.1499);
    // The address we didn't have gets backfilled by the match.
    expect(venueRow?.address).toBe("SW11 8DD");
    const [row] = await client.db.select().from(users).where(eq(users.id, h.userId));
    expect(row?.homeVenueId).toBe(existing.id);
  });

  it("creates a genuinely new court, geocodes it, and it becomes the home court and the patch", async () => {
    geocodeAddressMock.mockResolvedValueOnce({ lat: 51.5033, lng: -0.1195 });

    const result = await updateDiscoverySettingsAction(
      addCourtForm("Jubilee Padel Club", "Belvedere Rd, London SE1 7PB"),
    );

    expect(result.ok).toBe(true);
    const all = await client.db.select().from(venues);
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Jubilee Padel Club");
    expect(all[0].lat).toBeCloseTo(51.5033);
    expect(all[0].lng).toBeCloseTo(-0.1195);

    const [row] = await client.db.select().from(users).where(eq(users.id, h.userId));
    expect(row?.homeVenueId).toBe(all[0].id);
    const patch = await resolvePatch(client.db, h.userId);
    expect(patch).toEqual({ lat: 51.5033, lng: -0.1195, source: "home_venue", size: "local", radiusKm: 2.5 });
  });

  it("a postcode that doesn't resolve saves NOTHING — no venue row, home court untouched", async () => {
    const [kept] = await client.db.insert(venues).values({ name: "Kept Court", lat: 51.5, lng: -0.1 }).returning();
    await client.db.update(users).set({ homeVenueId: kept.id }).where(eq(users.id, h.userId));
    geocodeAddressMock.mockResolvedValueOnce(null);

    const result = await updateDiscoverySettingsAction(addCourtForm("Nowhere Padel", "ZZ1 1ZZ"));

    expect(result).toEqual({ ok: false, error: "postcode_unresolved" });
    expect(await client.db.select().from(venues)).toHaveLength(1); // no new row
    const [row] = await client.db.select().from(users).where(eq(users.id, h.userId));
    expect(row?.homeVenueId).toBe(kept.id); // untouched
  });

  it("an add form without a court name errors instead of reading as 'clear my home court'", async () => {
    const [kept] = await client.db.insert(venues).values({ name: "Kept Court", lat: 51.5, lng: -0.1 }).returning();
    await client.db.update(users).set({ homeVenueId: kept.id }).where(eq(users.id, h.userId));

    const result = await updateDiscoverySettingsAction(addCourtForm("", "E1 6GJ"));

    expect(result).toEqual({ ok: false, error: "court_name_missing" });
    const [row] = await client.db.select().from(users).where(eq(users.id, h.userId));
    expect(row?.homeVenueId).toBe(kept.id);
  });

  it("the add-new select sentinel never persists as a home venue", async () => {
    const fd = new FormData();
    fd.set("findable", "on");
    fd.set("homeVenueId", "__add_new__");
    const result = await updateDiscoverySettingsAction(fd);
    expect(result).toEqual({ ok: true, homeVenueId: null });
    const [row] = await client.db.select().from(users).where(eq(users.id, h.userId));
    expect(row?.homeVenueId).toBeNull();
  });
});
