import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { BottomNav } from "@/components/bottom-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-dvh flex flex-col">
      <div className="flex-1" style={{ paddingBottom: "var(--c4-nav-height)" }}>
        {children}
      </div>
      <BottomNav />
    </div>
  );
}
