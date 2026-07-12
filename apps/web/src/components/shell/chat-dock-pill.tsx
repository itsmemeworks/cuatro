"use client";

import { dockPillLabel, setChatDockPref, useChatDockPref } from "@/lib/chat-dock";

/*
 * ChatDockPill — the `docked ✓` / `dock` chip on the circle sidebar's Chat
 * row (design/CUATRO-Web-LATEST.dc.html dockPill; issue #29). A tiny client
 * island in the server-rendered sidebar, same mount pattern as
 * QuickSwitchHint (hotkeys.tsx): the chrome stays SSR'd around it.
 *
 * Clicking toggles the persisted dock preference (lib/chat-dock.ts) — the
 * dock column (DockedChat) and the Chat tab's handoff note react through the
 * same store, so the pill, the dock, and the tab flip together. The pill
 * lives INSIDE the NavRow <Link>, so it is a span[role=button] rather than a
 * real <button> (interactive content can't nest in an <a>); preventDefault +
 * stopPropagation keep a toggle from also navigating to the Chat tab.
 *
 * SSR/hydration: the server snapshot is docked (lib/chat-dock.ts rule), so
 * the SSR'd label is `docked ✓` and useSyncExternalStore swaps in the real
 * preference at hydration without a mismatch. Fixed-dark literals to match
 * the sidebar chrome; hover affordance in classes (CLAUDE.md 7b).
 */
export function ChatDockPill() {
  const docked = useChatDockPref();

  const toggle = () => setChatDockPref(!docked);

  return (
    <span
      role="button"
      tabIndex={0}
      aria-pressed={docked}
      aria-label={docked ? "Undock chat, send it back to its tab" : "Dock chat beside the page"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }
      }}
      className="cursor-pointer transition-colors text-[rgba(245,242,236,.4)] hover:text-[rgba(245,242,236,.75)]"
      style={{ font: "400 10px var(--font-mono), monospace", userSelect: "none", whiteSpace: "nowrap" }}
    >
      {dockPillLabel(docked)}
    </span>
  );
}
