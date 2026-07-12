import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestClient, users, venues, type CuatroClient, type CuatroDb } from "@cuatro/db";
import { eq } from "drizzle-orm";

// The add-a-court action reaches for the shared db, the signed-in user, and
// next/cache — mocked here so the FormData -> geocode -> dedupe -> create path
// runs against an in-memory DB. Only the postcodes.io call is stubbed;
// extractUkPostcode stays real so district + dedupe use genuine extraction.
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

import { addCourtToAtlasAction } from "@/app/(app)/atlas/actions";
import { geocodeAddress } from "@/server/geocode";

const geocodeAddressMock = vi.mocked(geocodeAddress);

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("addCourtToAtlasAction", () => {
  let client: CuatroClient;

  beforeEach(async () => {
    geocodeAddressMock.mockReset();
    client = await createTestClient();
    h.db = client.db;
    const [u] = await client.db.insert(users).values({ email: "u@e.com", displayName: "U" }).returning();
    h.userId = u.id;
  });

  afterEach(async () => {
    await client.close();
  });

  it("creates a genuinely new court with its optional facts and returns the celebration district", async () => {
    geocodeAddressMock.mockResolvedValueOnce({ lat: 51.5449, lng: -0.0554 });

    const result = await addCourtToAtlasAction(
      form({ name: "Hackney Wick Padel", postcode: "E9 5EN", indoorOutdoor: "outdoor", courtCount: "3" }),
    );

    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(result.name).toBe("Hackney Wick Padel");
    expect(result.district).toBe("E9");

    const all = await client.db.select().from(venues);
    expect(all).toHaveLength(1);
    expect(all[0].indoorOutdoor).toBe("outdoor");
    expect(all[0].courtCount).toBe(3);
    expect(all[0].slug).toBeTruthy(); // every new court gets a shareable court-page slug
    expect(all[0].lat).toBeCloseTo(51.5449);
    // A court is a civic contribution, not a home-court pick: the adder's own
    // home court is untouched.
    const [me] = await client.db.select().from(users).where(eq(users.id, h.userId));
    expect(me?.homeVenueId).toBeNull();
  });

  it("a court that can't pin is never created", async () => {
    geocodeAddressMock.mockResolvedValueOnce(null);
    const result = await addCourtToAtlasAction(form({ name: "Nowhere Padel", postcode: "ZZ1 1ZZ" }));
    expect(result).toEqual({ status: "error", code: "postcode_unresolved" });
    expect(await client.db.select().from(venues)).toHaveLength(0);
  });

  it("a missing name errors before any geocode", async () => {
    const result = await addCourtToAtlasAction(form({ name: "  ", postcode: "E9 5EN" }));
    expect(result).toEqual({ status: "error", code: "court_name_missing" });
    expect(geocodeAddressMock).not.toHaveBeenCalled();
  });

  it("surfaces a same-postcode near-match instead of creating a duplicate, with trust facts", async () => {
    const [existing] = await client.db
      .insert(venues)
      .values({
        name: "Victoria Park Padel",
        address: "Grove Rd, London E9 7DE",
        lat: 51.5401,
        lng: -0.0403,
        indoorOutdoor: "outdoor",
        courtCount: 4,
      })
      .returning();
    // Two real members call it home, plus a guest who must NOT be counted.
    await client.db.insert(users).values([
      { email: "a@e.com", displayName: "A", homeVenueId: existing.id },
      { email: "b@e.com", displayName: "B", homeVenueId: existing.id },
      { email: null, displayName: "Guest", isGuest: true, homeVenueId: existing.id },
    ]);
    geocodeAddressMock.mockResolvedValueOnce({ lat: 51.5405, lng: -0.041 });

    const result = await addCourtToAtlasAction(form({ name: "Vicky Park Padel Club", postcode: "E9 7DE" }));

    expect(result.status).toBe("dedupe");
    if (result.status !== "dedupe") return;
    expect(result.existing.id).toBe(existing.id);
    expect(result.existing.name).toBe("Victoria Park Padel");
    expect(result.existing.homeCourtPlayers).toBe(2);
    expect(result.existing.factsLine).toContain("OUTDOOR");
    expect(result.existing.factsLine).toContain("4 COURTS");
    expect(result.existing.factsLine).toContain("E9 7DE");
    expect(result.existing.factsLine).toContain("same postcode area");
    // No duplicate row created while the near-match is pending confirmation.
    expect(await client.db.select().from(venues)).toHaveLength(1);
  });

  it("force pins a genuinely-new court past the dedupe suggestion", async () => {
    await client.db
      .insert(venues)
      .values({ name: "Victoria Park Padel", address: "E9 7DE", lat: 51.54, lng: -0.04 });
    geocodeAddressMock.mockResolvedValue({ lat: 51.5405, lng: -0.041 });

    const result = await addCourtToAtlasAction(
      form({ name: "Victoria Park Padel", postcode: "E9 7DE", force: "1" }),
    );

    expect(result.status).toBe("created");
    expect(await client.db.select().from(venues)).toHaveLength(2);
  });

  it("refuses an unauthenticated caller", async () => {
    const { getSessionUser } = await import("@/lib/session");
    vi.mocked(getSessionUser).mockResolvedValueOnce(null);
    const result = await addCourtToAtlasAction(form({ name: "X", postcode: "E9 5EN" }));
    expect(result).toEqual({ status: "error", code: "unauthorized" });
  });
});
