"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { useCircleLive } from "@/lib/realtime/hooks";
import { useChatDockActive } from "@/lib/chat-dock";
import { BP_TABLET_MIN, type ShellContext, type ShellData } from "./contract";
import { Rail } from "./rail";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { ShellHotkeys } from "./hotkeys";
import { DockedChat } from "./docked-chat";
import { useShellContext } from "./use-shell-context";

/*
 * AppShell — the responsive frame the (app) route group renders inside.
 * ONE tree, three CSS-selected faces (no hydration width switch, no flash):
 *
 *   < 900px            phone: children in the centred 448 column + BottomNav,
 *                      byte-for-byte the pre-shell (app) layout. Rail /
 *                      sidebar / topbar are display:none; the content column
 *                      keeps pt-safe + the nav-height bottom pad.
 *   900 – 1439px       tablet: the Topbar appears, BottomNav goes away, the
 *                      content pad switches to the desktop 26/34 values.
 *   >= 1440px          desktop: Rail (76) + Sidebar (236) join the row.
 *
 * children render exactly once; only the chrome around them toggles. The
 * 448 clamp on the content column is why the existing phone-designed pages
 * still look right centred on the wide content ground (wide page layouts are
 * Wave B). The content padding + BottomNav visibility live in the
 * `.c4-shell-*` classes in globals.css so the phone/wide switch is a single
 * media query, not competing Tailwind utilities and inline styles.
 *
 * CLIENT component since fix wave F3 (QA7's stale-chrome blocker): the shell
 * context is derived from usePathname() on every soft navigation (⌘K,
 * g-sequences, <Link>), with the server-resolved context as initial state —
 * see use-shell-context.ts. `children` stays a server-rendered slot; a chrome
 * re-render never re-renders the page inside it.
 *
 * BADGE LIVENESS BOUNDARY (QA3's ambient-badge finding, documented per the
 * fix-wave contract): the ACTIVE circle's unread-chat badge (sidebar Chat row
 * / topbar Chat pill) is LIVE — the shell registers one handler on that
 * circle's pooled realtime channel (lib/realtime/shared-channels.ts refcounts
 * it with the page's own subscriptions, so this adds NO extra websocket
 * channel) and refetches the authed unread count on message/reconnect events.
 * OTHER circles' badges (home sidebar YOUR CIRCLES dots, and any circle you
 * are not currently in) render the layout's server snapshot and refresh
 * whenever the (app) layout re-renders — a hard load or any router.refresh()
 * (which every realtime-live page already issues on events). Deliberately NOT
 * N-per-circle subscriptions.
 */

interface AppShellProps {
  data: ShellData;
  /** Server-resolved context for the requested pathname — the client takes over from here (use-shell-context.ts). */
  initialContext: ShellContext;
  bottomNav: {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
    initialHasOpenTabEntries: boolean;
    initialHasUnreadCircleMessages: boolean;
  };
  children: React.ReactNode;
}

/* Live >=900 viewport gate (SSR snapshot false) — the wide chrome exists at
 * tablet+ only, so the badge watcher below skips its refetch work on phones,
 * where BottomNav/CircleTabs already own the live unread surfaces. */
let tabletMql: MediaQueryList | null = null;
function getTabletMql(): MediaQueryList {
  if (!tabletMql) tabletMql = window.matchMedia(`(min-width: ${BP_TABLET_MIN}px)`);
  return tabletMql;
}
function subscribeTabletWide(listener: () => void): () => void {
  const m = getTabletMql();
  m.addEventListener("change", listener);
  return () => m.removeEventListener("change", listener);
}
function useTabletWide(): boolean {
  return useSyncExternalStore(subscribeTabletWide, () => getTabletMql().matches, () => false);
}

/**
 * The active circle's live unread-chat count, as overrides on top of the
 * ShellData snapshot (see the badge-liveness boundary in the header comment).
 * Mirrors circle-tabs.tsx's watcher: while chat is on screen (docked, or the
 * chat route itself) CircleChat owns read state, so the badge shows 0 and the
 * watcher never refetches — a refetch could race the mark-read POST and
 * resurrect a badge for a message the viewer is looking at.
 */
