import { describe, expect, it } from "vitest";
import { parsePinnedGameResponse, pinnedStatusLine } from "@/components/shell/docked-pinned-game";

// The docked chat's pinned-game card (issue #29): pure status line + the
// defensive parse of GET /api/circles/[id]/pinned-game. The fetching card
// itself (DockedPinnedGame) is a client island and is verified live.

describe("pinnedStatusLine", () => {
  it("matches PinnedGameBar's full-game phrasing", () => {
    expect(pinnedStatusLine(4, 4)).toBe("4 of 4, game on");
  });

  it("counts open spots with singular/plural", () => {
    expect(pinnedStatusLine(4, 3)).toBe("3 of 4 in · 1 spot left");
    expect(pinnedStatusLine(4, 2)).toBe("2 of 4 in · 2 spots left");
  });

  it("never goes negative when over-filled (reserve promotion race)", () => {
    expect(pinnedStatusLine(4, 5)).toBe("4 of 4, game on");
  });
});

describe("parsePinnedGameResponse", () => {
  const game = {
    sessionId: "s1",
    startsAt: 1_760_000_000_000,
    timezone: "Europe/London",
    venueName: "Powerleague",
    slots: 4,
    confirmedCount: 3,
    booking: null,
  };

  it("parses a well-formed game", () => {
    expect(parsePinnedGameResponse({ ok: true, game })).toEqual(game);
  });

  it("keeps a valid booking signpost and drops its url-less shape to null url", () => {
    const withBooking = { ...game, booking: { platform: "playtomic", url: "https://playtomic.io/x" } };
    expect(parsePinnedGameResponse({ ok: true, game: withBooking })?.booking).toEqual({
      platform: "playtomic",
      url: "https://playtomic.io/x",
    });
    const urlLess = { ...game, booking: { platform: "matchi" } };
    expect(parsePinnedGameResponse({ ok: true, game: urlLess })?.booking).toEqual({ platform: "matchi", url: null });
  });

  it("degrades an unknown booking platform to no chip, not no card", () => {
    const unknown = { ...game, booking: { platform: "not_a_platform", url: null } };
    expect(parsePinnedGameResponse({ ok: true, game: unknown })).toEqual({ ...game, booking: null });
  });

  it("returns null for nothing-upcoming, error bodies, and shape drift", () => {
    expect(parsePinnedGameResponse({ ok: true, game: null })).toBeNull();
    expect(parsePinnedGameResponse({ ok: false, error: "not_member" })).toBeNull();
    expect(parsePinnedGameResponse(null)).toBeNull();
    expect(parsePinnedGameResponse("nonsense")).toBeNull();
    expect(parsePinnedGameResponse({ ok: true, game: { ...game, startsAt: "tomorrow" } })).toBeNull();
  });
});
