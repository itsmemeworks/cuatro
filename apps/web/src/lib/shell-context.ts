import type { ShellContext } from "@/components/shell/contract";

/**
 * Maps a Next.js pathname to the shell's two-context model — see the route
 * table in the contract's comment block (components/shell/contract.ts).
 *
 * PURE: no DB, no server imports. The responsive shell chrome calls this on
 * every render to decide which rail flag / context pill is active, so it stays
 * a plain string→object function with no I/O.
 */
export function resolveShellContext(pathname: string): ShellContext {
  // Normalise: strip a query string or hash, drop a trailing slash, split into
  // path segments ("/circles/abc/tab" → ["circles", "abc", "tab"]).
  const path = (pathname.split(/[?#]/, 1)[0] || "/").replace(/\/+$/, "");
  const segments = path.split("/").filter(Boolean);

  // Circle context: /circles/[id]* for a REAL circle id. "/circles/new" is the
  // create route (no clubhouse to be in the context of) and "/circles" is the
  // list — both fall through to home:other, per the contract's route table.
  if (segments[0] === "circles" && segments[1] && segments[1] !== "new") {
    return { kind: "circle", circleId: segments[1], active: circleActiveFor(segments[2]) };
  }

  return { kind: "home", active: homeActiveFor(segments[0]) };
}

/**
 * Wave C punch item: /games/[sessionId] belongs to a CIRCLE (the session's
 * clubhouse), but which circle is data, not path — this pure module can't
 * know it. This extractor names the sessionId when a path needs that lookup;
 * the (app) layout resolves it (server/shell-circle.ts) and overrides the
 * context to circle:games, falling back to resolveShellContext's home:week
 * when the session or membership doesn't check out. /games, /games/standing*,
 * and /games/one-off* stay home:week — game CREATION routes aren't a session
 * view, and treating their segment as a sessionId would burn a lookup per nav.
 */
export function gameSessionIdFor(pathname: string): string | null {
  const path = (pathname.split(/[?#]/, 1)[0] || "/").replace(/\/+$/, "");
  const segments = path.split("/").filter(Boolean);
  if (segments[0] !== "games" || !segments[1] || segments[1] === "standing" || segments[1] === "one-off") return null;
  return segments[1];
}

/**
 * The full context derivation INCLUDING the /games/[sessionId]→circle override,
 * with the data dependencies injected as plain functions so both resolvers can
 * share it (fix wave F3, the QA7 stale-chrome fix):
 *   - the (app) layout calls it with the server-side session→circle lookup
 *     already resolved (SSR initial state), and
 *   - the client shell (components/shell/use-shell-context.ts) calls it on
 *     every usePathname() change with its fetch-backed cache.
 * `sessionCircle` returns the session's circleId, null when the session is
 * unknown, or undefined when the answer isn't known YET (lookup in flight) —
 * both fall back to home:week, exactly the layout's old posture. The override
 * only applies when the viewer is a member of that circle (`isMemberCircle`),
 * so an outsider's deep link never paints a circle they're not in.
 */
export function resolveShellContextWithSession(
  pathname: string,
  sessionCircle: (sessionId: string) => string | null | undefined,
  isMemberCircle: (circleId: string) => boolean,
): ShellContext {
  const sessionId = gameSessionIdFor(pathname);
  if (sessionId) {
    const circleId = sessionCircle(sessionId);
    if (circleId && isMemberCircle(circleId)) return { kind: "circle", circleId, active: "games" };
    return { kind: "home", active: "week" };
  }
  return resolveShellContext(pathname);
}

/**
 * Which circle tab a /circles/[id]/<sub> path highlights. Wave A ships the Feed
 * as the landing tab; the deeper tabs (chat/members/games/tab) already have
 * routes the switcher links to, so they map here too. An unknown deeper segment
 * reads as "other" (no pill highlighted) rather than guessing.
 */
function circleActiveFor(subSegment: string | undefined): Extract<ShellContext, { kind: "circle" }>["active"] {
  switch (subSegment) {
    case undefined:
      return "feed";
    case "chat":
      return "chat";
    case "members":
      return "members";
    case "games":
      return "games";
    case "tab":
      return "tab";
    case "settings":
      return "settings";
    default:
      return "other";
  }
}

/** Which home context pill a top-level path highlights (contract route table). */
function homeActiveFor(top: string | undefined): Extract<ShellContext, { kind: "home" }>["active"] {
  switch (top) {
    case "home":
    case "feed":
    case "matches":
    case "games":
      return "week";
    case "discover":
    case "players":
      return "discover";
    case "tab":
      return "tab";
    case "profile":
      return "you";
    default:
      // "/circles", "/notifications", the marketing root "/", anything else.
      return "other";
  }
}
