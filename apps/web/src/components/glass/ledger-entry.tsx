import type { LedgerEntryView } from "@/server/matches-db";
import { Fact, InfoTerm, Meta } from "@/components/ui";
import { LedgerRow } from "@/components/glass-screens/ledger-row";
import { DEFAULT_TZ, formatDate } from "@/lib/time";

/**
 * Sign follows the RESULT, not the raw float: the engine never moves a
 * winner down nor a loser up, so the only ambiguous case is the fully
 * Echo-damped 0.00 — which must read −0.00 on a loss, never +0.00
 * (QA5 finding 1). U+2212 minus, matching result-post.tsx.
 */
function fmtDelta(delta: number, won: boolean): string {
  return `${won ? "+" : "−"}${Math.abs(delta).toFixed(2)}`;
}

/**
 * The Ledger's genesis row is the entry whose explanation opens with
 * matches-db.ts's PLACEMENT_REVEAL_EXPLANATION_PREFIX (there's no dedicated
 * flag on the entry). Shared by ledger-view.tsx and you-wide.tsx so the two
 * Ledger surfaces can't drift on what counts as the pour.
 */
export function isGenesisEntry(entry: Pick<LedgerEntryView, "explanation">): boolean {
  return entry.explanation.startsWith("Placement Trio complete");
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
  // From the match winner, never the delta sign (see LedgerEntryView.won).
  const won = entry.won;

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
          {fmtDelta(entry.delta, won)}
        </Fact>
      }
      meta={
        <>
          {/* DEFAULT_TZ (F2 §5): profile-wide surface with no session anchor. */}
          {formatDate(entry.createdAt, DEFAULT_TZ)}
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

/**
 * The Ledger's origin row — "Glass poured" (design/HANDOFF.md screen 9's
 * genesis row). One per player, ever. A pure MARKER: the trio-completing
 * match itself renders as a normal entry row directly beneath this (the
 * caller renders both — QA5 finding 2: the pour's own delta, factors and
 * damping must be explained like any other movement, or the statement can't
 * reconstruct its headline number). The number here is therefore the POURED
 * balance (ratingAfter), which is exactly what the profile header shows.
 */
export function GenesisRow({ entry, placementSize }: { entry: LedgerEntryView; placementSize: number }) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-3 border-b border-ink-hairline-1 last:border-b-0">
      <span className="text-cu-secondary font-bold text-action-strong">◆</span>
      <div className="flex-1">
        <p className="text-cu-body text-ink font-bold">Glass poured, Placement Trio complete</p>
        <Meta className="mt-0.5 block">
          {placementSize} verified games · poured at {entry.ratingAfter.toFixed(2)} · conf {entry.confidenceAfterPct}%
        </Meta>
      </div>
    </div>
  );
}
