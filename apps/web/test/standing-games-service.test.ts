import { afterEach, describe, expect, it } from "vitest";
import { venues } from "@cuatro/db";
import { eq } from "drizzle-orm";
import { seedCircle, type Fixture } from "./support/games-fixtures";
import {
  createStandingGame,
  getStandingGame,
  isOrganiser,
  listCirclesForUser,
  listStandingGamesForCircle,
  updateStandingGame,
} from "@/server/standing-games-service";

let fixture: Fixture | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

describe("createStandingGame", () => {
  it("rejects a non-organiser member", async () => {
    fixture = await seedCircle({ memberCount: 2 });
    const result = await createStandingGame(fixture.db, fixture.memberIds[0], {
      circleId: fixture.circleId,
      weekday: 2,
      startTime: "20:00",
    });
    expect(result).toEqual({ ok: false, error: "not_an_organiser" });
  });

  it("rejects an invalid weekday or malformed start time", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    expect(
      await createStandingGame(fixture.db, fixture.organiserId, { circleId: fixture.circleId, weekday: 9, startTime: "20:00" }),
    ).toEqual({ ok: false, error: "invalid_weekday" });
    expect(
      await createStandingGame(fixture.db, fixture.organiserId, { circleId: fixture.circleId, weekday: 2, startTime: "8pm" }),
    ).toEqual({ ok: false, error: "invalid_start_time" });
  });

  it("creates a standing game with sensible defaults", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const result = await createStandingGame(fixture.db, fixture.organiserId, {
      circleId: fixture.circleId,
      weekday: 2,
      startTime: "20:00",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toMatchObject({
      slots: 4,
      rsvpWindowDays: 6,
      durationMinutes: 90,
      active: true,
    });
  });

  it("creates a new venue for an unrecognised free-text name, and reuses it by exact name next time", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const first = await createStandingGame(fixture.db, fixture.organiserId, {
      circleId: fixture.circleId,
      weekday: 2,
      startTime: "20:00",
      venueName: "Padel Palace",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");
    expect(first.value.venueId).not.toBeNull();

    const second = await createStandingGame(fixture.db, fixture.organiserId, {
      circleId: fixture.circleId,
      weekday: 4,
      startTime: "19:00",
      venueName: "Padel Palace",
    });
    if (!second.ok) throw new Error("unreachable");
    expect(second.value.venueId).toBe(first.value.venueId);

    const allVenues = await fixture.db.select().from(venues).where(eq(venues.name, "Padel Palace"));
    expect(allVenues).toHaveLength(1);
  });

  it("stores the venue's address and the standing game's cost when both are given (design/DESIGN-AUDIT.md F4/F5)", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const result = await createStandingGame(fixture.db, fixture.organiserId, {
      circleId: fixture.circleId,
      weekday: 2,
      startTime: "20:00",
      venueName: "Padel Palace",
      venueAddress: "1 Court Lane, London",
      costMinor: 3200,
      costCurrency: "GBP",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.costMinor).toBe(3200);
    expect(result.value.costCurrency).toBe("GBP");

    const [venue] = await fixture.db.select().from(venues).where(eq(venues.id, result.value.venueId!));
    expect(venue?.address).toBe("1 Court Lane, London");
  });
});

describe("updateStandingGame", () => {
  it("rejects updates from a non-organiser", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    const result = await updateStandingGame(fixture.db, fixture.memberIds[0], fixture.standingGameId!, { slots: 6 });
    expect(result).toEqual({ ok: false, error: "not_an_organiser" });
  });

  it("toggles active without touching other fields", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00", slots: 4 } });
    const result = await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { active: false });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.active).toBe(false);
    expect(result.value.slots).toBe(4);
  });

  it("returns not_found for an unknown id", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const result = await updateStandingGame(fixture.db, fixture.organiserId, "does-not-exist", { active: false });
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("sets the cost (design/DESIGN-AUDIT.md F4), defaulting currency to GBP and leaving it unset when omitted", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });

    const withoutCost = await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { active: true });
    if (!withoutCost.ok) throw new Error("unreachable");
    expect(withoutCost.value.costMinor).toBeNull();
    expect(withoutCost.value.costCurrency).toBe("GBP");

    const result = await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { costMinor: 3200, costCurrency: "EUR" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.costMinor).toBe(3200);
    expect(result.value.costCurrency).toBe("EUR");
  });

  it("preserves an existing cost when the edit doesn't submit one (design/DESIGN-AUDIT.md F4)", async () => {
    // Silent data loss guard (v1 audit, journeys finding 1): an edit that
    // omits costMinor must never null an already-set cost, or the Tab split
    // gated on that cost would be permanently disabled.
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { costMinor: 3200 });

    const afterUnrelatedEdit = await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { slots: 6 });
    if (!afterUnrelatedEdit.ok) throw new Error("unreachable");
    expect(afterUnrelatedEdit.value.slots).toBe(6);
    expect(afterUnrelatedEdit.value.costMinor).toBe(3200);
    expect(afterUnrelatedEdit.value.costCurrency).toBe("GBP");
  });

  it("clears a cost only when an empty cost is explicitly submitted", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { costMinor: 3200 });

    const cleared = await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { costMinor: null });
    if (!cleared.ok) throw new Error("unreachable");
    expect(cleared.value.costMinor).toBeNull();
  });

  it("edits the resolved venue's address without needing to re-supply its name", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    // seedCircle's venue has no address yet.
    const [before] = await fixture.db.select().from(venues).where(eq(venues.id, fixture.venueId));
    expect(before?.address ?? null).toBeNull();

    await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { venueAddress: "Braithwaite St, E1 6GJ" });
    const [after] = await fixture.db.select().from(venues).where(eq(venues.id, fixture.venueId));
    expect(after?.address).toBe("Braithwaite St, E1 6GJ");
  });

  it("attaches a fresh address to a newly-created venue when venueName + venueAddress are both given", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, {
      venueName: "Padel Palace",
      venueAddress: "1 Court Lane",
    });
    const [created] = await fixture.db.select().from(venues).where(eq(venues.name, "Padel Palace"));
    expect(created?.address).toBe("1 Court Lane");
  });
});

