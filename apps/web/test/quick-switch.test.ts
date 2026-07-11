import { describe, expect, it } from "vitest";
import {
  GO_TIMEOUT_MS,
  MAX_EMPTY_ROWS,
  MAX_RESULTS,
  NAV_ITEMS,
  emptyStateRows,
  filterItems,
  formatGameWhen,
  gameTitle,
  goHref,
  goStep,
  isEditableTarget,
  itemKey,
  metaLabel,
  pushRecent,
  scoreItem,
  type QuickSwitchItem,
} from "@/lib/quick-switch";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const circle = (id: string, title: string, keywords?: string): QuickSwitchItem => ({
  kind: "circle",
  id,
  href: `/circles/${id}`,
  title,
  keywords,
});
const game = (id: string, title: string, opts: Partial<QuickSwitchItem> = {}): QuickSwitchItem => ({
  kind: "game",
  id,
  href: `/games/${id}`,
  title,
  ...opts,
});
const person = (id: string, title: string, keywords?: string): QuickSwitchItem => ({
  kind: "person",
  id,
  href: `/players/${id}`,
  title,
  keywords,
});

const ITEMS: QuickSwitchItem[] = [
  circle("c1", "Tuesday Night Lot", "Tue 8pm · 1 spot open"),
  circle("c2", "Work Lot", "Thu 7pm · full ✓"),
  game("g1", "Tue 8pm · Powerleague", { keywords: "Tuesday Night Lot this week", needsAnswer: true, seatDigit: 4 }),
  game("g2", "Thu 7pm · Rocket Padel", { keywords: "Work Lot this week" }),
  person("p1", "Priya Patel", "Tuesday Night Lot"),
  person("p2", "Tomas Diaz", "Work Lot"),
  ...NAV_ITEMS,
];

// ---------------------------------------------------------------------------
// scoring + filtering
// ---------------------------------------------------------------------------

describe("scoreItem", () => {
  it("ranks whole-title prefix best, with the highlight range", () => {
    expect(scoreItem(circle("c", "Tuesday Night Lot"), "tue")).toEqual({ score: 0, range: [0, 3] });
  });

  it("ranks a word-boundary prefix above a mid-word hit", () => {
    const word = scoreItem(circle("c", "Tuesday Night Lot"), "night");
    const mid = scoreItem(circle("c", "Tuesday Night Lot"), "esday");
    expect(word).toEqual({ score: 1, range: [8, 13] });
    expect(mid).toEqual({ score: 2, range: [2, 7] });
  });

  it("matches keywords (no highlight range) below any title hit", () => {
    expect(scoreItem(circle("c", "Work Lot", "Thu 7pm · full"), "thu")).toEqual({ score: 3, range: null });
  });

  it("falls back to a title subsequence, and rejects non-matches", () => {
    expect(scoreItem(circle("c", "Tuesday Night Lot"), "tnl")).toEqual({ score: 4, range: null });
    expect(scoreItem(circle("c", "Tuesday Night Lot"), "xyz")).toBeNull();
  });

  it("is case-insensitive and trims the query; empty queries never match", () => {
    expect(scoreItem(circle("c", "Tuesday Night Lot"), " TUE ")).toEqual({ score: 0, range: [0, 3] });
    expect(scoreItem(circle("c", "Tuesday Night Lot"), "   ")).toBeNull();
  });
});

