import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { listUpcomingSessionsForCircle, type SessionSummary } from "@/server/games-service";
import { loadCircleContext } from "../load-circle";
import { CirclePhone } from "@/components/circle-screens/circle-phone";
import { WideGames } from "@/components/circle-screens/wide/wide-games";

/**
 * Circle context · Games (WEB-SHELL-SPEC.md Wave B). This list is a new surface
 * — the phone app reaches games through the Feed's pinned bar, not a per-circle
 * list — so below 900px this route renders the circle Feed (never a dead end),
 * and the wide Games list only appears at 900px+. Games/Tab aren't CircleTabs
 * tabs, so this is the CSS-sibling split: the phone tree hides at 900+ (its one
 * PinnedGameBar / circle subscription stays single) and the static wide list
 * shows. No stateful component is duplicated.
 *
 * The rows are derived from listUpcomingSessionsForCircle (the same read the
 * feed loader uses): standing games via their soonest upcoming session, one-off
 * sessions on their own.
 */
export default async function CircleGamesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return null;

  const ctx = await loadCircleContext(id, user.id);

  const { db } = await getGamesClient();
  const summaries = await listUpcomingSessionsForCircle(db, id, user.id);

  // Standing games: soonest upcoming session per standing game (summaries are
  // ascending by startsAt, so the first seen per standing-game id is soonest).
  const seenStandingGame = new Set<string>();
  const standingRows: SessionSummary[] = [];
  const oneOffRows: SessionSummary[] = [];
  for (const s of summaries) {
    if (s.standingGame == null) {
      oneOffRows.push(s);
    } else if (!seenStandingGame.has(s.standingGame.id)) {
      seenStandingGame.add(s.standingGame.id);
      standingRows.push(s);
    }
  }

  return (
    <>
      <div className="min-[900px]:hidden">
        <CirclePhone ctx={ctx} currentUserId={user.id} initialTab="feed" />
      </div>
      <div className="hidden min-[900px]:block">
        <WideGames circleId={id} isOrganiser={ctx.detail.myRole === "organiser"} standingRows={standingRows} oneOffRows={oneOffRows} />
      </div>
    </>
  );
}
