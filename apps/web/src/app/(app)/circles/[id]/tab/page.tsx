import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { getTabView } from "@/server/tab";
import { formatMoney } from "@/components/tab/money";
import { AddEntryForm } from "@/components/tab/add-entry-form";
import { TabEntryRow } from "@/components/tab/tab-entry-row";
import { LedgerRow } from "@/components/glass-screens/ledger-row";
import { LiveRefresh } from "@/components/realtime/LiveRefresh";
import { Card, Fact, Meta } from "@/components/ui";

function activityHeadline(
  e: { payerUserId: string; payerName: string; debtorUserId: string; debtorName: string; status: "open" | "nudged" | "settled" },
  viewerUserId: string,
): string {
  if (e.status === "settled") {
    if (e.payerUserId === viewerUserId) return `you settled ${e.debtorName}`;
    if (e.debtorUserId === viewerUserId) return `${e.payerName} settled you`;
    return `${e.debtorName} settled ${e.payerName}`;
  }
  return `${e.debtorName} owes ${e.payerName}`;
}

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
    <main className="px-4 pt-6 pb-6 flex flex-col gap-5">
      <LiveRefresh circleId={circleId} />
      <Link href={`/circles/${circleId}`} className="text-cu-secondary font-bold text-action">
        ‹ Circle
      </Link>

      <header className="tab-header flex flex-col gap-1">
        <h1 className="text-cu-title text-ink">The Tab</h1>
        {netEntries.length === 0 ? (
          <p className="tab-header__net text-cu-title font-mono tabular-nums text-ink">All square ✓</p>
        ) : (
          <div className="tab-header__net flex gap-3">
            {netEntries.map(([currency, minor]) => (
              <span
                key={currency}
                className={`font-mono tabular-nums font-extrabold text-2xl ${minor > 0 ? "text-win" : "text-loss"}`}
              >
                {minor > 0 ? "+" : ""}
                {formatMoney(minor, currency)}
              </span>
            ))}
          </div>
        )}
        {netStatusLabel && <Meta className="tab-header__status">{netStatusLabel}</Meta>}
      </header>

      <AddEntryForm circleId={circleId} members={view.members} payerUserId={user.id} defaultCurrency="GBP" />

      <section className="tab-balances flex flex-col gap-2">
        <p className="text-cu-secondary font-extrabold tracking-[0.12em] text-ink-muted">BALANCES</p>
        {openEntries.length === 0 ? (
          <Meta>All square — nobody owes anybody right now.</Meta>
        ) : (
          <div className="flex flex-col gap-2">
            {openEntries.map((e) => (
              <TabEntryRow key={e.id} entry={e} viewerUserId={user.id} />
            ))}
          </div>
        )}
      </section>

      <div className="rounded-button bg-streak-tint p-3">
        <p className="text-cu-body text-ink">
          Nudges are one tap, once: <em>&ldquo;Oi. £8 for Tuesday&apos;s court 🎾&rdquo;</em> — no interest, no drama, no red exclamation
          marks.
        </p>
      </div>

      {view.activity.length > 0 && (
        <section className="tab-activity">
          <p className="text-cu-secondary font-extrabold tracking-[0.12em] text-ink-muted mb-2">ACTIVITY</p>
          <Card padded={false} className="overflow-hidden">
            {[...openEntries, ...settledEntries]
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
              .map((e) => (
                <LedgerRow
                  key={e.id}
                  quiet={e.status === "settled"}
                  headline={activityHeadline(e, user.id)}
                  meta={new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(e.createdAt)}
                  value={
                    <Fact size="sm" weight="semibold" tone={e.status === "settled" ? "win" : "neutral"}>
                      {e.status === "settled" ? `${formatMoney(e.amountMinor, e.currency)} ✓` : formatMoney(e.amountMinor, e.currency)}
                    </Fact>
                  }
                />
              ))}
          </Card>
        </section>
      )}

      <p className="tab-footer text-cu-meta text-ink-muted text-center">the Tab never charges fees — it just keeps score</p>
    </main>
  );
}
