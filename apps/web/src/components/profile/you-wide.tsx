import { Fragment } from "react";
import Link from "next/link";
import type { PlayerProfile, LedgerEnrichedRow } from "@/server/players";
import { Fact, InfoTerm, Meta } from "@/components/ui";
import { DEFAULT_TZ, formatMonthYear } from "@/lib/time";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { LedgerEntryRow, GenesisRow, isGenesisEntry } from "@/components/glass/ledger-entry";
import { PatchChip } from "@/components/atlas/patch-chip";
import type { PatchVenueOption } from "@/components/atlas/patch-control";
import type { PatchSize } from "@/lib/geo";
import { PLACEMENT_TRIO_SIZE } from "@cuatro/glass";

/** The design's 8 discrete "trend" bars, from the tail of the season sparkline; the last bar is coral (most recent), the rest are muted. */
function TrendBars({ values }: { values: number[] }) {
  const tail = values.slice(-8);
  if (tail.length < 2) return null;
  const min = Math.min(...tail);
  const max = Math.max(...tail);
  const span = max - min || 1;
  return (
    <div className="flex items-end gap-1 h-9 flex-1 pb-0.5" aria-hidden>
      {tail.map((v, i) => {
        const h = 10 + ((v - min) / span) * 18; // 10–28px, matching the design
        const last = i === tail.length - 1;
        return (
          <div
            key={i}
            className={`w-2.5 rounded-[3px] ${last ? "bg-action" : "bg-ink-hairline-2"}`}
            style={{ height: `${h}px` }}
          />
        );
      })}
    </div>
  );
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 bg-surface border border-ink-hairline-1 rounded-2xl p-[13px] text-center">
      <p className="text-[19px] font-extrabold text-ink">{value}</p>
      <Meta as="p" className="mt-0.5">{label}</Meta>
    </div>
  );
}

function ledgerMonthLabel(rows: LedgerEnrichedRow[]): string {
  const d = rows[0]?.entry.createdAt ?? new Date();
  // DEFAULT_TZ: a profile-wide surface with no session/venue anchor (lib/time contract).
  return formatMonthYear(d, DEFAULT_TZ).toUpperCase();
}

/** The genesis "Glass poured" row is the one whose explanation opens the Placement-Trio-complete line — the shared isGenesisEntry discriminator (ledger-entry.tsx), same as ledger-view.tsx. */
function isGenesis(row: LedgerEnrichedRow): boolean {
  return isGenesisEntry(row.entry);
}

/**
 * The wide home-context "You" (design/CUATRO-Web-LATEST.dc.html "Desktop ·
 * You"): identity header with the Shows-up chip, the GLASS card (big number,
 * trend bars, confidence), the W–L / streak / best-win tiles, and THE LEDGER
 * with its explained deltas. Rating stays hidden until the Placement Trio
 * completes (CLAUDE.md #6): an unrevealed player sees placement progress and
 * a Ledger that is still filling, never a number or a rating-bearing delta.
 * Read-only over server/players.ts; reuses the shared Ledger row components so
 * the explanation copy and the "Glass poured" moment stay in one place.
 */
