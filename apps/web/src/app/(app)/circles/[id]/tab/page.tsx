import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { getTabView, type TabEntryView } from "@/server/tab";
import { getCirclesStore } from "@/server/circles";
import { formatMoney } from "@/components/tab/money";
import { AddEntrySheet } from "@/components/tab/add-entry-sheet";
import { TabEntryRow, AllSquareRow } from "@/components/tab/tab-entry-row";
import { LiveRefresh } from "@/components/realtime/LiveRefresh";
import { CircleSwitcher } from "@/components/circles/circle-switcher";
import { Card, Meta } from "@/components/ui";
import { WideTab } from "@/components/circle-screens/wide/wide-tab";

function activityDateLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric" }).format(d);
}

/** One line of the mono activity feed (design/DESIGN-AUDIT.md T4) — every entry across the whole Circle, not just the viewer's own pairs (that filter is for the BALANCES section above, not this one). */
function ActivityRow({ entry, viewerUserId }: { entry: TabEntryView; viewerUserId: string }) {
  const dateLabel = activityDateLabel(entry.createdAt);

  if (entry.status === "settled") {
    const text =
      entry.payerUserId === viewerUserId
        ? `you settled ${entry.debtorName}`
        : entry.debtorUserId === viewerUserId
          ? "you settled up"
          : `${entry.debtorName} settled up`;
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 font-mono tabular-nums text-[11px] text-ink-muted">
        <span>
          {dateLabel} · {text}
        </span>
        <span className="text-win">{entry.payerUserId === viewerUserId ? `${formatMoney(entry.amountMinor, entry.currency)} ✓` : "✓"}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 font-mono tabular-nums text-[11px] text-ink-muted">
      <span>{dateLabel} · {entry.descriptionLabel ?? "court split"}</span>
      <span>{formatMoney(entry.amountMinor, entry.currency)} each</span>
    </div>
  );
}

