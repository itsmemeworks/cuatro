"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ShellCircle } from "./contract";
import type { QuickSwitchData } from "@/server/quick-switch";
import {
  NAV_ITEMS,
  emptyStateRows,
  filterItems,
  gameTitle,
  itemKey,
  metaLabel,
  pushRecent,
  type QuickSwitchItem,
} from "@/lib/quick-switch";

/*
 * QuickSwitcher — the ⌘K overlay (design/CUATRO-Web-LATEST.dc.html "Quick
 * switcher" screen; WEB-SHELL-SPEC.md Wave D). Pixels + focus/selection only:
 * the matching/ranking/empty-state logic is lib/quick-switch.ts (pure,
 * unit-tested), the global key bindings live in hotkeys.tsx, and the lazy
 * /api/quick-switch fetch is owned by hotkeys.tsx so its cache survives
 * close/reopen.
 *
 * Escape is handled LOCALLY (onKeyDown inside the dialog — the search input
 * has focus, so it always bubbles through here; never a global bind). Like
 * the rest of the wide chrome this surface is fixed-dark in both themes, so
 * hexes are the design's literals; hover states live in CLASSES because the
 * rows carry inline styles (CLAUDE.md 7b).
 */

const FONT_UI = "var(--font-archivo), sans-serif";
const FONT_MONO = "var(--font-mono), monospace";
const BONE = "#F5F2EC";
const BONE_35 = "rgba(245,242,236,.35)";
const CORAL = "#FF5C3D";
const CORAL_STRONG = "#FF7A5C";
const HIGHLIGHT = "#FF8A73";
const PANEL_BG = "#17150F";

export type EntriesStatus = "idle" | "loading" | "ready" | "error";

export interface QuickSwitchEntries {
  status: EntriesStatus;
  data: QuickSwitchData | null;
  /** already passed through errorCopy by the owner (raw codes never reach the UI) */
  errorText: string | null;
}

const RECENTS_KEY = "cuatro.quick-switch.recent";

function readRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function writeRecents(keys: string[]) {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(keys));
  } catch {
    // storage full/denied — recents are a nicety, never an error
  }
}

/** Row icon per kind: circle flag, dashed-coral seat (open game), person avatar, home diamond. */
function RowIcon({ item }: { item: QuickSwitchItem }) {
  if (item.kind === "nav") {
    return (
      <div
        aria-hidden
        style={{
          width: 26,
          height: 26,
          borderRadius: 9,
          border: "1px solid rgba(245,242,236,.15)",
          color: CORAL,
          font: `800 12px/24px ${FONT_UI}`,
          textAlign: "center",
          flex: "none",
          boxSizing: "border-box",
        }}
      >
        ◆
      </div>
    );
  }
  if (item.kind === "person") {
    if (item.avatarUrl) {
      return (
        <div
          aria-hidden
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            border: "1px solid rgba(245,242,236,.15)",
            backgroundImage: `url('${item.avatarUrl}')`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            flex: "none",
          }}
        />
      );
    }
    return (
      <div
        aria-hidden
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: "rgba(245,242,236,.12)",
          color: BONE,
          font: `800 11px/26px ${FONT_UI}`,
          textAlign: "center",
          flex: "none",
        }}
      >
        {item.title.trim().slice(0, 1).toUpperCase() || "?"}
      </div>
    );
  }
  // An OPEN game shows the dashed coral seat — a space waiting for a person,
  // nothing else (design law). Full games and circles show the circle flag.
  if (item.kind === "game" && item.seatDigit != null) {
    return (
      <div
        aria-hidden
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          border: `2px dashed ${CORAL}`,
          color: CORAL_STRONG,
          font: `800 11px/22px ${FONT_UI}`,
          textAlign: "center",
          flex: "none",
          boxSizing: "border-box",
        }}
      >
        {item.seatDigit}
      </div>
    );
  }
  return (
    <div
      aria-hidden
      style={{
        width: 26,
        height: 26,
        borderRadius: 9,
        background: item.flagColor ?? "rgba(245,242,236,.12)",
        color: "#fff",
        font: `800 10px/26px ${FONT_UI}`,
        textAlign: "center",
        flex: "none",
      }}
    >
      {item.flagText ?? ""}
    </div>
  );
}

