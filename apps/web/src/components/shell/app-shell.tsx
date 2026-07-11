import { BottomNav } from "@/components/bottom-nav";
import type { ShellContext, ShellData } from "./contract";
import { Rail } from "./rail";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { ShellHotkeys } from "./hotkeys";
import { DockedChat } from "./docked-chat";

/*
 * AppShell — the responsive frame the (app) route group renders inside.
 * ONE server-rendered tree, three CSS-selected faces (no hydration width
 * switch, no flash):
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
 */

interface AppShellProps {
  data: ShellData;
  context: ShellContext;
  bottomNav: {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
    initialHasOpenTabEntries: boolean;
    initialHasUnreadCircleMessages: boolean;
  };
  children: React.ReactNode;
}

export function AppShell({ data, context, bottomNav, children }: AppShellProps) {
  return (
    <>
      <div className="flex min-h-dvh bg-ground text-ink">
        <Rail data={data} context={context} className="hidden min-[1440px]:flex" />
        <Sidebar data={data} context={context} className="hidden min-[1440px]:flex" />
        <div className="flex-1 min-w-0 flex flex-col min-h-dvh bg-ground">
          <Topbar data={data} context={context} className="hidden min-[900px]:flex min-[1440px]:hidden" />
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
