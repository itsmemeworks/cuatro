"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUserLive } from "@/lib/realtime/hooks";

/**
 * The 4-tab nav — Games / Circle / Tab / You — matching
 * design/CUATRO-Prototype-LATEST.dc.html's nav block exactly: stacked
 * 21px stroke icon + 9.5px letter-spaced label, an 18×3px coral bar above
 * the active item, ink-muted for inactive. Icon paths are copied verbatim
 * from the prototype's `<svg>`s. Two differences from the prototype, both
 * deliberate:
 *
 * 1. The bottom padding uses `pb-safe` (this app's dynamic safe-area
 *    inset) instead of the prototype's flat 20px, which was only ever a
 *    stand-in for a phone frame in a design tool, not a real device's
 *    home-indicator inset.
 * 2. `fixed` positioning escapes the root layout's centred phone-frame
 *    column (see app/layout.tsx's G1 fix) — `inset-x-0 mx-auto max-w-[448px]`
 *    re-centres the bar at the same width rather than letting it stretch
 *    across a desktop viewport.
 *
 * The You item shows the real avatar photo (`avatarUrl`, now on
 * SessionUser — see lib/auth-store.ts) when the viewer has one, matching
 * the prototype's `<img avatarUrl>`; otherwise it falls back to the
 * initials disc (bg-action, matching components/ui/avatar.tsx's `Avatar`
 * treatment). Either way the ring/border colour still swaps exactly like
 * the prototype's `navYouC`-bordered avatar.
 */

type NavKey = "games" | "circle" | "tab" | "you";

/**
 * Mirrors the prototype's `navTab` derivation (`sub === 'ledger' ? 'you' :
 * (sub ? 'games' : tab)`): any Games sub-screen (session detail, standing
 * game, fourth call, result entry) counts as the Games tab; the Ledger
 * sub-screen counts as You; a Circle's Tab detail counts as Tab, not
 * Circle.
 */
function navKeyForPath(pathname: string | null): NavKey {
  if (!pathname) return "games";
  if (pathname.startsWith("/profile")) return "you";
  if (pathname.startsWith("/tab") || /^\/circles\/[^/]+\/tab(\/|$)/.test(pathname)) return "tab";
  if (pathname.startsWith("/feed") || pathname.startsWith("/circles")) return "circle";
  return "games";
}

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

function NavBar({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden
      className="absolute top-0 left-1/2 -translate-x-1/2 rounded-full bg-action transition-opacity duration-200"
      style={{ width: 18, height: 3, opacity: active ? 1 : 0 }}
    />
  );
}

function NavIcon({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? "var(--color-ink)" : "var(--color-ink-muted)"}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="transition-[stroke] duration-200"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function NavLabel({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span
      className="text-[9.5px] font-bold tracking-[0.04em] transition-colors duration-200"
      style={{ color: active ? "var(--color-ink)" : "var(--color-ink-muted)" }}
    >
      {children}
    </span>
  );
}

function NavItem({
  href,
  active,
  label,
  children,
}: {
  href: string;
  active: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className="relative flex-1 flex flex-col items-center gap-[3px] pt-[9px]"
      style={{ minHeight: 44 }}
    >
      <NavBar active={active} />
      {children}
      <NavLabel active={active}>{label}</NavLabel>
    </Link>
  );
}

export function BottomNav({
  userId,
  displayName,
  avatarUrl = null,
  initialHasOpenTabEntries = false,
  initialHasUnreadCircleMessages = false,
}: {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  initialHasOpenTabEntries?: boolean;
  initialHasUnreadCircleMessages?: boolean;
}) {
  const pathname = usePathname();
  const active = navKeyForPath(pathname);

  // Live-refreshed the same way NotificationBell refreshes its unread
  // count: refetch on every event on the viewer's user channel rather than
  // trusting the broadcast payload (see lib/realtime/channels.ts).
  const [hasOpenTabEntries, setHasOpenTabEntries] = useState(initialHasOpenTabEntries);
  const [hasUnreadCircleMessages, setHasUnreadCircleMessages] = useState(initialHasUnreadCircleMessages);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [tabRes, circlesRes] = await Promise.all([
        fetch("/api/tab/has-open-entries"),
        fetch("/api/circles/unread-count"),
      ]);
      if (tabRes.ok) {
        const body = await tabRes.json();
        if (!cancelledRef.current && typeof body.hasOpenEntries === "boolean") setHasOpenTabEntries(body.hasOpenEntries);
      }
      if (circlesRes.ok) {
        const body = await circlesRes.json();
        if (!cancelledRef.current && typeof body.hasUnread === "boolean") setHasUnreadCircleMessages(body.hasUnread);
      }
    } catch {
      // Silent — the dots just keep their last known state until the next live event.
    }
  }, []);

  useUserLive(userId, () => refresh());

  useEffect(() => {
    cancelledRef.current = false;
    refresh();
    return () => {
      cancelledRef.current = true;
    };
  }, [refresh]);

  return (
    <nav className="fixed bottom-0 inset-x-0 mx-auto max-w-[448px] flex bg-surface border-t border-ink-hairline-2 pt-1.5 px-2 pb-safe">
      <NavItem href="/home" active={active === "games"} label="Games">
        <NavIcon active={active === "games"}>
          <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="3.5" y1="12" x2="9" y2="12" />
          <line x1="15" y1="12" x2="20.5" y2="12" />
        </NavIcon>
      </NavItem>

      <NavItem href="/feed" active={active === "circle"} label="Circle">
        <div className="relative">
          <NavIcon active={active === "circle"}>
            <path d="M20 11.5a8 8 0 1 0-3.2 6.4L20.5 19l-.9-3.4A7.96 7.96 0 0 0 20 11.5z" />
          </NavIcon>
          {hasUnreadCircleMessages && (
            <span
              aria-hidden
              className="absolute rounded-full bg-action"
              style={{ width: 7, height: 7, top: -2, right: -4, border: "2px solid var(--color-surface)" }}
            />
          )}
        </div>
      </NavItem>

      <NavItem href="/tab" active={active === "tab"} label="Tab">
        <div className="relative">
          <NavIcon active={active === "tab"}>
            <path d="M6.5 3.5h11v17l-1.85-1.3-1.83 1.3-1.82-1.3-1.82 1.3-1.83-1.3-1.85 1.3z" />
            <line x1="9.5" y1="8.5" x2="14.5" y2="8.5" />
            <line x1="9.5" y1="12" x2="14.5" y2="12" />
          </NavIcon>
          {hasOpenTabEntries && (
            <span
              aria-hidden
              className="absolute rounded-full bg-action"
              style={{ width: 7, height: 7, top: -2, right: -4, border: "2px solid var(--color-surface)" }}
            />
          )}
        </div>
      </NavItem>

      <NavItem href="/profile" active={active === "you"} label="You">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- avatars are user-uploaded, served from /api/avatar/[userId]; next/image adds little here.
          <img
            src={avatarUrl}
            alt="You"
            className="rounded-full object-cover"
            style={{
              width: 21,
              height: 21,
              border: `1.5px solid ${active === "you" ? "var(--color-ink)" : "var(--color-ink-muted)"}`,
            }}
          />
        ) : (
          <div
            className="rounded-full flex items-center justify-center bg-action text-action-contrast font-extrabold"
            style={{
              width: 21,
              height: 21,
              fontSize: 9,
              border: `1.5px solid ${active === "you" ? "var(--color-ink)" : "var(--color-ink-muted)"}`,
            }}
          >
            {initialOf(displayName)}
          </div>
        )}
      </NavItem>
    </nav>
  );
}
