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
      className="fixed bottom-0 left-0 right-0 flex justify-around bg-surface border-t border-ink-hairline-2 pb-safe h-[var(--c4-nav-height)]"
    >
      {TABS.map((tab) => {
        const active = pathname?.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 min-h-11 transition-cu-state ${
              active ? "text-ink font-extrabold" : "text-ink-muted font-semibold"
            }`}
          >
            <span className="text-lg leading-none" aria-hidden>
              {tab.icon}
            </span>
            <span className="text-[11px]">{tab.label}</span>
          </Link>
        );
      })}
      <div
        className={`flex flex-1 flex-col items-center justify-center gap-0.5 transition-cu-state ${
          notificationsActive ? "text-ink font-extrabold" : "text-ink-muted font-semibold"
        }`}
      >
        <NotificationBell userId={userId} initialUnreadCount={initialUnreadCount} />
        <span className="text-[11px]">Alerts</span>
      </div>
    </nav>
  );
}
