import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getMatchesStore, computeWinner } from "@/server/matches-db";
import { confirmMatchAction, disputeMatchAction } from "@/server/matches-actions";
import { ScoreTable, MatchStatusBadge } from "@/components/matches/score-table";

export default async function MatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const store = await getMatchesStore();
  const detail = await store.getMatchDetail(id, user.id);

  if (!detail) {
    return (
      <main className="px-5 pt-8 pb-6 flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Match</h1>
        <p style={{ color: "var(--c4-text-muted)" }}>That match couldn&apos;t be found.</p>
      </main>
    );
  }

  const { match, players, confirmedTeams, viewerTeam, ledgerEvents } = detail;
  const teamAName = `${players[match.teamAPlayer1Id]} & ${players[match.teamAPlayer2Id]}`;
  const teamBName = `${players[match.teamBPlayer1Id]} & ${players[match.teamBPlayer2Id]}`;
  const winner = computeWinner(match.score);

  const viewerHasConfirmed = viewerTeam !== null && confirmedTeams.includes(viewerTeam);
  const canAct = match.status === "pending_confirmation" && viewerTeam !== null && !viewerHasConfirmed;

  const confirmWithId = confirmMatchAction.bind(null, match.id);
  const disputeWithId = disputeMatchAction.bind(null, match.id);

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Match result</h1>
        <MatchStatusBadge status={match.status} />
      </div>

      <section
        className="rounded-2xl p-5 flex flex-col gap-3"
        style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
      >
        <ScoreTable sets={match.score} teamAName={teamAName} teamBName={teamBName} />
        <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
          {winner === "A" ? teamAName : teamBName} won
        </p>
      </section>

      {match.status === "pending_confirmation" && canAct && (
        <div className="flex gap-3">
          <form action={confirmWithId} className="flex-1">
            <button
              type="submit"
              className="w-full rounded-xl font-semibold py-3"
              style={{ background: "var(--c4-accent)", color: "var(--c4-accent-contrast)", minHeight: "var(--c4-touch-target)" }}
            >
              Confirm
            </button>
          </form>
          <form action={disputeWithId} className="flex-1">
            <button
              type="submit"
              className="w-full rounded-xl font-medium py-3"
              style={{ background: "transparent", border: "1px solid var(--c4-danger)", color: "var(--c4-danger)", minHeight: "var(--c4-touch-target)" }}
            >
              Dispute
            </button>
          </form>
        </div>
      )}

      {match.status === "pending_confirmation" && viewerHasConfirmed && (
        <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
          You&apos;ve confirmed this result — waiting on the other team.
        </p>
      )}

      {match.status === "pending_confirmation" && viewerTeam === null && (
        <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
          Waiting on both teams to confirm this result.
        </p>
      )}

      {match.status === "disputed" && (
        <div
          className="rounded-2xl p-4"
          style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-danger)" }}
        >
          <p className="text-sm font-medium" style={{ color: "var(--c4-danger)" }}>
            This result is disputed.
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--c4-text-muted)" }}>
            No one&apos;s Glass rating moved. Sort it out and record it again if the score was wrong.
          </p>
        </div>
      )}

      {match.status === "verified" && ledgerEvents && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--c4-text-muted)" }}>
            Glass moved
          </h2>
          {ledgerEvents.map((ev) => (
            <div
              key={ev.playerId}
              className="rounded-xl p-3 flex items-center gap-3"
              style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
            >
              <span
                className="font-semibold tabular-nums shrink-0"
                style={{ color: ev.delta >= 0 ? "var(--c4-accent)" : "var(--c4-danger)" }}
              >
                {ev.delta >= 0 ? "+" : ""}
                {ev.delta.toFixed(2)}
              </span>
              <div>
                <p className="text-sm font-medium">{players[ev.playerId]}</p>
                <p className="text-xs" style={{ color: "var(--c4-text-muted)" }}>
                  {ev.explanation}
                </p>
              </div>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
