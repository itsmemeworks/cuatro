import { afterEach, describe, expect, it } from "vitest";
import { venues } from "@cuatro/db";
import { eq } from "drizzle-orm";
import { seedCircle, type Fixture } from "./support/games-fixtures";
import {
  createStandingGame,
  isOrganiser,
  listCirclesForUser,
  listStandingGamesForCircle,
  updateStandingGame,
} from "@/server/standing-games-service";

let fixture: Fixture | undefined;
afterEach(() => {
  fixture?.close();
  fixture = undefined;
});

describe("createStandingGame", () => {
  it("rejects a non-organiser member", () => {
    fixture = seedCircle({ memberCount: 2 });
    const result = createStandingGame(fixture.db, fixture.memberIds[0], {
      circleId: fixture.circleId,
      weekday: 2,
      startTime: "20:00",
    });
    expect(result).toEqual({ ok: false, error: "not_an_organiser" });
  });

  it("rejects an invalid weekday or malformed start time", () => {
    fixture = seedCircle({ memberCount: 1 });
    expect(
      createStandingGame(fixture.db, fixture.organiserId, { circleId: fixture.circleId, weekday: 9, startTime: "20:00" }),
    ).toEqual({ ok: false, error: "invalid_weekday" });
    expect(
      createStandingGame(fixture.db, fixture.organiserId, { circleId: fixture.circleId, weekday: 2, startTime: "8pm" }),
    ).toEqual({ ok: false, error: "invalid_start_time" });
  });

  it("creates a standing game with sensible defaults", () => {
    fixture = seedCircle({ memberCount: 1 });
    const result = createStandingGame(fixture.db, fixture.organiserId, {
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

  it("creates a new venue for an unrecognised free-text name, and reuses it by exact name next time", () => {
    fixture = seedCircle({ memberCount: 1 });
    const first = createStandingGame(fixture.db, fixture.organiserId, {
      circleId: fixture.circleId,
      weekday: 2,
      startTime: "20:00",
      venueName: "Padel Palace",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");
    expect(first.value.venueId).not.toBeNull();

    const second = createStandingGame(fixture.db, fixture.organiserId, {
      circleId: fixture.circleId,
      weekday: 4,
      startTime: "19:00",
      venueName: "Padel Palace",
    });
    if (!second.ok) throw new Error("unreachable");
    expect(second.value.venueId).toBe(first.value.venueId);

    const allVenues = fixture.db.select().from(venues).where(eq(venues.name, "Padel Palace")).all();
    expect(allVenues).toHaveLength(1);
  });
});

describe("updateStandingGame", () => {
  it("rejects updates from a non-organiser", () => {
    fixture = seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    const result = updateStandingGame(fixture.db, fixture.memberIds[0], fixture.standingGameId!, { slots: 6 });
    expect(result).toEqual({ ok: false, error: "not_an_organiser" });
  });

  it("toggles active without touching other fields", () => {
    fixture = seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00", slots: 4 } });
    const result = updateStandingGame(fixture.db, fixture.organiserId, fixture.standingGameId!, { active: false });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.active).toBe(false);
    expect(result.value.slots).toBe(4);
  });

  it("returns not_found for an unknown id", () => {
    fixture = seedCircle({ memberCount: 1 });
    const result = updateStandingGame(fixture.db, fixture.organiserId, "does-not-exist", { active: false });
    expect(result).toEqual({ ok: false, error: "not_found" });
  });
});

describe("isOrganiser / listCirclesForUser / listStandingGamesForCircle", () => {
  it("reports organiser status correctly for both roles", () => {
    fixture = seedCircle({ memberCount: 1 });
    expect(isOrganiser(fixture.db, fixture.circleId, fixture.organiserId)).toBe(true);
    expect(isOrganiser(fixture.db, fixture.circleId, fixture.memberIds[0])).toBe(false);
  });

  it("lists circles a user belongs to with their role", () => {
    fixture = seedCircle({ memberCount: 1 });
    const circlesForOrganiser = listCirclesForUser(fixture.db, fixture.organiserId);
    expect(circlesForOrganiser).toEqual([
      { circleId: fixture.circleId, circleName: "Test Circle", role: "organiser" },
    ]);
  });

  it("lists standing games scoped to one circle", () => {
    fixture = seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    const games = listStandingGamesForCircle(fixture.db, fixture.circleId);
    expect(games).toHaveLength(1);
    expect(games[0].id).toBe(fixture.standingGameId);
  });
});
