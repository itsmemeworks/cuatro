"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NotificationBell } from "@/components/notifications/NotificationBell";

const TABS = [
  { href: "/home", label: "Home", icon: "🏠" },
  { href: "/games", label: "Games", icon: "🎾" },
  { href: "/circles", label: "Circles", icon: "⭘" },
  { href: "/profile", label: "Profile", icon: "●" },
] as const;

export function BottomNav({ userId, initialUnreadCount = 0 }: { userId: string; initialUnreadCount?: number }) {
  const pathname = usePathname();
  const notificationsActive = pathname?.startsWith("/notifications");

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 flex justify-around"
      style={{
        background: "var(--c4-bg-elevated)",
        borderTop: "1px solid var(--c4-border)",
        height: "var(--c4-nav-height)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {TABS.map((tab) => {
        const active = pathname?.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="flex flex-1 flex-col items-center justify-center gap-0.5"
            style={{
              minHeight: "var(--c4-touch-target)",
              color: active ? "var(--c4-accent)" : "var(--c4-text-muted)",
            }}
          >
            <span className="text-lg leading-none" aria-hidden>
              {tab.icon}
            </span>
            <span className="text-[11px] font-medium">{tab.label}</span>
          </Link>
        );
      })}
      <div
        className="flex flex-1 flex-col items-center justify-center gap-0.5"
        style={{ color: notificationsActive ? "var(--c4-accent)" : "var(--c4-text-muted)" }}
      >
        <NotificationBell userId={userId} initialUnreadCount={initialUnreadCount} />
        <span className="text-[11px] font-medium">Alerts</span>
      </div>
    </nav>
  );
}