describe("isOrganiser / listCirclesForUser / listStandingGamesForCircle", () => {
  it("reports organiser status correctly for both roles", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    expect(await isOrganiser(fixture.db, fixture.circleId, fixture.organiserId)).toBe(true);
    expect(await isOrganiser(fixture.db, fixture.circleId, fixture.memberIds[0])).toBe(false);
  });

  it("lists circles a user belongs to with their role", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const circlesForOrganiser = await listCirclesForUser(fixture.db, fixture.organiserId);
    expect(circlesForOrganiser).toEqual([
      { circleId: fixture.circleId, circleName: "Test Circle", role: "organiser" },
    ]);
  });

  it("lists standing games scoped to one circle", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    const games = await listStandingGamesForCircle(fixture.db, fixture.circleId);
    expect(games).toHaveLength(1);
    expect(games[0].id).toBe(fixture.standingGameId);
  });
});

// -----------------------------------------------------------------------------
// Money opt-in XOR (GitHub issue #21): a game carries a "Booked on" signpost
// XOR a court cost, never both. Enforced in the SERVICE, not just forms:
// a payload with both is rejected, and setting one clears the other.
// -----------------------------------------------------------------------------

describe("money opt-in XOR — createStandingGame", () => {
  it("creates a booking-signposted game (platform + url) with no cost", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const result = await createStandingGame(fixture.db, fixture.organiserId, {
      circleId: fixture.circleId,
      weekday: 2,
      startTime: "20:00",
      bookingPlatform: "playtomic",
      bookingUrl: "https://playtomic.io/clubs/somewhere",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.bookingPlatform).toBe("playtomic");
    expect(result.value.bookingUrl).toBe("https://playtomic.io/clubs/somewhere");
    expect(result.value.costMinor).toBeNull();
  });

  it("stays silent by default — no booking, no cost, no money chrome", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const result = await createStandingGame(fixture.db, fixture.organiserId, {
      circleId: fixture.circleId,
      weekday: 2,
      startTime: "20:00",
    });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.bookingPlatform).toBeNull();
    expect(result.value.bookingUrl).toBeNull();
    expect(result.value.costMinor).toBeNull();
  });

  it("rejects a payload carrying BOTH a booking platform and a cost", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const result = await createStandingGame(fixture.db, fixture.organiserId, {
      circleId: fixture.circleId,
      weekday: 2,
      startTime: "20:00",
      bookingPlatform: "padel_mates",
      costMinor: 3200,
    });
    expect(result).toEqual({ ok: false, error: "booking_and_cost" });
  });

  it("rejects an unknown platform id and a non-http(s) booking url", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    expect(
      await createStandingGame(fixture.db, fixture.organiserId, {
        circleId: fixture.circleId,
        weekday: 2,
        startTime: "20:00",
        bookingPlatform: "skynet",
      }),
    ).toEqual({ ok: false, error: "invalid_booking_platform" });
    expect(
      await createStandingGame(fixture.db, fixture.organiserId, {
        circleId: fixture.circleId,
        weekday: 2,
        startTime: "20:00",
        bookingPlatform: "playtomic",
        bookingUrl: "javascript:alert(1)",
      }),
    ).toEqual({ ok: false, error: "invalid_booking_url" });
    expect(
      await createStandingGame(fixture.db, fixture.organiserId, {
        circleId: fixture.circleId,
        weekday: 2,
        startTime: "20:00",
        bookingPlatform: "playtomic",
        bookingUrl: "playtomic.io/no-scheme",
      }),
    ).toEqual({ ok: false, error: "invalid_booking_url" });
  });

  it("never stores a url without a platform", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const result = await createStandingGame(fixture.db, fixture.organiserId, {
      circleId: fixture.circleId,
      weekday: 2,
      startTime: "20:00",
      bookingUrl: "https://playtomic.io/x",
    });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.bookingPlatform).toBeNull();
    expect(result.value.bookingUrl).toBeNull();
  });
});