export function YouWide({
  profile,
  ledgerRows,
  displayName,
  avatarUrl,
  patch,
  patchSize,
  homeVenueId,
  homeVenueName,
  findable,
  venueOptions,
}: {
  profile: PlayerProfile;
  /** The full enriched Ledger (newest first) — the card previews the top few and links to /profile/ledger for the rest. */
  ledgerRows: LedgerEnrichedRow[];
  displayName: string;
  avatarUrl: string | null;
  /** Current resolved patch (server/patch.ts) — powers the patch chip's mini-map; null when no home court pins yet. */
  patch: { lat: number; lng: number; radiusKm: number } | null;
  patchSize: PatchSize;
  homeVenueId: string | null;
  homeVenueName: string | null;
  findable: boolean;
  venueOptions: PatchVenueOption[];
}) {
  const { glass, history, streak, bestWin, deltaSinceFirst, sparklineValues, circlesCount } = profile;
  const rated = glass?.status === "rated";
  const preview = ledgerRows.slice(0, 3);
  const genesis = ledgerRows.find(isGenesis) ?? null;

  return (
    <div>
      {/* identity header */}
      <div className="flex items-center gap-4">
        <ProfileAvatar name={displayName} avatarUrl={avatarUrl} />
        <div className="flex-1 min-w-0">
          <h1 className="text-[25px] leading-none font-extrabold text-ink truncate">{displayName}</h1>
          <div className="flex flex-wrap gap-[7px] mt-2">
            {/* Reliability chip: before the first RSVP the percentage doesn't
                exist yet, so render the phone profile's reassurance line
                (ReliabilityBadge's empty state — same words, same InfoTerm)
                instead of a green pill with a bare "%" (QA1 blocker / QA8 #2). */}
            {glass &&
              (glass.reliabilityPct != null ? (
                <span className="rounded-chip px-[11px] py-[5px] text-[11px] font-bold bg-win-tint text-win">
                  ✓ Shows up · {glass.reliabilityPct}%
                </span>
              ) : (
                <span className="rounded-chip px-[11px] py-[5px] text-[11px] font-semibold bg-ink-hairline-2 text-ink-muted">
                  <InfoTerm term="reliability" label="Reliability" /> appears after your first RSVP
                </span>
              ))}
            <span className="rounded-chip px-[11px] py-[5px] text-[11px] font-semibold bg-ink-hairline-2 text-ink">
              {circlesCount} {circlesCount === 1 ? "Circle" : "Circles"}
            </span>
            <PatchChip
              patch={patch}
              size={patchSize}
              homeVenueId={homeVenueId}
              homeVenueName={homeVenueName}
              findable={findable}
              venueOptions={venueOptions}
            />
            <Link
              href="/profile/settings"
              className="rounded-chip px-[11px] py-[5px] text-[11px] font-semibold border border-ink-hairline-3 text-ink"
            >
              ⚙ Settings
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 min-[1180px]:grid-cols-[1fr_1.1fr] gap-4 mt-[18px] items-start">
        {/* left column: GLASS + tiles */}
        <div>
          <div className="bg-surface border border-ink-hairline-1 rounded-[22px] px-[18px] py-5">
            <div className="flex justify-between items-baseline">
              <span className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-muted">GLASS</span>
              {rated && deltaSinceFirst != null && (
                <Fact size="meta" weight="semibold" tone={deltaSinceFirst >= 0 ? "win" : "loss"}>
                  {deltaSinceFirst >= 0 ? "▲" : "▼"} {deltaSinceFirst >= 0 ? "+" : ""}
                  {deltaSinceFirst.toFixed(2)} this season
                </Fact>
              )}
            </div>

            {rated ? (
              <>
                <div className="flex items-baseline gap-3.5 mt-2">
                  <span className="text-[58px] leading-none font-extrabold tracking-[-0.02em] text-ink tabular-nums">
                    {glass!.rating!.toFixed(2)}
                  </span>
                  <TrendBars values={sparklineValues} />
                </div>
                <div className="mt-3">
                  <div className="flex justify-between text-[10.5px] font-mono text-ink-muted">
                    <span>confidence</span>
                    <Fact size="meta" weight="semibold">{glass!.confidencePct}%</Fact>
                  </div>
                  <div className="h-[5px] bg-ink-hairline-2 rounded-full mt-1.5 overflow-hidden">
                    <div className="h-full bg-ink rounded-full" style={{ width: `${glass!.confidencePct}%` }} />
                  </div>
                  <Meta as="p" className="mt-1.5">
                    based on {glass!.verifiedMatchCount} verified {glass!.verifiedMatchCount === 1 ? "game" : "games"} · sharpens every time you play
                  </Meta>
                </div>
              </>
            ) : (
              <PlacementState verifiedMatchCount={glass?.verifiedMatchCount ?? 0} />
            )}
          </div>

          {rated && (
            <div className="flex gap-2.5 mt-3">
              <StatTile value={`${history.wins}–${history.losses}`} label="W–L" />
              <StatTile value={streak.kind ? `${streak.kind}${streak.count}` : "—"} label="streak" />
              <StatTile value={bestWin != null ? bestWin.toFixed(2) : "—"} label="best win" />
            </div>
          )}
        </div>

        {/* right column: THE LEDGER */}
        <div className="bg-surface border border-ink-hairline-1 rounded-[22px] overflow-hidden">
          <div className="flex justify-between items-center px-[18px] py-[13px] bg-ink-hairline-1/50">
            <span className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-muted">
              THE LEDGER{rated && preview.length > 0 ? ` · ${ledgerMonthLabel(preview)}` : ""}
            </span>
            <Meta>append-only</Meta>
          </div>

          {rated && preview.length > 0 ? (
            <>
              {preview.map((r) =>
                isGenesis(r) ? (
                  // The pour is a marker PLUS a normal entry row — the
                  // trio-completing match's own delta/factors are explained
                  // like any other movement (QA5 finding 2), same as
                  // ledger-view.tsx.
                  <Fragment key={r.entry.id}>
                    <GenesisRow entry={r.entry} placementSize={PLACEMENT_TRIO_SIZE} />
                    <LedgerEntryRow entry={r.entry} opponentNames={r.opponentNames} score={r.score} venueName={r.venueName} />
                  </Fragment>
                ) : (
                  <LedgerEntryRow
                    key={r.entry.id}
                    entry={r.entry}
                    opponentNames={r.opponentNames}
                    score={r.score}
                    venueName={r.venueName}
                  />
                ),
              )}
              {genesis && !preview.some(isGenesis) && <GenesisRow entry={genesis.entry} placementSize={PLACEMENT_TRIO_SIZE} />}
              <Link href="/profile/ledger" className="flex items-center justify-between px-[18px] py-[13px] text-cu-secondary font-bold text-action">
                <span>See the full Ledger</span>
                <span>→</span>
              </Link>
            </>
          ) : (
            <div className="px-[18px] py-6">
              <Meta as="p">
                Every movement of your Glass, explained, lands here the moment your Placement Trio completes. Nothing hidden, not just a number that went up or down.
              </Meta>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The GLASS card's pre-reveal body: progress toward the "Glass poured" moment, no number, no rating-bearing detail (CLAUDE.md #6). */
function PlacementState({ verifiedMatchCount }: { verifiedMatchCount: number }) {
  const remaining = Math.max(0, PLACEMENT_TRIO_SIZE - verifiedMatchCount);
  return (
    <div className="mt-2">
      <p className="text-[15px] font-extrabold text-ink">
        Placement Trio · {Math.min(verifiedMatchCount, PLACEMENT_TRIO_SIZE)} of {PLACEMENT_TRIO_SIZE}
      </p>
      <div className="h-[5px] bg-ink-hairline-2 rounded-full mt-2.5 overflow-hidden">
        <div className="h-full bg-action rounded-full" style={{ width: `${(Math.min(verifiedMatchCount, PLACEMENT_TRIO_SIZE) / PLACEMENT_TRIO_SIZE) * 100}%` }} />
      </div>
      <Meta as="p" className="mt-2">
        {remaining === 0
          ? "Your Placement Trio is complete. Your Glass pours the moment your latest match verifies."
          : remaining === 1
            ? "One more verified match and your Glass pours. No questionnaire, no guessing."
            : `${remaining} placement matches to go. Nobody's a number yet.`}
      </Meta>
    </div>
  );
}
