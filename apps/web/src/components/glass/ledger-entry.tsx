"use client";

import { useState } from "react";
import type { LedgerEntryView } from "@/server/matches-db";

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(d);
}

/** One Ledger line — a bank-statement-style row that expands to show its factors. */
export function LedgerEntryRow({ entry }: { entry: LedgerEntryView }) {
  const [open, setOpen] = useState(false);
  const positive = entry.delta >= 0;
  const deltaColor = positive ? "var(--c4-accent)" : "var(--c4-danger)";
  const deltaLabel = `${positive ? "+" : ""}${entry.delta.toFixed(2)}`;

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--c4-border)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 p-4 text-left"
        style={{ background: "var(--c4-bg-elevated)", minHeight: "var(--c4-touch-target)" }}
      >
        <span className="text-lg font-semibold tabular-nums shrink-0" style={{ color: deltaColor }}>
          {deltaLabel}
        </span>
        <span className="flex-1 text-sm">
          {entry.explanation}
          {entry.outcome === "retired" && (
            <span style={{ color: "var(--c4-text-muted)" }}> (retired)</span>
          )}
        </span>
        <span className="text-xs shrink-0" style={{ color: "var(--c4-text-muted)" }}>
          {formatDate(entry.createdAt)}
        </span>
      </button>
      {open && (
        <dl
          className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 text-xs"
          style={{ background: "var(--c4-bg-elevated-2)", borderTop: "1px solid var(--c4-border)" }}
        >
          <dt style={{ color: "var(--c4-text-muted)" }}>Rating after</dt>
          <dd className="tabular-nums">{entry.ratingAfter.toFixed(2)}</dd>
          <dt style={{ color: "var(--c4-text-muted)" }}>Win expectancy</dt>
          <dd className="tabular-nums">{Math.round(entry.factors.expectedWin * 100)}%</dd>
          <dt style={{ color: "var(--c4-text-muted)" }}>Margin multiplier</dt>
          <dd className="tabular-nums">{entry.factors.marginMultiplier.toFixed(2)}×</dd>
          <dt style={{ color: "var(--c4-text-muted)" }}>Echo Damping</dt>
          <dd className="tabular-nums">
            {entry.factors.isFirstMeeting ? "none (first meeting)" : `${Math.round(entry.factors.echoDampingMultiplier * 100)}% weight`}
          </dd>
          <dt style={{ color: "var(--c4-text-muted)" }}>K-factor</dt>
          <dd className="tabular-nums">{entry.factors.kFactor.toFixed(2)}</dd>
          <dt style={{ color: "var(--c4-text-muted)" }}>Confidence</dt>
          <dd className="tabular-nums">
            {entry.confidenceBeforePct}% → {entry.confidenceAfterPct}%
          </dd>
        </dl>
      )}
    </div>
  );
}
