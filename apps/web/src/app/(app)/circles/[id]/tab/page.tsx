import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { getTabView } from "@/server/tab";
import { formatMoney } from "@/components/tab/money";
import { AddEntryForm } from "@/components/tab/add-entry-form";
import { TabEntryRow } from "@/components/tab/tab-entry-row";
import { LiveRefresh } from "@/components/realtime/LiveRefresh";

export default async function TabPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: circleId } = await params;
  const user = await getSessionUser();
  if (!user) return null; // the (app) layout already redirects unauthenticated users to /login

  const { db } = await getDb();
  const view = getTabView(db, circleId, user.id);
  // Not a member (or the Circle doesn't exist) — treat identically, same
  // posture as circles/[id]/page.tsx: a guessed id shouldn't confirm
  // anything to an outsider.
  if (!view) notFound();

  const netEntries = Object.entries(view.netPositionByCurrency).filter(([, minor]) => minor !== 0);
  const openEntries = view.activity.filter((e) => e.status !== "settled");
  const settledEntries = view.activity.filter((e) => e.status === "settled");
  const netStatusLabel = netEntries.length === 0 ? null : netEntries.some(([, m]) => m > 0) ? "you're owed, net" : "you owe, net";

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <LiveRefresh circleId={circleId} />
      <Link href={`/circles/${circleId}`} className="text-sm font-medium" style={{ color: "var(--c4-accent)" }}>
        ← Circle
      </Link>

      <header className="tab-header flex flex-col gap-1">
        <h1 className="text-xl font-semibold">The Tab</h1>
        {netEntries.length === 0 ? (
          <p className="tab-header__net text-2xl font-mono font-semibold">All square ✓</p>
        ) : (
          <div className="tab-header__net flex gap-3">
            {netEntries.map(([currency, minor]) => (
              <p
                key={currency}
                className="text-2xl font-mono font-semibold"
                style={{ color: minor > 0 ? "var(--c4-accent)" : "var(--c4-danger)" }}
              >
                {minor > 0 ? "+" : ""}
                {formatMoney(minor, currency)}
              </p>
            ))}
          </div>
        )}
        {netStatusLabel && (
          <p className="tab-header__status text-xs" style={{ color: "var(--c4-text-muted)" }}>
            {netStatusLabel}
          </p>
        )}
      </header>

      <AddEntryForm circleId={circleId} members={view.members} payerUserId={user.id} defaultCurrency="GBP" />

      <section className="tab-balances flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--c4-text-muted)" }}>
          Balances
        </h2>
        {openEntries.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
            All square — nobody owes anybody right now.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {openEntries.map((e) => (
              <TabEntryRow key={e.id} entry={e} viewerUserId={user.id} />
            ))}
          </div>
        )}
      </section>

      {settledEntries.length > 0 && (
        <section className="tab-activity flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--c4-text-muted)" }}>
            Activity
          </h2>
          <div className="flex flex-col gap-2">
            {settledEntries.map((e) => (
              <TabEntryRow key={e.id} entry={e} viewerUserId={user.id} />
            ))}
          </div>
        </section>
      )}

      <p className="tab-footer text-xs text-center" style={{ color: "var(--c4-text-muted)" }}>
        the Tab never charges fees — it just keeps score
      </p>
    </main>
  );
}
