"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useUserLive } from "@/lib/realtime/hooks";

/**
 * Bell icon + unread badge, wired into the bottom nav (see bottom-nav.tsx).
 * Unread count is refetched — never trusted from the broadcast payload
 * itself, which per lib/realtime/channels.ts's design carries only
 * {type, id fields, ts} — every time this user's `cuatro:user:{id}` channel
 * fires (a new notification, a fourth call, Glass moving, ...). This
 * replaced a 60s poll: the count now updates the moment a notification is
 * written, not up to a minute later.
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
      <span className="text-lg leading-none" aria-hidden>
        🔔
      </span>
      {unreadCount > 0 && (
        <span
          className="absolute top-1 right-1 flex items-center justify-center rounded-full text-[10px] font-semibold"
          style={{
            minWidth: 16,
            height: 16,
            padding: "0 4px",
            background: "var(--c4-accent)",
            color: "var(--c4-accent-contrast)",
          }}
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
