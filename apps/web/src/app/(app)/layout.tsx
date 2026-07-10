import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { isSafeRelativePath } from "@/lib/safe-redirect";
import { getDb } from "@/server/db";
import { getCirclesStore } from "@/server/circles";
import { hasOpenEntriesAgainstViewer } from "@/server/tab";
import { hasUnreadMessages } from "@/server/circle-unread";
import { BottomNav } from "@/components/bottom-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) {
    const path = (await headers()).get("x-pathname");
    redirect(isSafeRelativePath(path) ? `/login?next=${encodeURIComponent(path)}` : "/login");
  }

  // Powers the Tab nav item's coral dot (see bottom-nav.tsx) — the unread
  // notification count moved out of this layout to (app)/home/page.tsx's
  // header bell, since the bell itself left the nav (design decision: the
  // prototype's Home screen has no nav-level notification affordance).
  const { db } = await getDb();
  const store = await getCirclesStore();
  const circles = await store.listCirclesForUser(user.id);
  const circleIds = circles.map((c) => c.id);
  const initialHasOpenTabEntries = await hasOpenEntriesAgainstViewer(db, circleIds, user.id);
  // Powers N2 (design/DESIGN-AUDIT.md) — the nav Circle-item's unread-chat dot.
  const initialHasUnreadCircleMessages = await hasUnreadMessages(db, circleIds, user.id);

  return (
    <div className="min-h-dvh flex flex-col bg-ground text-ink pt-safe">
      <div className="flex-1" style={{ paddingBottom: "var(--c4-nav-height)" }}>
        {children}
      </div>
      <BottomNav
        userId={user.id}
        displayName={user.displayName || user.email.split("@")[0] || "there"}
        avatarUrl={user.avatarUrl}
        initialHasOpenTabEntries={initialHasOpenTabEntries}
        initialHasUnreadCircleMessages={initialHasUnreadCircleMessages}
      />
    </div>
  );
}
