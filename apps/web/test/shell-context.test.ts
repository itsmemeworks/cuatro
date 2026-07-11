import { describe, expect, it } from "vitest";
import { resolveShellContext } from "@/lib/shell-context";

describe("resolveShellContext — home context", () => {
  it("maps /home, /feed, /matches*, /games* to home:week", () => {
    for (const path of ["/home", "/feed", "/matches", "/matches/new", "/games", "/games/abc123"]) {
      expect(resolveShellContext(path)).toEqual({ kind: "home", active: "week" });
    }
  });

  it("maps /players* to home:discover", () => {
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

  it("maps an unknown deeper circle path to the circle context with no tab highlighted", () => {
    expect(resolveShellContext("/circles/c-1/settings")).toEqual({ kind: "circle", circleId: "c-1", active: "other" });
  });

  it("does NOT treat /circles/new as a circle (create route, not a clubhouse)", () => {
    expect(resolveShellContext("/circles/new")).toEqual({ kind: "home", active: "other" });
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
