/**
 * quick-switch — the PURE logic behind the ⌘K quick switcher and the g-key
 * navigation sequences (WEB-SHELL-SPEC.md Wave D, design/CUATRO-Web-LATEST
 * "Quick switcher" screen). No React, no DOM globals, no fetch: everything
 * here is unit-testable without mounting (house pattern — see lib/geo.ts,
 * lib/shell-context.ts). components/shell/hotkeys.tsx owns the event wiring,
 * components/shell/quick-switcher.tsx owns the pixels.
 */

// ---------------------------------------------------------------------------
// Items — one shape for everything the switcher can jump to
// ---------------------------------------------------------------------------

export type QuickSwitchKind = "circle" | "game" | "person" | "nav";

export interface QuickSwitchItem {
  kind: QuickSwitchKind;
  /** unique within its kind (circle id, session id, user id, nav slug) */
  id: string;
  href: string;
  /** the row's primary text; the filter searches (and highlights) this */
  title: string;
  /** extra searched-but-not-shown text: venue, circle names, "home week" */
  keywords?: string;
  /** open game the viewer hasn't answered — coral meta label + dashed icon */
  needsAnswer?: boolean;
  // Display-only extras the overlay renders; the filter ignores them.
  /** circle-flag background (circle rows) */
  flagColor?: string;
  /** circle-flag glyph: emblem ?? initials (circle rows) */
  flagText?: string;
  /** person rows */
  avatarUrl?: string | null;
  /** dashed-circle digit for an OPEN game: the seat being sought ("4") */
  seatDigit?: number;
}

/** Stable key for recents storage + React keys. */
export function itemKey(item: Pick<QuickSwitchItem, "kind" | "id">): string {
  return `${item.kind}:${item.id}`;
}

/** Sorting tiebreak between kinds ("tue" ranks the circle above the game, per the design). */
const KIND_RANK: Record<QuickSwitchKind, number> = { circle: 0, game: 1, person: 2, nav: 3 };

/** The always-available client-side jump targets (no fetch, no data). */
export const NAV_ITEMS: QuickSwitchItem[] = [
  { kind: "nav", id: "week", href: "/home", title: "Your week", keywords: "home week diary" },
  { kind: "nav", id: "discover", href: "/discover", title: "Discover", keywords: "players open games near" },
  { kind: "nav", id: "tab", href: "/tab", title: "The Tab", keywords: "money owes settle" },
  { kind: "nav", id: "you", href: "/profile", title: "You", keywords: "profile settings ledger glass" },
];

// ---------------------------------------------------------------------------
// Filtering + ranking
// ---------------------------------------------------------------------------

export interface QuickSwitchMatch {
  item: QuickSwitchItem;
  /** lower is better; see scoreItem for the bands */
  score: number;
  /** contiguous [start, end) highlight range in `title`, null when the hit was in keywords / fuzzy */
  range: [number, number] | null;
}

/** How many rows the typed state shows (the design's panel is a short list, not a browser). */
export const MAX_RESULTS = 8;

/**
 * Score one item against a query. Bands, best first:
 *   0 title starts with the query          ("tue" → "Tuesday Night Lot")
 *   1 a word in the title starts with it   ("night" → "Tuesday Night Lot")
 *   2 title contains it mid-word
 *   3 keywords contain it                  (venue names, circle names)
 *   4 title matches it as a subsequence    ("tnl" → "Tuesday Night Lot")
 * null = no match. The highlight range is only returned for contiguous title
 * hits (0–2); keyword/fuzzy hits render unhighlighted.
 */
export function scoreItem(item: QuickSwitchItem, query: string): { score: number; range: [number, number] | null } | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const title = item.title.toLowerCase();
  const idx = title.indexOf(q);
  if (idx === 0) return { score: 0, range: [0, q.length] };
  if (idx > 0) {
    const boundary = !/[a-z0-9]/.test(title[idx - 1]);
    return { score: boundary ? 1 : 2, range: [idx, idx + q.length] };
  }
  if (item.keywords && item.keywords.toLowerCase().includes(q)) return { score: 3, range: null };
  if (isSubsequence(q, title)) return { score: 4, range: null };
  return null;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

/**
 * Filter + rank the full item set for a typed query: score band first, then
 * kind (circle > game > person > nav), then the caller's original order.
 * Capped at MAX_RESULTS.
 */
export function filterItems(items: QuickSwitchItem[], query: string): QuickSwitchMatch[] {
  const scored: Array<QuickSwitchMatch & { index: number }> = [];
  items.forEach((item, index) => {
    const s = scoreItem(item, query);
    if (s) scored.push({ item, score: s.score, range: s.range, index });
  });
  scored.sort((a, b) => a.score - b.score || KIND_RANK[a.item.kind] - KIND_RANK[b.item.kind] || a.index - b.index);
  return scored.slice(0, MAX_RESULTS).map(({ item, score, range }) => ({ item, score, range }));
}

// ---------------------------------------------------------------------------
// Empty-query state — the design's RECENT list
// ---------------------------------------------------------------------------

/** How many rows the empty state shows (the design shows three; six is the ceiling). */
export const MAX_EMPTY_ROWS = 6;

