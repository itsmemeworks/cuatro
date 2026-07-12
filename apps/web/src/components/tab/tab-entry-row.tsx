"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Chip, Fact, Meta } from "@/components/ui";
import { errorCopy } from "@/lib/error-copy";
import { formatMoneyWhole } from "./money";

export interface TabEntryRowData {
  id: string;
  payerUserId: string;
  payerName: string;
  debtorUserId: string;
  debtorName: string;
  amountMinor: number;
  currency: string;
  status: "open" | "nudged" | "settled";
  pendingSettleBy: string | null;
  /** What the money was for, when known — e.g. "court split · Tue 8 Jul" from the linked session's date (server/session-tab.ts). Null for a manually-added entry. */
  subtitle?: string | null;
}

/**
 * Compact pill for Nudge/Settle — smaller and rounder than the standard
 * Button (design/HANDOFF.md's "the Tab" row anatomy: buttons sit inline in
 * the row, not stacked below it). `pending` shows the system pending state
 * (the same cap-height border-spinner recipe as components/ui/button.tsx's
 * PendingSpinner — Button itself can't shrink to row-pill scale) per the
 * no-silent-clicks rule (Pete, 2026-07-11).
 */
function RowPill({
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
      className={`shrink-0 rounded-chip px-3.5 py-2 text-[11px] font-bold whitespace-nowrap inline-flex items-center gap-1.5 transition-cu-state hover:opacity-90 active:opacity-80 disabled:opacity-40 disabled:pointer-events-none ${
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
 * One balance row (design/CUATRO-Prototype-LATEST.dc.html's "The Tab" screen):
 * avatar + who-owes-what + mono amount + Nudge/Settle in a single row. Acts
 * on one tab_entries row, not an aggregated pair balance (see
 * @/server/tab's TabView doc comment) — the page groups entries by
 * counterparty and only falls back to this per-entry row while there's an
 * unsettled entry to act on.
 */
export function TabEntryRow({
  entry,
  viewerUserId,
  counterpartyAvatarUrl,
}: {
  entry: TabEntryRowData;
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

  // "Settle" is the debtor's action (they're the one paying); the payer
  // (creditor) only ever gets Nudge plus a "Confirm settled" pill once the
  // debtor has proposed — proposeOrConfirmSettle's two-step flow (see
  // server/tab.ts) means `pendingSettleBy` set to anyone other than the
  // viewer is, in this UI, always the debtor (the payer has no button here
  // that calls propose in the first place).
  const viewerAlreadyProposed = entry.pendingSettleBy === viewerUserId;
  const counterpartyProposed = entry.pendingSettleBy != null && !viewerAlreadyProposed;

  return (
    <div className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-center gap-2.5">
        <Avatar src={counterpartyAvatarUrl} name={counterpartyName} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-cu-body font-bold text-ink truncate">
            {viewerIsPayer ? `${counterpartyName} owes you` : `You owe ${counterpartyName}`}
          </p>
          {entry.subtitle && <p className="text-cu-secondary text-ink-muted mt-0.5">{entry.subtitle}</p>}
        </div>
        <Fact size="md" weight="bold" tone={viewerIsPayer ? "win" : "loss"}>
          {formatMoneyWhole(entry.amountMinor, entry.currency)}
        </Fact>
        {viewerIsPayer ? (
          <>
            <RowPill pending={pendingAction === "nudge"} disabled={pending || entry.status !== "open"} onClick={() => post("nudge")}>
              {entry.status === "open" ? "Nudge 👋" : "Nudged ✓"}
            </RowPill>
            {counterpartyProposed && (
              <RowPill pending={pendingAction === "settle"} disabled={pending} onClick={() => post("settle")}>
                Confirm settled
              </RowPill>
            )}
          </>
        ) : (
          <RowPill
            tone={entry.pendingSettleBy == null || counterpartyProposed ? "action" : "quiet"}
            pending={pendingAction === "settle"}
            disabled={pending || viewerAlreadyProposed}
            onClick={() => post("settle")}
          >
            {/* "Settle £X" — the wide Tab's term for the same action (QA6: the
                phone said "Mark as paid", reading as two different mechanics
                to anyone switching devices mid-week). */}
            {entry.pendingSettleBy == null
              ? `Settle ${formatMoneyWhole(entry.amountMinor, entry.currency)}`
              : viewerAlreadyProposed
                ? "Waiting…"
                : "Confirm ✓"}
          </RowPill>
        )}
      </div>
      {/* Narrate the two-step settle so neither side reads "Waiting…"/"Confirm"
          as a silent no-op, and state once that CUATRO never moves the money. */}
      {!viewerIsPayer && entry.pendingSettleBy == null && (
        <Meta as="p" className="mt-0.5">
          Pay {counterpartyName} however you normally do. CUATRO never touches the money.
        </Meta>
      )}
      {!viewerIsPayer && viewerAlreadyProposed && (
        <Meta as="p" className="mt-0.5">
          We&apos;ll mark it settled once {counterpartyName} confirms.
        </Meta>
      )}
      {viewerIsPayer && counterpartyProposed && (
        <Meta as="p" className="mt-0.5">
          {counterpartyName} says they&apos;ve paid you back. Confirm to settle it.
        </Meta>
      )}
      {error && (
        <Meta as="p" tone="loss" className="mt-0.5">
          {errorCopy(error)}
        </Meta>
      )}
    </div>
  );
}

/** A counterparty with nothing currently owed either way — every entry between them and the viewer is settled. Design/HANDOFF.md: "settled rows collapse to 'All square ✓'." */
export function AllSquareRow({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-3">
      <Avatar src={avatarUrl} name={name} size="sm" />
      <p className="flex-1 text-cu-body font-bold text-ink-muted truncate">{name}</p>
      <Chip tone="positive">All square ✓</Chip>
    </div>
  );
}
