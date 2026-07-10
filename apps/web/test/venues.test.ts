import { afterEach, describe, expect, it } from "vitest";
import { circles, sessions, standingGames, venues } from "@cuatro/db";
import { eq } from "drizzle-orm";
import { seedCircle, type Fixture } from "./support/games-fixtures";
import {
  listVenuesForCircle,
  matchVenue,
  normaliseVenueName,
  resolveSubmittedVenue,
  venueAreaHint,
} from "@/server/venues";
import { createStandingGame, updateStandingGame } from "@/server/standing-games-service";

let fixture: Fixture | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

describe("normaliseVenueName", () => {
  it("folds case, punctuation and whitespace", () => {
    expect(normaliseVenueName("Powerleague Shoreditch")).toBe("powerleague shoreditch");
    expect(normaliseVenueName("powerleague  shoreditch!")).toBe("powerleague shoreditch");
    expect(normaliseVenueName("  Powerleague — Shoreditch  ")).toBe("powerleague shoreditch");
    expect(normaliseVenueName("St. Paul's")).toBe("st paul s");
  });

  it("tolerates a trailing generic suffix", () => {
    expect(normaliseVenueName("Powerleague Shoreditch Padel Club")).toBe("powerleague shoreditch");
    expect(normaliseVenueName("Rocket Padel")).toBe("rocket");
    expect(normaliseVenueName("Padel Social Club")).toBe("padel social");
  });

  it("never strips down to nothing and handles empties", () => {
    expect(normaliseVenueName(null)).toBe("");
    expect(normaliseVenueName("")).toBe("");
    expect(normaliseVenueName("Club")).toBe("club");
    expect(normaliseVenueName("!!!")).toBe("");
  });
});

describe("venueAreaHint", () => {
  it("prefers the postcode outward code", () => {
    expect(venueAreaHint("Bethnal Green Rd, London EC2A 3AR")).toBe("EC2A");
    expect(venueAreaHint("Buckhold Rd, London SW18 1UJ")).toBe("SW18");
  });

  it("falls back to the last address chunk, else null", () => {
    expect(venueAreaHint("Queen Elizabeth Olympic Park, Stratford")).toBe("Stratford");
    expect(venueAreaHint("Somewhere")).toBe("Somewhere");
    expect(venueAreaHint(null)).toBeNull();
    expect(venueAreaHint("")).toBeNull();
  });
});

describe("matchVenue", () => {
  it("matches a name variant (case/whitespace/suffix insensitive)", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const [created] = await fixture.db
      .insert(venues)
      .values({ name: "Powerleague Shoreditch", address: "Bethnal Green Rd, EC2A 3AR" })
      .returning();

    expect((await matchVenue(fixture.db, { name: "powerleague shoreditch" }))?.id).toBe(created.id);
    expect((await matchVenue(fixture.db, { name: "Powerleague Shoreditch Padel Club" }))?.id).toBe(created.id);
    expect((await matchVenue(fixture.db, { name: "  POWERLEAGUE   shoreditch " }))?.id).toBe(created.id);
  });

  it("matches on an identical extracted postcode even when the name differs", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const [created] = await fixture.db
      .insert(venues)
      .values({ name: "Powerleague Shoreditch", address: "Bethnal Green Rd, London EC2A 3AR" })
      .returning();

    const match = await matchVenue(fixture.db, { name: "Some Other Name", address: "Unit 4, ec2a 3ar" });
    expect(match?.id).toBe(created.id);
  });

  it("returns null for a genuinely new court", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    await fixture.db.insert(venues).values({ name: "Powerleague Shoreditch", address: "EC2A 3AR" });
    expect(await matchVenue(fixture.db, { name: "Padel Palace", address: "N1 7GU" })).toBeNull();
    expect(await matchVenue(fixture.db, { name: null, address: null })).toBeNull();
  });
});

describe("resolveSubmittedVenue", () => {
  it("picks a chosen venueId directly", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const r = await resolveSubmittedVenue(fixture.db, { venueId: fixture.venueId });
    expect(r).toEqual({ outcome: "picked", venueId: fixture.venueId });
  });

  it("matches a near-duplicate free-form name onto the existing row", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const [existing] = await fixture.db.insert(venues).values({ name: "Powerleague Shoreditch" }).returning();

    const r = await resolveSubmittedVenue(fixture.db, { name: "powerleague shoreditch" });
    expect(r.outcome).toBe("matched");
    expect(r.venueId).toBe(existing.id);
    expect(r.matchedName).toBe("Powerleague Shoreditch");
    expect(r.venueAddress).toBeUndefined();
  });

  it("backfills an address onto a matched venue that lacks one, but never overwrites", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const [noAddress] = await fixture.db.insert(venues).values({ name: "Padel Palace" }).returning();
    const backfill = await resolveSubmittedVenue(fixture.db, { name: "padel palace", address: "1 Court Lane, N1 7GU" });
    expect(backfill.outcome).toBe("matched");
    expect(backfill.venueAddress).toBe("1 Court Lane, N1 7GU");

    await fixture.db.update(venues).set({ address: "Real Address, N1 7GU" }).where(eq(venues.id, noAddress.id));
    const noOverwrite = await resolveSubmittedVenue(fixture.db, { name: "padel palace", address: "Wrong Address, N1 7GU" });
    expect(noOverwrite.outcome).toBe("matched");
    expect(noOverwrite.venueAddress).toBeUndefined();
  });

  it("creates a genuinely new court", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const r = await resolveSubmittedVenue(fixture.db, { name: "Brand New Courts", address: "5 Fresh St, E1 6GJ" });
    expect(r).toEqual({ outcome: "created", venueName: "Brand New Courts", venueAddress: "5 Fresh St, E1 6GJ" });
  });

  it("resolves to none when nothing usable is submitted", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    expect(await resolveSubmittedVenue(fixture.db, { venueId: "", name: "  ", address: "" })).toEqual({ outcome: "none" });
  });
});

