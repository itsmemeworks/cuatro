import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getMatchesStore, computeWinner, gamesTotals } from "@/server/matches-db";
import { confirmMatchAction, disputeMatchAction } from "@/server/matches-actions";
import { ScoreTable, MatchStatusBadge } from "@/components/matches/score-table";
import { FriendlyBadge } from "@/components/matches/friendly-badge";
import { MatchConfirmFlow } from "@/components/matches/match-confirm-flow";
import { MatchDetailWide } from "@/components/matches/wide/match-detail-wide";
import { MatchLive } from "@/components/matches/match-live";
import { Card, Meta } from "@/components/ui";

export default async function MatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const store = await getMatchesStore();
  const detail = await store.getMatchDetail(id, user.id);

  if (!detail) {
    return (
      <main className="px-4 pt-6 pb-6 flex flex-col gap-4">
        <h1 className="text-cu-title text-ink">Match</h1>
        <Card>
          <p className="text-cu-body text-ink-muted">That match couldn&apos;t be found.</p>
        </Card>
      </main>
    );
  }

  const { match, players, avatars, confirmedTeams, viewerTeam, ledgerEvents, context } = detail;
  const teamAName = `${players[match.teamAPlayer1Id]} & ${players[match.teamAPlayer2Id]}`;
  const teamBName = `${players[match.teamBPlayer1Id]} & ${players[match.teamBPlayer2Id]}`;
  const winner = computeWinner(match.score);
  // computeWinner falls back to "A" when there are no games to compare (see
  // its own doc comment) — a real pick for a genuine 0-0 tie, but nonsense
  // for a walkover or a match retired before any games were played. Same
  // "totalGames <= 0" condition @cuatro/glass's engine itself uses to skip
  // Glass entirely for that case (packages/glass/src/engine.ts).
  const { gamesWonA, gamesWonB } = gamesTotals(match.score);
  const noRealWinner = match.outcome === "walkover" || gamesWonA + gamesWonB <= 0;

  const viewerHasConfirmed = viewerTeam !== null && confirmedTeams.includes(viewerTeam);
  const canAct = match.status === "pending_confirmation" && viewerTeam !== null && !viewerHasConfirmed;
  const isFriendly = match.gameType === "friendly";

  const confirmWithId = confirmMatchAction.bind(null, match.id);
  const disputeWithId = disputeMatchAction.bind(null, match.id);

  const playerBits = (playerId: string) => ({ name: players[playerId] ?? "Player", avatarUrl: avatars[playerId] ?? null });

  return (
    <>
      {/* One subscription serves both trees (MatchLive renders nothing). While
          the match is pending it also polls, so a lost seal broadcast can
          never strand a live "Confirm result" button (QA5 finding 4). */}
      <MatchLive sessionId={match.sessionId} pending={match.status === "pending_confirmation"} />
      <main className="px-4 pt-6 pb-6 flex flex-col gap-4 min-[900px]:hidden">
        <div className="flex items-center justify-between">
          <h1 className="text-cu-title text-ink">Match result</h1>
          <div className="flex items-center gap-2">
            {isFriendly && <FriendlyBadge />}
            <MatchStatusBadge status={match.status} outcome={match.outcome} />
          </div>
        </div>

        <Card className="flex flex-col gap-3">
          <ScoreTable sets={match.score} teamAName={teamAName} teamBName={teamBName} />
          <Meta>{noRealWinner ? "No games played" : `${winner === "A" ? teamAName : teamBName} won`}</Meta>
        </Card>

        {match.status !== "void" && (
          <MatchConfirmFlow
            status={match.status}
            outcome={match.outcome}
            friendly={isFriendly}
            teamAName={teamAName}
            teamBName={teamBName}
            winnerTeam={winner}
            confirmedTeams={confirmedTeams}
            viewerTeam={viewerTeam}
            canAct={canAct}
            ledgerEvents={ledgerEvents}
            players={players}
            teamAPlayerIds={[match.teamAPlayer1Id, match.teamAPlayer2Id]}
            teamBPlayerIds={[match.teamBPlayer1Id, match.teamBPlayer2Id]}
            confirmAction={confirmWithId}
            disputeAction={disputeWithId}
          />
        )}

        {match.status === "pending_confirmation" && (
          <p className="text-cu-meta text-ink-muted text-center px-6">
            {isFriendly
              ? "A friendly still gets confirmed by both teams. It counts for Reliability and shows in your history, Glass just stays put."
              : "Glass moves only when both teams confirm, no referee, no disputes desk"}
          </p>
        )}
      </main>

      {/* Wide (>=900px): the design overlay's step 5 grown into a page —
          pending seal + how-the-other-side-sees-it, the real opposing
          confirm, and the both-deltas seal. Same LiveRefresh signal drives
          both trees via the one instance above (it renders nothing). */}
      <div className="c4-wide hidden min-[900px]:block w-full pt-2">
        {match.status === "void" ? (
          <div className="max-w-[720px] mx-auto px-[30px]">
            <Card>
              <p className="text-cu-body text-ink-muted">This result was voided.</p>
            </Card>
          </div>
        ) : (
          <MatchDetailWide
            status={match.status}
            outcome={match.outcome}
            friendly={isFriendly}
            sets={match.score}
            winnerTeam={winner}
            viewerTeam={viewerTeam}
            viewerHasConfirmed={viewerHasConfirmed}
            canAct={canAct}
            teamA={[playerBits(match.teamAPlayer1Id), playerBits(match.teamAPlayer2Id)]}
            teamB={[playerBits(match.teamBPlayer1Id), playerBits(match.teamBPlayer2Id)]}
            teamAIds={[match.teamAPlayer1Id, match.teamAPlayer2Id]}
            teamBIds={[match.teamBPlayer1Id, match.teamBPlayer2Id]}
            viewerId={user.id}
            ledgerEvents={ledgerEvents}
            playerNames={players}
            startsAtMs={context.startsAt.getTime()}
            venueName={context.venueName}
            circleName={context.circleName}
            sessionId={match.sessionId}
            confirmAction={confirmWithId}
            disputeAction={disputeWithId}
          />
        )}
      </div>
    </>
  );
}