describe("money opt-in XOR — updateStandingGame", () => {
  it("setting a booking clears an existing cost", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { costMinor: 3200 });

    const result = await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, {
      bookingPlatform: "matchi",
      bookingUrl: "https://matchi.se/somewhere",
    });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.bookingPlatform).toBe("matchi");
    expect(result.value.bookingUrl).toBe("https://matchi.se/somewhere");
    expect(result.value.costMinor).toBeNull();
  });

  it("setting a cost clears an existing booking (platform AND url)", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, {
      bookingPlatform: "padium",
      bookingUrl: "https://padium.app/x",
    });

    const result = await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { costMinor: 4800 });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.costMinor).toBe(4800);
    expect(result.value.bookingPlatform).toBeNull();
    expect(result.value.bookingUrl).toBeNull();
  });

  it("rejects a patch carrying BOTH opt-ins, leaving the row untouched", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { costMinor: 3200 });

    const result = await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, {
      bookingPlatform: "club_website",
      costMinor: 4800,
    });
    expect(result).toEqual({ ok: false, error: "booking_and_cost" });

    const after = await getStandingGame(fixture.db, fixture.standingGameId!);
    expect(after?.costMinor).toBe(3200);
    expect(after?.bookingPlatform).toBeNull();
  });

  it("explicit clears never conflict: platform + costMinor:null in one patch is a clean booking set", async () => {
    // This is exactly what the edit form submits when an organiser picks a
    // platform while the cost field sits empty.
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    const result = await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, {
      bookingPlatform: "playtomic",
      costMinor: null,
    });
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.bookingPlatform).toBe("playtomic");
    expect(result.value.costMinor).toBeNull();
  });

  it("clearing the platform drops its url too, and an unrelated edit leaves the booking alone", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, {
      bookingPlatform: "other",
      bookingUrl: "https://example.com/booking",
    });

    const unrelated = await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { slots: 6 });
    if (!unrelated.ok) throw new Error("unreachable");
    expect(unrelated.value.bookingPlatform).toBe("other");
    expect(unrelated.value.bookingUrl).toBe("https://example.com/booking");

    const cleared = await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, {
      bookingPlatform: null,
    });
    if (!cleared.ok) throw new Error("unreachable");
    expect(cleared.value.bookingPlatform).toBeNull();
    expect(cleared.value.bookingUrl).toBeNull();
  });

  it("a url patch only sticks while a platform exists after the patch", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });

    // No platform stored, url alone: quietly dropped.
    const urlOnly = await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, {
      bookingUrl: "https://example.com/x",
    });
    if (!urlOnly.ok) throw new Error("unreachable");
    expect(urlOnly.value.bookingUrl).toBeNull();

    // Platform stored, url patch alone updates it.
    await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { bookingPlatform: "playtomic" });
    const urlAfter = await updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, {
      bookingUrl: "https://playtomic.io/updated",
    });
    if (!urlAfter.ok) throw new Error("unreachable");
    expect(urlAfter.value.bookingUrl).toBe("https://playtomic.io/updated");
  });
});
