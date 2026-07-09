import type { LedgerEntryView } from "@/server/matches-db";
import { Fact, InfoTerm, Meta } from "@/components/ui";
import { LedgerRow } from "@/components/glass-screens/ledger-row";

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(d);
}

function fmtDelta(delta: number): string {
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;
}

/** One Ledger line — a bank-statement-style row (design/HANDOFF.md screen 9): result + opponents, the delta, the plain-language why, the running balance; expands to the factors that produced it. */
export function LedgerEntryRow({
  entry,
  opponentNames,
  score,
  venueName,
}: {
  entry: LedgerEntryView;
  opponentNames: string | null;
  score: string | null;
  venueName?: string | null;
}) {
  const won = entry.delta >= 0;

  return (
    <LedgerRow
      headline={
        <>
          {won ? "W" : "L"} {score ?? "—"}
          {opponentNames && <span className="font-normal text-ink-muted"> vs {opponentNames}</span>}
        </>
      }
      value={
        <Fact size="md" weight="bold" tone={won ? "win" : "loss"}>
          {fmtDelta(entry.delta)}
        </Fact>
      }
      meta={
        <>
          {formatDate(entry.createdAt)}
          {venueName && ` · ${venueName}`}
          {entry.outcome === "retired" && " · retired"}
        </>
      }
      why={entry.explanation}
      balance={{ label: "balance", value: entry.ratingAfter.toFixed(2) }}
      details={
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1">
          <dt className="text-cu-meta text-ink-muted"><InfoTerm term="winExpectancy" label="Win expectancy" /></dt>
          <dd className="text-right"><Fact size="sm">{Math.round(entry.factors.expectedWin * 100)}%</Fact></dd>
          <dt className="text-cu-meta text-ink-muted"><InfoTerm term="marginWeight" label="Margin weight" /></dt>
          <dd className="text-right"><Fact size="sm">×{entry.factors.marginMultiplier.toFixed(2)}</Fact></dd>
          <dt className="text-cu-meta text-ink-muted"><InfoTerm term="echoDamping" label="Echo Damping" /></dt>
          <dd className="text-right">
            <Fact size="sm">
              {entry.factors.isFirstMeeting ? "none (first meeting)" : `${Math.round(entry.factors.echoDampingMultiplier * 100)}% weight`}
            </Fact>
          </dd>
          <dt className="text-cu-meta text-ink-muted"><InfoTerm term="ratingStep" label="Rating step" /></dt>
          <dd className="text-right"><Fact size="sm">{entry.factors.kFactor.toFixed(2)}</Fact></dd>
          <dt className="text-cu-meta text-ink-muted">Confidence</dt>
          <dd className="text-right">
            <Fact size="sm">{entry.confidenceBeforePct}% → {entry.confidenceAfterPct}%</Fact>
          </dd>
        </dl>
      }
    />
  );
}

/** The Ledger's origin row — "Glass poured" (design/HANDOFF.md screen 9's genesis row). One per player, ever. */
export function GenesisRow({ entry, placementSize }: { entry: LedgerEntryView; placementSize: number }) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-3 border-b border-ink-hairline-1 last:border-b-0">
      <span className="text-cu-secondary font-bold text-action-strong">◆</span>
      <div className="flex-1">
        <p className="text-cu-body text-ink font-bold">Glass poured — Placement Trio complete</p>
        <Meta className="mt-0.5 block">
          {placementSize} verified games · opening balance {entry.ratingBefore != null ? entry.ratingBefore.toFixed(2) : "—"} · conf{" "}
          {entry.confidenceBeforePct}%
        </Meta>
      </div>
    </div>
  );
}