describe("filterItems", () => {
  it("orders by score band, then kind (circle > game > person > nav)", () => {
    const rows = filterItems(ITEMS, "tue");
    // Both the circle and the game title-prefix-match "tue" (score 0); the
    // circle wins the tie, exactly as the design's BEST MATCHES shows.
    expect(rows.map((r) => r.item.id).slice(0, 2)).toEqual(["c1", "g1"]);
  });

  it("searches keywords too — a venue or shared-circle name finds the row", () => {
    const rows = filterItems(ITEMS, "powerleague");
    expect(rows[0].item.id).toBe("g1");
    const viaCircleName = filterItems(ITEMS, "work lot");
    expect(viaCircleName.map((r) => r.item.id)).toContain("p2");
  });

  it("excludes non-matches entirely and caps at MAX_RESULTS", () => {
    expect(filterItems(ITEMS, "zzz")).toHaveLength(0);
    const many = Array.from({ length: 20 }, (_, i) => circle(`c${i}`, `Tuesday ${i}`));
    expect(filterItems(many, "tue")).toHaveLength(MAX_RESULTS);
  });

  it("matches 'tab' to The Tab via the nav item", () => {
    const rows = filterItems(ITEMS, "tab");
    expect(rows.some((r) => r.item.kind === "nav" && r.item.id === "tab")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// empty state (RECENT)
// ---------------------------------------------------------------------------

describe("emptyStateRows", () => {
  it("backfills circles, Your week, then needs-answer games when there are no recents", () => {
    const rows = emptyStateRows(ITEMS, []);
    expect(rows.map(itemKey).slice(0, 4)).toEqual(["circle:c1", "circle:c2", "nav:week", "game:g1"]);
    expect(rows.length).toBeLessThanOrEqual(MAX_EMPTY_ROWS);
  });

  it("puts real recents first (MRU order), dedupes the backfill, drops stale keys", () => {
    const rows = emptyStateRows(ITEMS, ["game:g2", "circle:c2", "circle:gone"]);
    expect(rows.map(itemKey).slice(0, 2)).toEqual(["game:g2", "circle:c2"]);
    // c2 was consumed by recents — the backfill must not repeat it.
    expect(rows.map(itemKey).filter((k) => k === "circle:c2")).toHaveLength(1);
  });

  it("caps at the limit", () => {
    const many = [...Array.from({ length: 10 }, (_, i) => circle(`c${i}`, `Circle ${i}`)), ...NAV_ITEMS];
    expect(emptyStateRows(many, [])).toHaveLength(MAX_EMPTY_ROWS);
  });
});

describe("pushRecent", () => {
  it("prepends, dedupes, and caps", () => {
    expect(pushRecent(["a", "b"], "b")).toEqual(["b", "a"]);
    expect(pushRecent(["a", "b", "c", "d", "e"], "f")).toEqual(["f", "a", "b", "c", "d"]);
  });
});

// ---------------------------------------------------------------------------
// meta labels
// ---------------------------------------------------------------------------

describe("metaLabel", () => {
  const openGame = game("g", "Tue 8pm", { needsAnswer: true });
  it("matches the design's empty state: kind labels, coral ask reads 'needs your answer'", () => {
    expect(metaLabel(circle("c", "X"), { typed: false, selected: false })).toBe("circle");
    expect(metaLabel(NAV_ITEMS[0], { typed: false, selected: false })).toBe("home");
    expect(metaLabel(openGame, { typed: false, selected: false })).toBe("needs your answer");
  });
  it("matches the typed state: '· needs answer' suffix, '· ↵' on the selected row", () => {
    expect(metaLabel(openGame, { typed: true, selected: false })).toBe("game · needs answer");
    expect(metaLabel(circle("c", "X"), { typed: true, selected: true })).toBe("circle · ↵");
    expect(metaLabel(person("p", "X"), { typed: true, selected: false })).toBe("person");
  });
});

// ---------------------------------------------------------------------------
// g-sequences
// ---------------------------------------------------------------------------

const ev = (key: string, now: number, opts: { editable?: boolean; hasModifier?: boolean } = {}) => ({
  key,
  now,
  editable: opts.editable ?? false,
  hasModifier: opts.hasModifier ?? false,
});

describe("goStep", () => {
  it("fires g c / g w / g t inside the window", () => {
    for (const [key, target] of [
      ["c", "circle"],
      ["w", "week"],
      ["t", "tab"],
    ] as const) {
      const armed = goStep(null, ev("g", 1000));
      expect(armed).toEqual({ armedAt: 1000, target: null });
      expect(goStep(armed.armedAt, ev(key, 1000 + GO_TIMEOUT_MS))).toEqual({ armedAt: null, target });
    }
  });

  it("expires after the ~1s window", () => {
    const armed = goStep(null, ev("g", 1000));
    expect(goStep(armed.armedAt, ev("c", 1000 + GO_TIMEOUT_MS + 1))).toEqual({ armedAt: null, target: null });
  });

  it("any other second key disarms without firing", () => {
    const armed = goStep(null, ev("g", 0));
    expect(goStep(armed.armedAt, ev("x", 100))).toEqual({ armedAt: null, target: null });
  });

  it("a second g re-arms (the window restarts)", () => {
    const armed = goStep(null, ev("g", 0));
    const rearmed = goStep(armed.armedAt, ev("g", 900));
    expect(rearmed).toEqual({ armedAt: 900, target: null });
    expect(goStep(rearmed.armedAt, ev("c", 1800))).toEqual({ armedAt: null, target: "circle" });
  });

  it("is suppressed (and reset) while typing or with a modifier held", () => {
    expect(goStep(null, ev("g", 0, { editable: true }))).toEqual({ armedAt: null, target: null });
    const armed = goStep(null, ev("g", 0));
    expect(goStep(armed.armedAt, ev("c", 100, { editable: true }))).toEqual({ armedAt: null, target: null });
    expect(goStep(armed.armedAt, ev("c", 100, { hasModifier: true }))).toEqual({ armedAt: null, target: null });
  });

  it("is case-insensitive (caps lock still navigates)", () => {
    const armed = goStep(null, ev("G", 0));
    expect(goStep(armed.armedAt, ev("C", 500))).toEqual({ armedAt: null, target: "circle" });
  });
});

describe("goHref", () => {
  it("g c goes to the active circle, else the circles list", () => {
    expect(goHref("circle", "abc")).toBe("/circles/abc");
    expect(goHref("circle", null)).toBe("/circles");
    expect(goHref("week", null)).toBe("/home");
    expect(goHref("tab", "abc")).toBe("/tab");
  });
});

describe("isEditableTarget", () => {
  it("guards inputs, textareas, selects, and contentEditable", () => {
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "textarea" as string })).toBe(true);
    expect(isEditableTarget({ tagName: "SELECT" })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV" })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// game labels
// ---------------------------------------------------------------------------

describe("game labels", () => {
  // Tuesday 2026-07-14 19:00 UTC = 8pm London (BST).
  const TUE_8PM = Date.UTC(2026, 6, 14, 19, 0, 0);
  it("formats 'Tue 8pm' in the session's timezone, minutes only when real", () => {
    expect(formatGameWhen(TUE_8PM, "Europe/London")).toBe("Tue 8pm");
    expect(formatGameWhen(TUE_8PM + 30 * 60 * 1000, "Europe/London")).toBe("Tue 8:30pm");
  });
  it("builds 'Tue 8pm · Powerleague' and drops an unknown venue", () => {
    expect(gameTitle({ startsAt: TUE_8PM, timezone: "Europe/London", venueName: "Powerleague" })).toBe("Tue 8pm · Powerleague");
    expect(gameTitle({ startsAt: TUE_8PM, timezone: "Europe/London", venueName: null })).toBe("Tue 8pm");
  });
});