export default async function TabPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: circleId } = await params;
  const user = await getSessionUser();
  if (!user) return null; // the (app) layout already redirects unauthenticated users to /login

  const { db } = await getDb();
  const view = await getTabView(db, circleId, user.id);
  // Not a member (or the Circle doesn't exist) — treat identically, same
  // posture as circles/[id]/page.tsx: a guessed id shouldn't confirm
  // anything to an outsider.
  if (!view) notFound();

  const store = await getCirclesStore();
  const [allCircles, detail] = await Promise.all([
    store.listCirclesForUser(user.id),
    store.getCircleDetail(circleId, user.id), // for the circle name + member avatars the Tab's rows need but TabView doesn't carry
  ]);
  const avatarByUserId = new Map((detail?.members ?? []).map((m) => [m.userId, m.avatarUrl]));

  const netEntries = Object.entries(view.netPositionByCurrency).filter(([, minor]) => minor !== 0);
  const netStatusLabel = netEntries.length === 0 ? null : netEntries.some(([, m]) => m > 0) ? "you're owed, overall" : "you're down, overall";

  // Only pairs involving the viewer (design/DESIGN-AUDIT.md T2) — grouped by
  // counterparty so a pair with nothing currently open collapses to one
  // "All square" row instead of one per historical (already-settled) entry.
  const viewerEntries = view.activity.filter((e) => e.payerUserId === user.id || e.debtorUserId === user.id);
  const byCounterparty = new Map<string, TabEntryView[]>();
  for (const e of viewerEntries) {
    const counterpartyId = e.payerUserId === user.id ? e.debtorUserId : e.payerUserId;
    const list = byCounterparty.get(counterpartyId);
    if (list) list.push(e);
    else byCounterparty.set(counterpartyId, [e]);
  }

  const activeRows: TabEntryView[] = [];
  const allSquare: { userId: string; name: string }[] = [];
  for (const [counterpartyId, entries] of byCounterparty) {
    const active = entries.filter((e) => e.status !== "settled");
    if (active.length > 0) {
      activeRows.push(...active);
    } else {
      const sample = entries[0]!;
      allSquare.push({ userId: counterpartyId, name: sample.payerUserId === counterpartyId ? sample.payerName : sample.debtorName });
    }
  }
  activeRows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const phoneTree = (
    <main className="px-4 pt-6 pb-6 flex flex-col gap-4">
      <LiveRefresh circleId={circleId} />
      <Link href={`/circles/${circleId}`} className="text-cu-secondary font-bold text-action">
        ‹ Circle
      </Link>

      <CircleSwitcher circles={allCircles} activeCircleId={circleId} suffix="/tab" />

      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-cu-title text-ink">The Tab</h1>
          {detail?.name && <Meta as="p" className="mt-1">{detail.name}</Meta>}
        </div>
        <div className="text-right">
          {netEntries.length === 0 ? (
            <p className="font-mono tabular-nums font-extrabold text-[22px] text-ink">All square ✓</p>
          ) : (
            <>
              {netEntries.map(([currency, minor]) => (
                <p key={currency} className={`font-mono tabular-nums font-extrabold text-[22px] leading-none ${minor > 0 ? "text-win" : "text-loss"}`}>
                  {minor > 0 ? "+" : ""}
                  {formatMoney(minor, currency)}
                </p>
              ))}
              {netStatusLabel && <Meta as="p" className="mt-1">{netStatusLabel}</Meta>}
            </>
          )}
        </div>
      </header>

      <AddEntrySheet circleId={circleId} members={view.members} payerUserId={user.id} defaultCurrency="GBP" />

      <Card padded={false} className="overflow-hidden divide-y divide-ink-hairline-1">
        {activeRows.length === 0 && allSquare.length === 0 ? (
          <p className="text-cu-body text-ink-muted px-4 py-3">All square. Nobody owes anybody, and the friendship survives another booking.</p>
        ) : (
          <>
            {activeRows.map((e) => (
              <TabEntryRow
                key={e.id}
                entry={{
                  id: e.id,
                  payerUserId: e.payerUserId,
                  payerName: e.payerName,
                  debtorUserId: e.debtorUserId,
                  debtorName: e.debtorName,
                  amountMinor: e.amountMinor,
                  currency: e.currency,
                  status: e.status,
                  pendingSettleBy: e.pendingSettleBy,
                  subtitle: e.descriptionLabel,
                }}
                viewerUserId={user.id}
                counterpartyAvatarUrl={avatarByUserId.get(e.payerUserId === user.id ? e.debtorUserId : e.payerUserId)}
              />
            ))}
            {allSquare.map((c) => (
              <AllSquareRow key={c.userId} name={c.name} avatarUrl={avatarByUserId.get(c.userId)} />
            ))}
          </>
        )}
      </Card>

      <div className="rounded-button bg-streak-tint p-3">
        <p className="text-cu-body text-ink">
          Nudges are one tap, once: <em>&ldquo;Oi. £8 for Tuesday&apos;s court 🎾&rdquo;</em>. No interest, no drama, no red exclamation
          marks.
        </p>
      </div>

      {view.activity.length > 0 && (
        <Card padded={false} className="overflow-hidden divide-y divide-ink-hairline-1">
          {view.activity.map((e) => (
            <ActivityRow key={e.id} entry={e} viewerUserId={user.id} />
          ))}
        </Card>
      )}

      <p className="text-cu-meta text-ink-muted text-center">the Tab just keeps score, money moves in your own bank app, never through CUATRO. No chasing, no spreadsheets</p>
    </main>
  );

  // Games/Tab aren't CircleTabs tabs — CSS-sibling split. The wide Tab is static
  // (TabEntryRow/AddEntrySheet act on user input, not mount), and LiveRefresh
  // lives only in the phone tree, so no effectful component is duplicated.
  return (
    <>
      <div className="min-[900px]:hidden">{phoneTree}</div>
      <div className="hidden min-[900px]:block">
        <WideTab
          circleId={circleId}
          circleName={detail?.name ?? ""}
          viewerUserId={user.id}
          members={view.members}
          netEntries={netEntries}
          netStatusLabel={netStatusLabel}
          activeRows={activeRows}
          allSquare={allSquare}
          avatarByUserId={avatarByUserId}
          activity={view.activity}
        />
      </div>
    </>
  );
}
