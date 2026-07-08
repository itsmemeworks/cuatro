import Link from "next/link";
import { PLACEMENT_TRIO_SIZE } from "@cuatro/glass";
import { getSessionUser } from "@/lib/session";
import { getMatchesStore, gamesTotals } from "@/server/matches-db";
import { LedgerEntryRow, GenesisRow } from "@/components/glass/ledger-entry";
import { Card, Fact } from "@/components/ui";

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
}

function monthLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(d).toUpperCase();
}

export default async function LedgerPage() {
  const user = await getSessionUser();
  if (!user) return null;

  const store = await getMatchesStore();
  const [glass, entries] = await Promise.all([store.getProfileGlassView(user.id), store.getLedger(user.id)]);

  const enriched = await Promise.all(
    entries.map(async (entry) => {
      const detail = await store.getMatchDetail(entry.matchId, user.id);
      if (!detail || !detail.viewerTeam) return { entry, opponentNames: null, score: null };
      const { gamesWonA, gamesWonB } = gamesTotals(detail.match.score);
      const [yourGames, oppGames] = detail.viewerTeam === "A" ? [gamesWonA, gamesWonB] : [gamesWonB, gamesWonA];
      const opponentIds = detail.viewerTeam === "A"
        ? [detail.match.teamBPlayer1Id, detail.match.teamBPlayer2Id]
        : [detail.match.teamAPlayer1Id, detail.match.teamAPlayer2Id];
      const opponentNames = opponentIds.map((id) => detail.players[id] ?? "someone").join(" & ");
      return { entry, opponentNames, score: `${yourGames}–${oppGames}` };
    }),
  );

  const groups: { label: string; rows: typeof enriched }[] = [];
  for (const row of enriched) {
    const key = monthKey(row.entry.createdAt);
    const label = monthLabel(row.entry.createdAt);
    const last = groups.at(-1);
    if (last && monthKey(last.rows[0]!.entry.createdAt) === key) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }

  return (
    <main className="px-4 pt-6 pb-6 flex flex-col gap-4">
      <Link href="/profile" className="text-cu-secondary font-bold text-action">
        ‹ Profile
      </Link>

      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-cu-title text-ink">The Ledger</h1>
          <p className="text-cu-secondary text-ink-muted mt-1">nothing hidden — every move explained</p>
        </div>
        {glass?.status === "rated" && (
          <div className="text-right">
            <p className="text-cu-title text-ink">{glass.rating!.toFixed(2)}</p>
            <Fact size="meta" tone="muted">conf {glass.confidencePct}%</Fact>
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <Card>
          <p className="text-cu-body text-ink-muted">
            No verified matches yet — the Ledger fills in the moment your first result is confirmed by both teams.
          </p>
        </Card>
      ) : (
        <>
          {groups.map((group) => (
            <Card key={group.label} padded={false} className="overflow-hidden">
              <div className="px-4 py-2.5 bg-ink-hairline-1">
                <p className="text-cu-secondary font-extrabold tracking-[0.14em] text-ink-muted">{group.label}</p>
              </div>
              {group.rows.map(({ entry, opponentNames, score }) =>
                entry.explanation.startsWith("Placement Trio complete") ? (
                  <GenesisRow key={entry.id} entry={entry} placementSize={PLACEMENT_TRIO_SIZE} />
                ) : (
                  <LedgerEntryRow key={entry.id} entry={entry} opponentNames={opponentNames} score={score} />
                ),
              )}
            </Card>
          ))}

          <p className="text-cu-meta text-ink-muted text-center leading-relaxed">
            append-only · nothing can be edited or deleted — by anyone
          </p>
        </>
      )}
    </main>
  );
}
