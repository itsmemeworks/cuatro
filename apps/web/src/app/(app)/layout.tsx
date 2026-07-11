import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { isSafeRelativePath } from "@/lib/safe-redirect";
import { getDb } from "@/server/db";
import { getCirclesStore } from "@/server/circles";
import { hasOpenEntriesAgainstViewer } from "@/server/tab";
import { hasUnreadMessages } from "@/server/circle-unread";
import { getShellData } from "@/server/shell";
import { resolveShellContext } from "@/lib/shell-context";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The proxy (lib/supabase/middleware.ts) forwards the request path here as
  // x-pathname (pathname + search) — layouts don't get a request object. It
  // rebuilds the `?next=` bounce for signed-out visitors AND feeds the shell's
  // active-context derivation, so read it once up top.
  const pathname = (await headers()).get("x-pathname");
  const user = await getSessionUser();
  if (!user) {
    redirect(isSafeRelativePath(pathname) ? `/login?next=${encodeURIComponent(pathname)}` : "/login");
  }

  // BottomNav dots (phone) keep their own dedicated boolean queries so the
  // phone experience is byte-for-byte unchanged; getShellData assembles the
  // wide chrome (rail/sidebar/topbar). All three are independent — run
  // together. The circle list / per-circle unread / tab net are computed in
  // both paths for now; noted in the manifest as a Wave B dedup, once the
  // phone home can read ShellData too.
  const { db } = await getDb();
  const store = await getCirclesStore();
  const circles = await store.listCirclesForUser(user.id);
  const circleIds = circles.map((c) => c.id);
  const [initialHasOpenTabEntries, initialHasUnreadCircleMessages, shellData] = await Promise.all([
    hasOpenEntriesAgainstViewer(db, circleIds, user.id),
    // Powers N2 (design/DESIGN-AUDIT.md) — the nav Circle-item's unread-chat dot.
    hasUnreadMessages(db, circleIds, user.id),
    getShellData(user.id),
  ]);

  const context = resolveShellContext(pathname ?? "/");

  return (
    <AppShell
      data={shellData}
      context={context}
      bottomNav={{
        userId: user.id,
        displayName: user.displayName || user.email.split("@")[0] || "there",
        avatarUrl: user.avatarUrl,
        initialHasOpenTabEntries,
        initialHasUnreadCircleMessages,
      }}
    >
      {children}
    </AppShell>
  );
}
