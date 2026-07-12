import { describe, expect, it } from "vitest";
import { gameSessionIdFor, resolveShellContext, resolveShellContextWithSession } from "@/lib/shell-context";

describe("resolveShellContext — home context", () => {
  it("maps /home, /feed, /matches*, /games* to home:week", () => {
    for (const path of ["/home", "/feed", "/matches", "/matches/new", "/games", "/games/abc123"]) {
      expect(resolveShellContext(path)).toEqual({ kind: "home", active: "week" });
    }
  });

  it("maps /discover and /players* to home:discover", () => {
    expect(resolveShellContext("/discover")).toEqual({ kind: "home", active: "discover" });
    expect(resolveShellContext("/discover/anything")).toEqual({ kind: "home", active: "discover" });
    expect(resolveShellContext("/players")).toEqual({ kind: "home", active: "discover" });
    expect(resolveShellContext("/players/u-1")).toEqual({ kind: "home", active: "discover" });
  });

  it("maps /tab to home:tab", () => {
    expect(resolveShellContext("/tab")).toEqual({ kind: "home", active: "tab" });
  });

  it("maps /profile* to home:you", () => {
    expect(resolveShellContext("/profile")).toEqual({ kind: "home", active: "you" });
    expect(resolveShellContext("/profile/ledger")).toEqual({ kind: "home", active: "you" });
  });

  it("maps /circles (list), /circles/new, /notifications, the root, and anything else to home:other", () => {
    for (const path of ["/circles", "/circles/new", "/notifications", "/", "/anything/else"]) {
      expect(resolveShellContext(path)).toEqual({ kind: "home", active: "other" });
    }
  });
});

describe("resolveShellContext — circle context", () => {
  it("maps a bare /circles/[id] to the feed tab", () => {
    expect(resolveShellContext("/circles/c-1")).toEqual({ kind: "circle", circleId: "c-1", active: "feed" });
  });

  it("maps each known circle sub-tab", () => {
    expect(resolveShellContext("/circles/c-1/chat")).toEqual({ kind: "circle", circleId: "c-1", active: "chat" });
    expect(resolveShellContext("/circles/c-1/members")).toEqual({ kind: "circle", circleId: "c-1", active: "members" });
    expect(resolveShellContext("/circles/c-1/games")).toEqual({ kind: "circle", circleId: "c-1", active: "games" });
    expect(resolveShellContext("/circles/c-1/tab")).toEqual({ kind: "circle", circleId: "c-1", active: "tab" });
  });

  it("maps /circles/[id]/settings to the settings row", () => {
    expect(resolveShellContext("/circles/c-1/settings")).toEqual({ kind: "circle", circleId: "c-1", active: "settings" });
  });

  it("maps an unknown deeper circle path to the circle context with no tab highlighted", () => {
    expect(resolveShellContext("/circles/c-1/anything-else")).toEqual({ kind: "circle", circleId: "c-1", active: "other" });
  });

  it("does NOT treat /circles/new as a circle (create route, not a clubhouse)", () => {
    expect(resolveShellContext("/circles/new")).toEqual({ kind: "home", active: "other" });
  });
});

describe("gameSessionIdFor — the data-aware /games/[sessionId] escape hatch (Wave C)", () => {
  it("names the sessionId for a session view", () => {
    expect(gameSessionIdFor("/games/s-1")).toBe("s-1");
    expect(gameSessionIdFor("/games/s-1/")).toBe("s-1");
    expect(gameSessionIdFor("/games/s-1?from=home")).toBe("s-1");
  });

  it("returns null for /games, the standing-game editor routes, and non-game paths", () => {
    for (const path of ["/games", "/games/standing", "/games/standing/new", "/games/standing/sg-1", "/games/one-off/new", "/home", "/circles/c-1/games"]) {
      expect(gameSessionIdFor(path)).toBeNull();
    }
  });

  it("keeps the pure fallback at home:week (the layout overrides only after a membership-checked lookup)", () => {
    expect(resolveShellContext("/games/s-1")).toEqual({ kind: "home", active: "week" });
  });
});

describe("resolveShellContextWithSession — the shared server/client resolver (fix wave F3)", () => {
  const memberOf = (...ids: string[]) => (id: string) => ids.includes(id);

  it("overrides /games/[sessionId] into circle:games when the session's circle is known and the viewer is a member", () => {
    expect(resolveShellContextWithSession("/games/s-1", () => "c-1", memberOf("c-1"))).toEqual({
      kind: "circle",
      circleId: "c-1",
      active: "games",
    });
  });

  it("falls back to home:week for an unknown session (null) and while the lookup is in flight (undefined)", () => {
    expect(resolveShellContextWithSession("/games/s-1", () => null, memberOf("c-1"))).toEqual({ kind: "home", active: "week" });
    expect(resolveShellContextWithSession("/games/s-1", () => undefined, memberOf("c-1"))).toEqual({ kind: "home", active: "week" });
  });

  it("never paints a circle the viewer is not a member of (outsider deep link)", () => {
    expect(resolveShellContextWithSession("/games/s-1", () => "c-other", memberOf("c-1"))).toEqual({ kind: "home", active: "week" });
  });

  it("matches the pure resolver exactly on non-session paths (lookup never consulted)", () => {
    const explode = () => {
      throw new Error("sessionCircle must not be called for non-session paths");
    };
    for (const path of ["/home", "/circles/c-1/chat", "/games", "/games/standing/sg-1", "/tab", "/discover"]) {
      expect(resolveShellContextWithSession(path, explode, memberOf("c-1"))).toEqual(resolveShellContext(path));
    }
  });
});

describe("resolveShellContext — normalisation", () => {
  it("ignores a trailing slash", () => {
    expect(resolveShellContext("/circles/c-1/")).toEqual({ kind: "circle", circleId: "c-1", active: "feed" });
    expect(resolveShellContext("/tab/")).toEqual({ kind: "home", active: "tab" });
  });

  it("ignores a query string and hash", () => {
    expect(resolveShellContext("/players?q=ben")).toEqual({ kind: "home", active: "discover" });
    expect(resolveShellContext("/circles/c-1/tab#latest")).toEqual({ kind: "circle", circleId: "c-1", active: "tab" });
  });
});
