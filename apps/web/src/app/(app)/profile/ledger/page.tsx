import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { sessions, venues } from "@cuatro/db";
import { PLACEMENT_TRIO_SIZE } from "@cuatro/glass";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { getMatchesStore, gamesTotals } from "@/server/matches-db";
import { LedgerEntryRow, GenesisRow } from "@/components/glass/ledger-entry";
import { Card, Fact, InfoTerm } from "@/components/ui";

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

  const details = await Promise.all(entries.map((entry) => store.getMatchDetail(entry.matchId, user.id)));

  // Venue for the "date · venue" meta line (design/DESIGN-AUDIT.md P5) — a
  // light join the read models above don't carry, done here rather than in
  // matches-db.ts (owned elsewhere) since it's purely a display enrichment.
  const { db } = await getDb();
  const sessionIds = [...new Set(details.map((d) => d?.match.sessionId).filter((id): id is string => !!id))];
  const venueBySessionId = new Map<string, string>();
  if (sessionIds.length > 0) {
    const sessionRows = db.select({ id: sessions.id, venueId: sessions.venueId }).from(sessions).where(inArray(sessions.id, sessionIds)).all();
    const venueIds = [...new Set(sessionRows.map((r) => r.venueId).filter((id): id is string => !!id))];
    const venueRows = venueIds.length > 0 ? db.select({ id: venues.id, name: venues.name }).from(venues).where(inArray(venues.id, venueIds)).all() : [];
    const venueNameById = new Map(venueRows.map((v) => [v.id, v.name]));
    for (const row of sessionRows) {
      const name = row.venueId ? venueNameById.get(row.venueId) : undefined;
      if (name) venueBySessionId.set(row.id, name);
    }
  }

  const enriched = entries.map((entry, i) => {
    const detail = details[i];
    if (!detail || !detail.viewerTeam) return { entry, opponentNames: null, score: null, venueName: null };
    const { gamesWonA, gamesWonB } = gamesTotals(detail.match.score);
    const [yourGames, oppGames] = detail.viewerTeam === "A" ? [gamesWonA, gamesWonB] : [gamesWonB, gamesWonA];
    const opponentIds = detail.viewerTeam === "A"
      ? [detail.match.teamBPlayer1Id, detail.match.teamBPlayer2Id]
      : [detail.match.teamAPlayer1Id, detail.match.teamAPlayer2Id];
    const opponentNames = opponentIds.map((id) => detail.players[id] ?? "someone").join(" & ");
    return { entry, opponentNames, score: `${yourGames}–${oppGames}`, venueName: venueBySessionId.get(detail.match.sessionId) ?? null };
  });

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
          <p className="text-cu-secondary text-ink-muted mt-1">nothing hidden, every move explained, not just a number that went up or down</p>
        </div>
        {glass?.status === "rated" && (
          <div className="text-right">
            <p className="text-cu-title text-ink">{glass.rating!.toFixed(2)}</p>
            <Fact size="meta" tone="muted"><InfoTerm term="confidence" label="conf" /> {glass.confidencePct}%</Fact>
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <Card>
          <p className="text-cu-body text-ink-muted">
            No verified matches yet. Your Glass is waiting patiently, like a lob hanging at the back. The Ledger fills in the moment your first result is confirmed by both teams.
          </p>
        </Card>
      ) : (
        <>
          {groups.map((group) => (
            <Card key={group.label} padded={false} className="overflow-hidden">
              <div className="px-4 py-2.5 bg-ink-hairline-1">
                <p className="text-cu-secondary font-extrabold tracking-[0.14em] text-ink-muted">{group.label}</p>
              </div>
              {group.rows.map(({ entry, opponentNames, score, venueName }) =>
                entry.explanation.startsWith("Placement Trio complete") ? (
                  <GenesisRow key={entry.id} entry={entry} placementSize={PLACEMENT_TRIO_SIZE} />
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
