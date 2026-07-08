"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/home", label: "Home", icon: "🏠" },
  { href: "/circles", label: "Circles", icon: "⭘" },
  { href: "/profile", label: "Profile", icon: "●" },
] as const;

export function BottomNav() {
  const pathname = usePathname();

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
    </nav>
  );
}
