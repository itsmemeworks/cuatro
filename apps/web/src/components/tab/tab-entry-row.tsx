"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Fact, Meta } from "@/components/ui";
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
    // Settled entries collapse to a quiet, dimmed line — design/HANDOFF.md screen 10.
    return (
      <div className="tab-entry-row tab-entry-row--settled flex items-center justify-between gap-3 rounded-button px-3 py-2.5 opacity-55">
        <span className="text-cu-body text-ink">
          {entry.debtorName} → {entry.payerName}
        </span>
        <Fact size="sm" tone="muted">All square ✓</Fact>
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
    <Card className="tab-entry-row flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-cu-body font-bold text-ink">{label}</span>
        <Fact size="md" weight="bold" className="tab-entry-row__amount">
          {formatMoney(entry.amountMinor, entry.currency)}
        </Fact>
      </div>

      {error && (
        <Meta as="p" className="tab-entry-row__error" tone="loss">
          {error}
        </Meta>
      )}

      <div className="flex gap-2">
        {viewerIsPayer && entry.status === "open" && (
          <Button
            type="button"
            variant="quiet"
            disabled={pending}
            onClick={() => post("nudge")}
            className="tab-entry-row__nudge"
          >
            Nudge
          </Button>
        )}
        {entry.status === "nudged" && (
          <Meta as="span" className="tab-entry-row__nudged-tag self-center">
            Nudged
          </Meta>
        )}
        {(viewerIsPayer || viewerIsDebtor) && (
          <Button
            type="button"
            variant="primary"
            size="lg"
            disabled={pending || viewerAlreadyProposed}
            onClick={() => post("settle")}
            className="tab-entry-row__settle"
          >
            {awaitingCounterparty ? (viewerAlreadyProposed ? "Waiting for confirm" : "Confirm settled") : "Settle"}
          </Button>
        )}
      </div>
    </Card>
  );
}
