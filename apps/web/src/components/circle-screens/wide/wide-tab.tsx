import Link from "next/link";
import type { TabEntryView } from "@/server/tab";
import { formatMoney } from "@/components/tab/money";
import { AddEntrySheet } from "@/components/tab/add-entry-sheet";
import type { AddEntryFormMember } from "@/components/tab/add-entry-form";
import { TabEntryRow, AllSquareRow } from "@/components/tab/tab-entry-row";
import { WidePage } from "./wide-shell";

function activityDateLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric" }).format(d);
}

/** One compact mono line of the circle-wide activity feed (design's right column). */
function ActivityLine({ entry, viewerUserId }: { entry: TabEntryView; viewerUserId: string }) {
  if (entry.status === "settled") {
    const text =
      entry.payerUserId === viewerUserId
        ? `${activityDateLabel(entry.createdAt)} · you settled ${entry.debtorName}`
        : entry.debtorUserId === viewerUserId
          ? `${activityDateLabel(entry.createdAt)} · you settled up`
          : `${activityDateLabel(entry.createdAt)} · ${entry.debtorName} settled up`;
    return (
      <div className="flex justify-between py-[11px] font-mono text-[11px] text-ink-muted">
        <span>{text}</span>
        <span className="text-win">✓</span>
      </div>
    );
  }
  return (
    <div className="flex justify-between py-[11px] font-mono text-[11px] text-ink-muted">
      <span>
        {activityDateLabel(entry.createdAt)} · {entry.descriptionLabel ?? "court split"}
      </span>
      <span>{formatMoney(entry.amountMinor, entry.currency)} each</span>
    </div>
  );
}

/**
 * Wide Circle Tab (design "Desktop · Circle tab"): a two-column, circle-scoped
 * ledger — balances (reusing the phone TabEntryRow so nudge + the settle
 * handshake keep working) beside the nudge note and the mono activity feed.
 * Money rules unchanged: whole pounds, no pence; currencies never net.
 */
export function WideTab({
  circleId,
  circleName,
  viewerUserId,
  members,
  netEntries,
  netStatusLabel,
  activeRows,
  allSquare,
  avatarByUserId,
  activity,
}: {
  circleId: string;
  circleName: string;
  viewerUserId: string;
  members: AddEntryFormMember[];
  netEntries: [string, number][];
  netStatusLabel: string | null;
  activeRows: TabEntryView[];
  allSquare: { userId: string; name: string }[];
  avatarByUserId: Map<string, string | null | undefined>;
  activity: TabEntryView[];
}) {
  return (
    <WidePage>
      <div className="flex items-end gap-3.5">
        <div className="flex-1 min-w-0">
          <h1 className="font-sans font-extrabold text-[24px] leading-none text-ink">The Tab</h1>
          <p className="font-sans text-[12px] text-ink-muted mt-1.5">
            {circleName} only ·{" "}
            <Link href="/tab" className="text-action-strong font-bold">
              all Circles →
            </Link>
          </p>
        </div>
        <AddEntrySheet circleId={circleId} members={members} payerUserId={viewerUserId} defaultCurrency="GBP" />
        <div className="text-right">
          {netEntries.length === 0 ? (
            <div className="font-mono font-extrabold text-[22px] text-ink">All square ✓</div>
          ) : (
            <>
              {netEntries.map(([currency, minor]) => (
                <div key={currency} className={`font-mono font-extrabold text-[26px] leading-none ${minor > 0 ? "text-win" : "text-loss"}`}>
                  {minor > 0 ? "+" : ""}
                  {formatMoney(minor, currency)}
                </div>
              ))}
              {netStatusLabel && <div className="font-mono text-[10px] text-ink-muted mt-[3px]">{netStatusLabel}</div>}
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[1.2fr_1fr] gap-4 mt-[18px] items-start">
        <div className="bg-surface border border-ink-hairline-1 rounded-[20px] overflow-hidden divide-y divide-ink-hairline-1">
          {activeRows.length === 0 && allSquare.length === 0 ? (
            <p className="px-[18px] py-4 font-sans text-[13px] text-ink-muted">
              All square. Nobody owes anybody, and the friendship survives another booking.
            </p>
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
                  viewerUserId={viewerUserId}
                  counterpartyAvatarUrl={avatarByUserId.get(e.payerUserId === viewerUserId ? e.debtorUserId : e.payerUserId)}
                />
              ))}
              {allSquare.map((c) => (
                <AllSquareRow key={c.userId} name={c.name} avatarUrl={avatarByUserId.get(c.userId)} />
              ))}
            </>
          )}
        </div>

        <div>
          <div className="bg-streak-tint rounded-[14px] px-4 py-3.5 font-sans text-[12.5px] leading-relaxed text-ink">
            Nudges are one tap, once: <em>&ldquo;Oi. £8 for Tuesday&apos;s court 🎾&rdquo;</em>. No interest, no drama, no red exclamation marks.
          </div>
          {activity.length > 0 && (
            <div className="mt-3 bg-surface border border-ink-hairline-1 rounded-[16px] px-4 divide-y divide-ink-hairline-1">
              {activity.map((e) => (
                <ActivityLine key={e.id} entry={e} viewerUserId={viewerUserId} />
              ))}
            </div>
          )}
          <div className="mt-3 text-center font-mono text-[10px] text-ink-muted">the Tab never charges fees. It just keeps score</div>
        </div>
      </div>
    </WidePage>
  );
}