function useLiveUnreadOverrides(data: ShellData, context: ShellContext): Record<string, number> {
  const wide = useTabletWide();
  const dockActive = useChatDockActive();
  const activeCircleId = context.kind === "circle" ? context.circleId : null;
  const chatVisible = context.kind === "circle" && (dockActive || context.active === "chat");
  const chatVisibleRef = useRef(chatVisible);
  chatVisibleRef.current = chatVisible;

  const [overrides, setOverrides] = useState<Record<string, number>>({});

  // A layout re-render delivered a fresh server snapshot — drop the overrides,
  // the snapshot is newer than anything we fetched before it.
  useEffect(() => {
    setOverrides({});
  }, [data]);

  const refreshUnread = useCallback(async (circleId: string) => {
    try {
      const res = await fetch(`/api/circles/${circleId}/unread-count`);
      if (!res.ok) return;
      const body = (await res.json()) as { count?: unknown };
      if (typeof body.count === "number") setOverrides((o) => ({ ...o, [circleId]: body.count as number }));
    } catch {
      // Best-effort — the badge keeps its last known value until the next event.
    }
  }, []);

  useCircleLive(wide ? activeCircleId : null, (event) => {
    if ((event.type === "message" || event.type === "reconnect") && !chatVisibleRef.current && activeCircleId) {
      void refreshUnread(activeCircleId);
    }
  });

  // Chat on screen = everything in it is being read; pin the badge at 0 so it
  // stays honest after the viewer navigates away (until the next message).
  useEffect(() => {
    if (chatVisible && activeCircleId) {
      setOverrides((o) => (o[activeCircleId] === 0 ? o : { ...o, [activeCircleId]: 0 }));
    }
  }, [chatVisible, activeCircleId]);

  return overrides;
}

export function AppShell({ data, initialContext, bottomNav, children }: AppShellProps) {
  const context = useShellContext(
    initialContext,
    data.circles.map((c) => c.id),
  );

  const unreadOverrides = useLiveUnreadOverrides(data, context);
  const liveData = useMemo<ShellData>(() => {
    if (Object.keys(unreadOverrides).length === 0) return data;
    return {
      ...data,
      circles: data.circles.map((c) => (unreadOverrides[c.id] != null ? { ...c, unreadChatCount: unreadOverrides[c.id] } : c)),
    };
  }, [data, unreadOverrides]);

  return (
    <>
      <div className="flex min-h-dvh bg-ground text-ink">
        <Rail data={liveData} context={context} className="hidden min-[1440px]:flex" />
        <Sidebar data={liveData} context={context} className="hidden min-[1440px]:flex" />
        <div className="flex-1 min-w-0 flex flex-col min-h-dvh bg-ground">
          <Topbar data={liveData} context={context} className="hidden min-[900px]:flex min-[1440px]:hidden" />
          <div className="c4-shell-content">{children}</div>
        </div>
        {/* Wave D: the docked chat column, desktop circle-context only. The
            component itself owns dock/undock state and the one-subscription
            coordination; this wrapper only decides that the slot exists. */}
        {context.kind === "circle" && (
          <div className="hidden min-[1440px]:flex">
            <DockedChat
              circleId={context.circleId}
              currentUserId={bottomNav.userId}
              circle={data.circles.find((c) => c.id === context.circleId) ?? null}
            />
          </div>
        )}
      </div>
      {/* Wave D: the global keyboard layer (⌘K + g-sequences), mounted once. */}
      <ShellHotkeys circles={data.circles} />
      {/* BottomNav is `fixed`; the wrapper's display:none at 900+ removes it
          from the wide shells without touching the component's own props. */}
      <div className="min-[900px]:hidden">
        <BottomNav
          userId={bottomNav.userId}
          displayName={bottomNav.displayName}
          avatarUrl={bottomNav.avatarUrl}
          initialHasOpenTabEntries={bottomNav.initialHasOpenTabEntries}
          initialHasUnreadCircleMessages={bottomNav.initialHasUnreadCircleMessages}
        />
      </div>
    </>
  );
}