/**
 * Rows for the empty-query pane: the viewer's actual recents (MRU keys from
 * localStorage, mapped back onto live items so stale entries vanish), then
 * backfilled to feel alive on first use — circles in shell order, "Your week",
 * needs-answer games, then other games. Deduped, capped at MAX_EMPTY_ROWS.
 * (The design's empty state: a circle, Your week, a needs-answer game.)
 */
export function emptyStateRows(items: QuickSwitchItem[], recentKeys: string[], limit: number = MAX_EMPTY_ROWS): QuickSwitchItem[] {
  const byKey = new Map(items.map((i) => [itemKey(i), i]));
  const rows: QuickSwitchItem[] = [];
  const seen = new Set<string>();

  const push = (item: QuickSwitchItem | undefined) => {
    if (!item || rows.length >= limit) return;
    const key = itemKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(item);
  };

  for (const key of recentKeys) push(byKey.get(key));
  for (const item of items) if (item.kind === "circle") push(item);
  push(byKey.get("nav:week"));
  for (const item of items) if (item.kind === "game" && item.needsAnswer) push(item);
  for (const item of items) if (item.kind === "game") push(item);
  return rows;
}

/** MRU update for the recents list (newest first, deduped, capped). */
export function pushRecent(recentKeys: string[], key: string, cap = 5): string[] {
  return [key, ...recentKeys.filter((k) => k !== key)].slice(0, cap);
}

// ---------------------------------------------------------------------------
// Meta labels (the mono right-hand column)
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<QuickSwitchKind, string> = { circle: "circle", game: "game", person: "person", nav: "home" };

/**
 * The row's mono meta label, per the design's two states:
 *   empty ("RECENT"): "circle" / "home" / "person" / "game", except a
 *     needs-answer game which reads "needs your answer".
 *   typed ("BEST MATCHES"): kind, "· needs answer" appended on open asks,
 *     "· ↵" appended on the selected row.
 */
export function metaLabel(item: QuickSwitchItem, opts: { typed: boolean; selected: boolean }): string {
  if (!opts.typed) {
    if (opts.selected) return `${KIND_LABEL[item.kind]} · ↵`;
    return item.needsAnswer ? "needs your answer" : KIND_LABEL[item.kind];
  }
  if (opts.selected) return `${KIND_LABEL[item.kind]} · ↵`;
  return item.needsAnswer ? `${KIND_LABEL[item.kind]} · needs answer` : KIND_LABEL[item.kind];
}

// ---------------------------------------------------------------------------
// g-sequences — g c / g w / g t with a ~1s window
// ---------------------------------------------------------------------------

export const GO_TIMEOUT_MS = 1000;

export type GoTarget = "circle" | "week" | "tab";

export interface GoKeyEvent {
  key: string;
  /** ms timestamp (performance.now() or Date.now(); only deltas matter) */
  now: number;
  /** an input/textarea/select/contentEditable has focus — sequences are suppressed */
  editable: boolean;
  /** any of meta/ctrl/alt held — never steal a real shortcut */
  hasModifier: boolean;
}

/**
 * One step of the g-sequence machine. State is just the arm timestamp (null =
 * idle). Rules: typing contexts and modified keys always reset; a second key
 * within GO_TIMEOUT_MS of `g` fires its target; `g` (re)arms, anything else
 * disarms. Pure so the ~1s window is testable without timers.
 */
export function goStep(armedAt: number | null, ev: GoKeyEvent): { armedAt: number | null; target: GoTarget | null } {
  if (ev.editable || ev.hasModifier) return { armedAt: null, target: null };
  const key = ev.key.toLowerCase();
  if (armedAt !== null && ev.now - armedAt <= GO_TIMEOUT_MS) {
    if (key === "c") return { armedAt: null, target: "circle" };
    if (key === "w") return { armedAt: null, target: "week" };
    if (key === "t") return { armedAt: null, target: "tab" };
  }
  if (key === "g") return { armedAt: ev.now, target: null };
  return { armedAt: null, target: null };
}

/** Where a fired target goes: g c = the ACTIVE circle, else the circles list. */
export function goHref(target: GoTarget, activeCircleId: string | null): string {
  switch (target) {
    case "circle":
      return activeCircleId ? `/circles/${activeCircleId}` : "/circles";
    case "week":
      return "/home";
    case "tab":
      return "/tab";
  }
}

/**
 * Is the event target a typing context? (input/textarea/select or
 * contentEditable — the g-sequence and plain-key guards.) Takes the minimal
 * shape so tests never need a DOM.
 */
export function isEditableTarget(t: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

// ---------------------------------------------------------------------------
// Game row label — "Tue 8pm · Powerleague"
// ---------------------------------------------------------------------------

/**
 * "Tue 8pm" / "Thu 7:30pm" in the session's effective timezone — the same
 * shape as the shell's status lines (server/shell.ts formatSessionWhen keeps a
 * private twin; both pin to the contract's example format).
 */
export function formatGameWhen(startsAtMs: number, timeZone: string): string {
  const date = new Date(startsAtMs);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(date);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const period = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toLowerCase().replace(/\s/g, "");
  return `${weekday} ${hour}${minute === "00" ? "" : `:${minute}`}${period}`;
}

/** "Tue 8pm · Powerleague" (venue dropped when unknown). */
export function gameTitle(game: { startsAt: number; timezone: string; venueName: string | null }): string {
  const when = formatGameWhen(game.startsAt, game.timezone);
  return game.venueName ? `${when} · ${game.venueName}` : when;
}
