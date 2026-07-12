import { Fragment } from "react";
import Link from "next/link";
import { PLACEMENT_TRIO_SIZE } from "@cuatro/glass";
import { GenesisRow, LedgerEntryRow, isGenesisEntry } from "@/components/glass/ledger-entry";
import { Card, Fact, InfoTerm } from "@/components/ui";
import { DEFAULT_TZ, formatMonthYear } from "@/lib/time";
import type { ProfileGlassView } from "@/server/matches-db";
import type { LedgerEnrichedRow } from "@/server/players";

/**
 * The Ledger screen body, shared by the viewer's own Ledger (`/profile/ledger`)
 * and any player's public Ledger (`/players/[userId]/ledger`). Radical
 * transparency by design (repo CLAUDE.md §6, Pete's explicit call): every
 * movement of a Glass rating is explained, append-only, for everyone — not
 * just yourself. Month grouping and rendering are identical; only the back
 * link, heading, and empty-state copy are parameterised.
 */

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
}

/** DEFAULT_TZ (F2 §5): profile-wide surface, no session anchor. */
function monthLabel(d: Date): string {
  return formatMonthYear(d, DEFAULT_TZ).toUpperCase();
}

export function LedgerView({
  glass,
  rows,
  backHref,
  backLabel,
  subtitle,
  emptyCopy,
}: {
  glass: ProfileGlassView | null;
  rows: LedgerEnrichedRow[];
  backHref: string;
  backLabel: string;
  subtitle: string;
  emptyCopy: string;
}) {
  const groups: { label: string; rows: LedgerEnrichedRow[] }[] = [];
  for (const row of rows) {
    const key = monthKey(row.entry.createdAt);
    const label = monthLabel(row.entry.createdAt);
    const last = groups.at(-1);
    if (last && monthKey(last.rows[0]!.entry.createdAt) === key) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }

  return (
    <main className="px-4 pt-6 pb-6 flex flex-col gap-4">
      <Link href={backHref} className="text-cu-secondary font-bold text-action">
        ‹ {backLabel}
      </Link>

      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-cu-title text-ink">The Ledger</h1>
          <p className="text-cu-secondary text-ink-muted mt-1">{subtitle}</p>
        </div>
        {glass?.status === "rated" && (
          <div className="text-right">
            <p className="text-cu-title text-ink">{glass.rating!.toFixed(2)}</p>
            <Fact size="meta" tone="muted">
              <InfoTerm term="confidence" label="conf" /> {glass.confidencePct}%
            </Fact>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <Card>
          <p className="text-cu-body text-ink-muted">{emptyCopy}</p>
        </Card>
      ) : (
        <>
          {groups.map((group) => (
            <Card key={group.label} padded={false} className="overflow-hidden">
              <div className="px-4 py-2.5 bg-ink-hairline-1">
                <p className="text-cu-secondary font-extrabold tracking-[0.14em] text-ink-muted">{group.label}</p>
              </div>
              {group.rows.map(({ entry, opponentNames, score, venueName }) =>
                isGenesisEntry(entry) ? (
                  // The trio-completing match is BOTH the pour marker AND a
                  // real match whose delta/factors/damping must be explained
                  // like any other movement (QA5 finding 2). Newest-first
                  // puts the "Glass poured" line directly above the entry
                  // row that poured it, so the statement reconciles top to
                  // bottom: poured balance = that row's running balance.
                  <Fragment key={entry.id}>
                    <GenesisRow entry={entry} placementSize={PLACEMENT_TRIO_SIZE} />
                    <LedgerEntryRow entry={entry} opponentNames={opponentNames} score={score} venueName={venueName} />
                  </Fragment>
                ) : (
                  <LedgerEntryRow key={entry.id} entry={entry} opponentNames={opponentNames} score={score} venueName={venueName} />
                ),
              )}
            </Card>
          ))}

          <p className="text-cu-meta text-ink-muted text-center leading-relaxed">
            append-only · nothing can be edited or deleted, by anyone
          </p>
        </>
      )}
    </main>
  );
}
