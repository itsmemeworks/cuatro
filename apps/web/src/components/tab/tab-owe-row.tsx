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
  /** What the money was for ("Tuesday's court split") — the design's 11px line under the who-owes-who title. Optional; the all-Circles cards omit it. */
  subtitle?: string | null;
}

/**
 * The wide Tab's row-level Nudge/Settle pill — same anatomy as the phone's
 * RowPill, sized to the desktop card (design/CUATRO-Web-LATEST.dc.html "The
 * Tab (all circles)"). `pending` shows the system pending state (the same
 * cap-height border-spinner recipe as components/ui/button.tsx's
 * PendingSpinner — Button itself can't shrink to row-pill scale) per the
 * no-silent-clicks rule (Pete, 2026-07-11).
 */
function OwePill({
  tone = "quiet",
  disabled,
  pending,
  onClick,
  children,
}: {
  tone?: "quiet" | "action";
  disabled?: boolean;
  pending?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      onClick={onClick}
      className={`shrink-0 rounded-chip px-3 py-1.5 text-[11px] font-bold whitespace-nowrap inline-flex items-center gap-1.5 transition-cu-state hover:opacity-90 active:opacity-80 disabled:opacity-40 disabled:pointer-events-none ${
        tone === "action" ? "bg-action text-action-contrast border border-transparent" : "border border-ink-hairline-3 text-ink"
      }`}
    >
      {pending ? (
        <span
          aria-hidden
          className="inline-block h-[1em] w-[1em] flex-none animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
        />
      ) : null}
      {children}
    </button>
  );
}

/**
 * One member balance row inside a Circle's card on the wide "all Circles" Tab.
 * Acts on a single tab_entries row via the SAME endpoints the phone Tab uses
 * (POST /api/tab/entries/[id]/{nudge,settle}) — no new mutation, the wide
 * layout only restates the phone's Nudge/Settle. Money is the design's
 * whole-pounds-when-clean format (formatMoneyWhole) — the Wave C sweep
 * converged the phone's TabEntryRow on the same rule. The two-step settle
 * (server/tab.ts proposeOrConfirmSettle)
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
  // Which action is in flight — the clicked pill spins, its sibling disables
  // (no silent clicks; Pete, 2026-07-11).
  const [pendingAction, setPendingAction] = useState<"nudge" | "settle" | null>(null);
  const pending = pendingAction !== null;
  const [error, setError] = useState<string | null>(null);

  const viewerIsPayer = entry.payerUserId === viewerUserId;
  const counterpartyName = viewerIsPayer ? entry.debtorName : entry.payerName;
  const amount = formatMoneyWhole(entry.amountMinor, entry.currency);

  async function post(action: "nudge" | "settle") {
    setPendingAction(action);
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
      setPendingAction(null);
    }
  }

  const viewerAlreadyProposed = entry.pendingSettleBy === viewerUserId;
  const counterpartyProposed = entry.pendingSettleBy != null && !viewerAlreadyProposed;

  return (
    <div className="flex flex-col gap-1 px-[18px] py-[13px] border-b border-ink-hairline-1 last:border-b-0">
      <div className="flex items-center gap-[11px]">
        <Avatar src={counterpartyAvatarUrl} name={counterpartyName} size="md" />
        <div className="flex-1 min-w-0">
          <p className="text-[12.5px] font-bold text-ink truncate">
            {viewerIsPayer ? `${counterpartyName} owes you` : `You owe ${counterpartyName}`}
          </p>
          {entry.subtitle && <p className="text-[11px] text-ink-muted truncate mt-0.5">{entry.subtitle}</p>}
        </div>
        <Fact size="md" weight="bold" tone={viewerIsPayer ? "win" : "loss"}>
          {amount}
        </Fact>
        {viewerIsPayer ? (
          <>
            <OwePill pending={pendingAction === "nudge"} disabled={pending || entry.status !== "open"} onClick={() => post("nudge")}>
              {entry.status === "open" ? "Nudge 👋" : "Nudged ✓"}
            </OwePill>
            {counterpartyProposed && (
              <OwePill pending={pendingAction === "settle"} disabled={pending} onClick={() => post("settle")}>
                Confirm settled
              </OwePill>
            )}
          </>
        ) : (
          <OwePill
            tone={entry.pendingSettleBy == null || counterpartyProposed ? "action" : "quiet"}
            pending={pendingAction === "settle"}
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