describe("resolveSubmittedVenue + createStandingGame (the action's wiring)", () => {
  it("reuses the picked venue row, creating no duplicate", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const venue = await resolveSubmittedVenue(fixture.db, { venueId: fixture.venueId });
    const result = await createStandingGame(fixture.db, fixture.organiserId, {
      circleId: fixture.circleId,
      weekday: 2,
      startTime: "20:00",
      venueId: venue.venueId,
      venueName: venue.venueName,
      venueAddress: venue.venueAddress,
    });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.venueId).toBe(fixture.venueId);
    expect(await fixture.db.select().from(venues)).toHaveLength(1);
  });

  it("dedupe-matches a near-duplicate free-form entry instead of creating a second row", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const [seeded] = await fixture.db.insert(venues).values({ name: "Powerleague Shoreditch" }).returning();
    const before = (await fixture.db.select().from(venues)).length;

    const venue = await resolveSubmittedVenue(fixture.db, { name: "powerleague shoreditch" });
    const result = await createStandingGame(fixture.db, fixture.organiserId, {
      circleId: fixture.circleId,
      weekday: 3,
      startTime: "19:00",
      venueId: venue.venueId,
      venueName: venue.venueName,
      venueAddress: venue.venueAddress,
    });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.venueId).toBe(seeded.id);
    expect(await fixture.db.select().from(venues)).toHaveLength(before);
  });

  it("creates a fresh geocodable venue row for a genuinely new court", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const before = (await fixture.db.select().from(venues)).length;

    const venue = await resolveSubmittedVenue(fixture.db, { name: "Padel Palace", address: "1 Court Lane, N1 7GU" });
    const result = await createStandingGame(fixture.db, fixture.organiserId, {
      circleId: fixture.circleId,
      weekday: 4,
      startTime: "18:00",
      venueId: venue.venueId,
      venueName: venue.venueName,
      venueAddress: venue.venueAddress,
    });
    if (!result.ok) throw new Error("unreachable");
    expect(await fixture.db.select().from(venues)).toHaveLength(before + 1);
    const [row] = await fixture.db.select().from(venues).where(eq(venues.id, result.value.venueId!));
    expect(row?.name).toBe("Padel Palace");
    expect(row?.address).toBe("1 Court Lane, N1 7GU");
  });

  it("does not clear a picked venue's address (venueAddress stays undefined, not null)", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    await fixture.db.update(venues).set({ address: "Keep Me, E1 6GJ" }).where(eq(venues.id, fixture.venueId));

    const venue = await resolveSubmittedVenue(fixture.db, { venueId: fixture.venueId });
    await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, {
      venueId: venue.venueId,
      venueName: venue.venueName,
      venueAddress: venue.venueAddress,
    });
    const [row] = await fixture.db.select().from(venues).where(eq(venues.id, fixture.venueId));
    expect(row?.address).toBe("Keep Me, E1 6GJ");
  });
});

describe("listVenuesForCircle", () => {
  it("orders home court first, then played-at, then the rest alphabetically, with area hints", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const db = fixture.db;

    // seedCircle's "Test Venue" is the played-at one (we attach a standing game).
    const [home] = await db.insert(venues).values({ name: "Home Club", address: "1 Home Rd, SW1A 1AA" }).returning();
    const [zed] = await db.insert(venues).values({ name: "Zed Courts", address: "9 Zed St, N1 7GU" }).returning();
    const [alpha] = await db.insert(venues).values({ name: "Alpha Courts", address: "2 Alpha Rd" }).returning();

    await db.update(circles).set({ homeVenueId: home.id }).where(eq(circles.id, fixture.circleId));
    await db.insert(standingGames)
      .values({ circleId: fixture.circleId, venueId: fixture.venueId, weekday: 2, startTime: "20:00" });
    await db.insert(sessions)
      .values({ circleId: fixture.circleId, venueId: fixture.venueId, startsAt: Date.now(), status: "upcoming" });

    const options = await listVenuesForCircle(db, fixture.circleId);
    expect(options.map((o) => o.id)).toEqual([home.id, fixture.venueId, alpha.id, zed.id]);
    expect(options[0]).toEqual({ id: home.id, name: "Home Club", areaHint: "SW1A" });
    expect(options.find((o) => o.id === alpha.id)?.areaHint).toBe("2 Alpha Rd");
  });

  it("returns an empty list when there are no venues", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    await fixture.db.delete(venues);
    expect(await listVenuesForCircle(fixture.db, fixture.circleId)).toEqual([]);
  });
});
