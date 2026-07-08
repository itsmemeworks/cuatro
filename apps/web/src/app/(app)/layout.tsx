import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { getUnreadCount } from "@/server/notifications";
import { BottomNav } from "@/components/bottom-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { db } = await getGamesClient();
  const initialUnreadCount = getUnreadCount(db, user.id);

  return (
    <div className="min-h-dvh flex flex-col bg-ground text-ink pt-safe">
      <div className="flex-1" style={{ paddingBottom: "var(--c4-nav-height)" }}>
        {children}
      </div>
      <BottomNav userId={user.id} initialUnreadCount={initialUnreadCount} />
    </div>
  );
}