/** Title with the contiguous match highlighted (the design's coral <strong>). */
function RowTitle({ item, range, typed }: { item: QuickSwitchItem; range: [number, number] | null; typed: boolean }) {
  const t = item.title;
  return (
    <span style={{ font: `600 13px ${FONT_UI}`, color: BONE, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {range ? (
        <>
          {t.slice(0, range[0])}
          <strong style={{ color: HIGHLIGHT }}>{t.slice(range[0], range[1])}</strong>
          {t.slice(range[1])}
        </>
      ) : (
        t
      )}
      {typed && item.kind === "game" && " · this week"}
    </span>
  );
}

export function QuickSwitcher({
  circles,
  entries,
  onClose,
}: {
  circles: ShellCircle[];
  entries: QuickSwitchEntries;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [recents, setRecents] = useState<string[]>(() => readRecents());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = useMemo<QuickSwitchItem[]>(() => {
    const flagById = new Map(circles.map((c) => [c.id, { color: c.color, text: c.emblem ?? c.initials }]));
    const circleItems: QuickSwitchItem[] = circles.map((c) => ({
      kind: "circle",
      id: c.id,
      href: `/circles/${c.id}`,
      title: c.name,
      keywords: c.statusLine ?? undefined,
      flagColor: c.color,
      flagText: c.emblem ?? c.initials,
    }));
    const gameItems: QuickSwitchItem[] = (entries.data?.games ?? []).map((g) => {
      const open = g.confirmedCount < g.slots;
      const flag = flagById.get(g.circleId);
      return {
        kind: "game",
        id: g.sessionId,
        href: `/games/${g.sessionId}`,
        title: gameTitle(g),
        keywords: `${g.circleName} this week`,
        needsAnswer: g.needsAnswer,
        // The seat being sought ("4" when three are in) — dashed icon digit.
        seatDigit: open ? Math.min(g.confirmedCount + 1, g.slots) : undefined,
        flagColor: flag?.color,
        flagText: flag?.text,
      };
    });
    const personItems: QuickSwitchItem[] = (entries.data?.people ?? []).map((p) => ({
      kind: "person",
      id: p.userId,
      href: `/players/${p.userId}`,
      title: p.displayName,
      keywords: p.circleNames.join(" "),
      avatarUrl: p.avatarUrl,
    }));
    return [...circleItems, ...gameItems, ...personItems, ...NAV_ITEMS];
  }, [circles, entries.data]);

  const typed = query.trim().length > 0;
  const rows = useMemo(
    () =>
      typed
        ? filterItems(items, query)
        : emptyStateRows(items, recents).map((item) => ({ item, range: null as [number, number] | null })),
    [typed, items, query, recents],
  );
  const clampedSelected = Math.min(selected, Math.max(0, rows.length - 1));

  function go(item: QuickSwitchItem) {
    const nextRecents = pushRecent(recents, itemKey(item));
    setRecents(nextRecents);
    writeRecents(nextRecents);
    onClose();
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[clampedSelected];
      if (row) go(row.item);
    }
  }

  function moveSelection(delta: number) {
    if (rows.length === 0) return;
    const next = (clampedSelected + delta + rows.length) % rows.length;
    setSelected(next);
    listRef.current?.querySelector(`[data-row-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div
      role="presentation"
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        // Backdrop click closes; clicks inside the panel land on rows.
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(10,9,8,.6)", padding: "0 16px" }}
    >
      <div
        role="dialog"
        aria-label="Quick switcher"
        style={{
          maxWidth: 560,
          margin: "110px auto 0",
          background: PANEL_BG,
          border: "1px solid rgba(245,242,236,.16)",
          borderRadius: 18,
          boxShadow: "0 30px 80px rgba(0,0,0,.6)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxHeight: "min(70vh, 640px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid rgba(245,242,236,.08)", flex: "none" }}>
          <span
            aria-hidden
            style={{
              font: `600 11px ${FONT_MONO}`,
              color: "rgba(245,242,236,.4)",
              border: "1px solid rgba(245,242,236,.15)",
              borderRadius: 6,
              padding: "2px 6px",
            }}
          >
            ⌘K
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            placeholder={'search circles, people, games… try "tue"'}
            aria-label="Search circles, people, games"
            style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: BONE, font: `500 14px ${FONT_UI}` }}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close quick switcher"
            className="cursor-pointer transition-cu-state hover:opacity-70"
            style={{ font: `700 12px ${FONT_UI}`, color: "rgba(245,242,236,.5)" }}
          >
            esc
          </button>
        </div>

        <div ref={listRef} style={{ overflowY: "auto" }}>
          <div style={{ padding: "10px 16px 4px", font: `800 10px ${FONT_UI}`, letterSpacing: ".14em", color: BONE_35 }}>
            {typed ? "BEST MATCHES" : "RECENT"}
          </div>

          {rows.length === 0 && (
            <p style={{ padding: "10px 16px 16px", font: `400 11px ${FONT_MONO}`, color: "rgba(245,242,236,.45)" }}>
              {typed ? "no matches · try a circle, a name, or a day" : "nothing to jump to yet"}
            </p>
          )}

          {rows.map(({ item, range }, i) => {
            const isSelected = i === clampedSelected;
            const label = metaLabel(item, { typed, selected: isSelected });
            return (
              <button
                key={itemKey(item)}
                type="button"
                data-row-index={i}
                onClick={() => go(item)}
                onMouseEnter={() => setSelected(i)}
                className={`w-full cursor-pointer text-left ${isSelected ? "bg-[rgba(245,242,236,.05)]" : "hover:bg-[rgba(245,242,236,.05)]"}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: i === rows.length - 1 ? "10px 16px 14px" : "10px 16px",
                  userSelect: "none",
                }}
              >
                <RowIcon item={item} />
                <RowTitle item={item} range={range} typed={typed} />
                <span className="shrink-0" style={{ font: `400 10px ${FONT_MONO}`, color: item.needsAnswer ? CORAL_STRONG : BONE_35 }}>
                  {label}
                </span>
              </button>
            );
          })}

          {entries.status === "loading" && (
            <p style={{ padding: "4px 16px 12px", font: `400 10px ${FONT_MONO}`, color: BONE_35 }}>loading people and games</p>
          )}
          {entries.status === "error" && entries.errorText && (
            <p style={{ padding: "4px 16px 12px", font: `400 10px ${FONT_MONO}`, color: BONE_35 }}>{entries.errorText}</p>
          )}
        </div>

        <div
          className="shrink-0"
          style={{ display: "flex", gap: 12, padding: "10px 16px", borderTop: "1px solid rgba(245,242,236,.08)", font: `400 10px ${FONT_MONO}`, color: BONE_35 }}
        >
          <span>
            <strong style={{ color: "rgba(245,242,236,.55)" }}>g c</strong> circle
          </span>
          <span>
            <strong style={{ color: "rgba(245,242,236,.55)" }}>g w</strong> week
          </span>
          <span>
            <strong style={{ color: "rgba(245,242,236,.55)" }}>g t</strong> tab
          </span>
          <span style={{ flex: 1 }} />
          <span>
            <strong style={{ color: "rgba(245,242,236,.55)" }}>↵</strong> open
          </span>
          <span>
            <strong style={{ color: "rgba(245,242,236,.55)" }}>esc</strong> close
          </span>
        </div>
      </div>
    </div>
  );
}
