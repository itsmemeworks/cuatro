"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useUserLive } from "@/lib/realtime/hooks";

/**
 * Bell icon + unread indicator, in the Games-header (see (app)/home/page.tsx).
 * Quiet by design (design/DESIGN-AUDIT.md H2): a 21px ink-muted stroke icon
 * matching the bottom nav's icon language, not an emoji — with just a 6px
 * coral dot for "something's unread", not a numeric badge. Unread count is
 * refetched — never trusted from the broadcast payload itself, which per
 * lib/realtime/channels.ts's design carries only {type, id fields, ts} —
 * every time this user's `cuatro:user:{id}` channel fires (a new
 * notification, a fourth call, Glass moving, ...). This replaced a 60s poll:
 * the dot now updates the moment a notification is written, not up to a
 * minute later.
 */
export function NotificationBell({ userId, initialUnreadCount = 0 }: { userId: string; initialUnreadCount?: number }) {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/unread-count");
      if (!res.ok) return;
      const body = await res.json();
      if (!cancelledRef.current && typeof body.unreadCount === "number") setUnreadCount(body.unreadCount);
    } catch {
      // Silent — the badge just keeps its last known count until the next live event.
    }
  }, []);

  useUserLive(userId, () => {
    refresh();
  });

  useEffect(() => {
    cancelledRef.current = false;
    refresh(); // catch up on mount, covering the gap between server render and the socket subscribing
    return () => {
      cancelledRef.current = true;
    };
  }, [refresh]);

  return (
    <Link
      href="/notifications"
      className="relative inline-flex items-center justify-center"
      style={{ minHeight: "var(--c4-touch-target)", minWidth: "var(--c4-touch-target)" }}
      aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
    >
      <svg
        width="21"
        height="21"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-ink-muted)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M6 15V10.5a6 6 0 0 1 12 0V15l1.6 2.1a.8.8 0 0 1-.64 1.28H5.04a.8.8 0 0 1-.64-1.28L6 15z" />
        <path d="M9.5 20a2.5 2.5 0 0 0 5 0" />
      </svg>
      {unreadCount > 0 && (
        <span
          aria-hidden
          className="absolute rounded-full bg-action"
          style={{ width: 6, height: 6, top: 3, right: 3, border: "1.5px solid var(--color-ground)" }}
        />
      )}
    </Link>
  );
}
