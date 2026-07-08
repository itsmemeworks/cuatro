"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const POLL_INTERVAL_MS = 60_000;

/**
 * Bell icon + unread badge, polling /api/notifications/unread-count. Not
 * wired into the bottom nav yet — that's a separate pass (see this file's
 * task scope: "nav wiring happens later, don't touch nav") — exported
 * standalone so dropping it into the nav later is a straight import.
 */
export function NotificationBell({ initialUnreadCount = 0 }: { initialUnreadCount?: number }) {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/notifications/unread-count");
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled && typeof body.unreadCount === "number") setUnreadCount(body.unreadCount);
      } catch {
        // Silent — the badge just keeps its last known count until the next tick.
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

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
