/*
 * WAVE A SHELL CONTRACT — LEAD-OWNED. Agents read this file; they never edit it.
 * (WEB-SHELL-SPEC.md Wave A. Change requests go in your manifest, the lead applies.)
 *
 * Breakpoints (the spec's rule, stated in design/CUATRO-Web-LATEST.dc.html chrome):
 *   < 900px            → the existing phone experience, byte-for-byte (448px column + BottomNav)
 *   900px – 1439px     → tablet shell: top bar (brand, circle chip/dropdown, context pills, bell, avatar)
 *   >= 1440px          → desktop shell: icon rail (76px) + context sidebar (236px) + content column
 * Branching is CSS-first (responsive classes on server-rendered markup), never a
 * hydration-dependent JS switch: the phone markup must be in the HTML at phone widths
 * with zero flash. Wide chrome hidden below 900, BottomNav hidden at 900+.
 */

/** px thresholds — single source of truth for the shell's responsive classes */
export const BP_TABLET_MIN = 900;
export const BP_DESKTOP_MIN = 1440;

/**
 * One circle as the shell chrome needs it (rail flag, sidebar row, switcher row).
 * Colors/initials follow the design's circle flags (e.g. TN on #3E7BFA).
 */
export interface ShellCircle {
  id: string;
  name: string;
  /** two-letter flag fallback, derived from the name exactly as the phone app already does */
  initials: string;
  /**
   * custom circle emblem when set (the phone flag renders `emblem ?? initials`
   * — wide chrome must do the same so rail flags match the phone app)
   */
  emblem: string | null;
  /** flag background hex */
  color: string;
  /** mono status line, e.g. "Tue 8pm · 1 spot open" or "Thu 7pm · full ✓"; null when nothing upcoming */
  statusLine: string | null;
  /** unread chat messages, renders as a numeric pill badge */
  unreadChatCount: number;
  /** for the circle-context sidebar header subline "6 members · est. 2024" */
  memberCount: number;
  foundedYear: number | null;
  /**
   * The viewer's net position INSIDE this circle for the circle-context
   * sidebar Tab row (the global rollup stays on ShellData). Same money rules.
   */
  circleTabNetLine: string | null;
  circleTabNetOwing: boolean;
  /** coral dot on the rail flag / sidebar row (needs-answer, open spot, etc.) */
  needsAttention: boolean;
}

/** Sidebar footer identity card + topbar avatar */
export interface ShellIdentity {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /**
   * mono fact line under the name. Rules (hard conventions, see CLAUDE.md #6):
   * rating hidden until 3 verified matches — pre-placement this line is the
   * placement progress ("Placement Trio · 1 of 3"), post-reveal "Glass 4.62 · conf 78%".
   */
  factLine: string;
}

export interface ShellData {
  identity: ShellIdentity;
  circles: ShellCircle[];
  /**
   * Viewer's net position across all circles for the sidebar "The Tab" row,
   * e.g. "−£4" / "+£8"; null when all square. Money rules: amount_minor +
   * currency, never floats, currencies never net against each other — when the
   * viewer has balances in more than one currency, show the primary (GBP-first)
   * and let the Tab page itself explain.
   */
  tabNetLine: string | null;
  /** true when the viewer owes overall (renders in the down/negative colour) */
  tabNetOwing: boolean;
  unreadNotifications: number;
  /** count for the Discover nav item's green badge (open games near the viewer's patch this week); null hides the badge */
  discoverCount: number | null;
}

/*
 * WAVE B money-format rule (applies to every ShellData/ShellCircle amount):
 * whole pounds render WITHOUT pence ("+£8", "−£4"); pence only when real
 * ("£8.50"). The design never shows ".00".
 */

/** Which context the shell is in and which nav item is active, derived from the pathname */
export type ShellContext =
  | { kind: "home"; active: "week" | "discover" | "tab" | "you" | "other" }
  | { kind: "circle"; circleId: string; active: "feed" | "chat" | "members" | "games" | "tab" | "settings" | "other" };

/*
 * Route → context mapping (WAVE B revision — B5 implements in lib/shell-context.ts):
 *   /circles/[id]            → circle:feed
 *   /circles/[id]/chat       → circle:chat
 *   /circles/[id]/members    → circle:members
 *   /circles/[id]/games*     → circle:games
 *   /circles/[id]/tab        → circle:tab
 *   /circles/[id]/settings   → circle:settings (organiser surface; the route
 *                              itself bounces non-organisers to Feed)
 *   /circles/[id]/<other>    → circle:other
 *   /home, /feed, /matches*, /games, /games/standing* → home:week
 *   /games/[sessionId]       → circle:games for the session's circle (WAVE C:
 *                              data-aware — lib/shell-context.ts gameSessionIdFor
 *                              names the lookup, the (app) layout resolves it via
 *                              server/shell-circle.ts; non-members and unknown
 *                              sessions fall back to home:week)
 *   /discover, /players*     → home:discover   (Discover's own page = /discover, NEW in Wave B)
 *   /tab                     → home:tab
 *   /profile*                → home:you
 *   /circles, /notifications, anything else → home:other (no pill highlighted)
 */
