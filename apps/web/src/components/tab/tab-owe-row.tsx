"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Fact, Meta } from "@/components/ui";
import { errorCopy } from "@/lib/error-copy";
import { formatMoneyWhole } from "./money";

export interface TabOweRowData {
  id: string;
  payerUserId: string;
  payerName: string;
  debtorUserId: string;
  debtorName: string;
  amountMinor: number;
  currency: string;
  status: "open" | "nudged" | "settled";
  pendingSettleBy: string | null;
}

/** The wide Tab's row-level Nudge/Settle pill — same anatomy as the phone's RowPill, sized to the desktop card (design/CUATRO-Web-LATEST.dc.html "The Tab (all circles)"). */
function OwePill({
  tone = "quiet",
  disabled,
  onClick,
  children,
}: {
  tone?: "quiet" | "action";
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`shrink-0 rounded-chip px-3 py-1.5 text-[11px] font-bold whitespace-nowrap transition-cu-state active:opacity-80 disabled:opacity-40 disabled:pointer-events-none ${
        tone === "action" ? "bg-action text-action-contrast border border-transparent" : "border border-ink-hairline-3 text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * One member balance row inside a Circle's card on the wide "all Circles" Tab.
 * Acts on a single tab_entries row via the SAME endpoints the phone Tab uses
 * (POST /api/tab/entries/[id]/{nudge,settle}) — no new mutation, the wide
 * layout only restates the phone's Nudge/Settle. Money is the web design's
 * whole-pound format (formatMoneyWhole), the phone's per-pence TabEntryRow is
 * left untouched. The two-step settle (server/tab.ts proposeOrConfirmSettle)
 * is narrated the same way: debtor proposes ("Mark as paid"), payer confirms.
 */
export function TabOweRow({
  entry,
  viewerUserId,
  counterpartyAvatarUrl,
}: {
  entry: TabOweRowData;
  viewerUserId: string;
  counterpartyAvatarUrl?: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const viewerIsPayer = entry.payerUserId === viewerUserId;
  const counterpartyName = viewerIsPayer ? entry.debtorName : entry.payerName;
  const amount = formatMoneyWhole(entry.amountMinor, entry.currency);

  async function post(action: "nudge" | "settle") {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/tab/entries/${entry.id}/${action}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error ?? "something_went_wrong");
        return;
      }
      router.refresh();
    } catch {
      setError("network_error");
    } finally {
      setPending(false);
    }
  }

  const viewerAlreadyProposed = entry.pendingSettleBy === viewerUserId;
  const counterpartyProposed = entry.pendingSettleBy != null && !viewerAlreadyProposed;

  return (
    <div className="flex flex-col gap-1 px-[18px] py-[13px] border-b border-ink-hairline-1 last:border-b-0">
      <div className="flex items-center gap-[11px]">
        <Avatar src={counterpartyAvatarUrl} name={counterpartyName} size="md" />
        <p className="flex-1 min-w-0 text-[12.5px] font-bold text-ink truncate">
          {viewerIsPayer ? `${counterpartyName} owes you` : `You owe ${counterpartyName}`}
        </p>
        <Fact size="md" weight="bold" tone={viewerIsPayer ? "win" : "loss"}>
          {amount}
        </Fact>
        {viewerIsPayer ? (
          <>
            <OwePill disabled={pending || entry.status !== "open"} onClick={() => post("nudge")}>
              {entry.status === "open" ? "Nudge 👋" : "Nudged ✓"}
            </OwePill>
            {counterpartyProposed && (
              <OwePill disabled={pending} onClick={() => post("settle")}>
                Confirm settled
              </OwePill>
            )}
          </>
        ) : (
          <OwePill
            tone={entry.pendingSettleBy == null || counterpartyProposed ? "action" : "quiet"}
            disabled={pending || viewerAlreadyProposed}
            onClick={() => post("settle")}
          >
            {entry.pendingSettleBy == null ? `Settle ${amount}` : viewerAlreadyProposed ? "Waiting…" : "Confirm ✓"}
          </OwePill>
        )}
      </div>
      {!viewerIsPayer && entry.pendingSettleBy == null && (
        <Meta as="p">Pay {counterpartyName} however you normally do. CUATRO never touches the money.</Meta>
      )}
      {!viewerIsPayer && viewerAlreadyProposed && <Meta as="p">We&apos;ll mark it settled once {counterpartyName} confirms.</Meta>}
      {viewerIsPayer && counterpartyProposed && <Meta as="p">{counterpartyName} says they&apos;ve paid you back. Confirm to settle it.</Meta>}
      {error && (
        <Meta as="p" tone="loss">
          {errorCopy(error)}
        </Meta>
      )}
    </div>
  );
}
