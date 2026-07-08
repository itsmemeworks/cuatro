"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "./money";

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
}

/** One row of the Tab's balance/activity list — a single tab_entries row, not an aggregated pair balance (see @/server/tab's TabView doc comment). Nudge and Settle act on this entry only. */
export function TabEntryRow({ entry, viewerUserId }: { entry: TabEntryRowData; viewerUserId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const viewerIsPayer = entry.payerUserId === viewerUserId;
  const viewerIsDebtor = entry.debtorUserId === viewerUserId;

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

  if (entry.status === "settled") {
    return (
      <div
        className="tab-entry-row tab-entry-row--settled flex items-center justify-between gap-3 rounded-xl p-3"
        style={{ opacity: 0.6 }}
      >
        <span className="text-sm">
          {entry.debtorName} → {entry.payerName}
        </span>
        <span className="text-sm font-mono" style={{ color: "var(--c4-text-muted)" }}>
          All square ✓
        </span>
      </div>
    );
  }

  const label = viewerIsPayer
    ? `${entry.debtorName} owes you`
    : viewerIsDebtor
      ? `You owe ${entry.payerName}`
      : `${entry.debtorName} owes ${entry.payerName}`;

  const awaitingCounterparty = entry.pendingSettleBy != null;
  const viewerAlreadyProposed = entry.pendingSettleBy === viewerUserId;

  return (
    <div
      className="tab-entry-row flex flex-col gap-2 rounded-xl p-3"
      style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">{label}</span>
        <span className="tab-entry-row__amount font-mono text-sm font-semibold">
          {formatMoney(entry.amountMinor, entry.currency)}
        </span>
      </div>

      {error && (
        <p className="tab-entry-row__error text-xs" style={{ color: "var(--c4-danger)" }}>
          {error}
        </p>
      )}

      <div className="flex gap-2">
        {viewerIsPayer && entry.status === "open" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => post("nudge")}
            className="tab-entry-row__nudge rounded-lg px-3 py-2 text-xs font-semibold"
            style={{ background: "transparent", border: "1px solid var(--c4-border)", color: "var(--c4-text)" }}
          >
            Nudge
          </button>
        )}
        {entry.status === "nudged" && (
          <span className="tab-entry-row__nudged-tag text-xs self-center" style={{ color: "var(--c4-text-muted)" }}>
            Nudged
          </span>
        )}
        {(viewerIsPayer || viewerIsDebtor) && (
          <button
            type="button"
            disabled={pending || viewerAlreadyProposed}
            onClick={() => post("settle")}
            className="tab-entry-row__settle rounded-lg px-3 py-2 text-xs font-semibold"
            style={{
              background: "var(--c4-accent)",
              color: "var(--c4-accent-contrast)",
              opacity: pending || viewerAlreadyProposed ? 0.6 : 1,
            }}
          >
            {awaitingCounterparty ? (viewerAlreadyProposed ? "Waiting for confirm" : "Confirm settled") : "Settle"}
          </button>
        )}
      </div>
    </div>
  );
}
