import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { NotMemberError, getCirclesStore, type CircleMessageView } from "@/server/circles";
import { getGamesClient } from "@/server/games-db";
import { listUpcomingSessionsForCircle, isFourthCallActive } from "@/server/games-service";
import { listRecentResultsForCircle } from "@/server/feed";
import { CircleTabs } from "@/components/circle-screens/circle-tabs";
import type { ResultPostData } from "@/components/circle-screens/result-post";
import { ToastBoundary } from "@/components/circle-screens/toast-boundary";
import { InviteShareButton } from "@/components/circles/invite-share-button";
import type { ChatMessage } from "@/components/circles/circle-chat";
import type { SessionCardData } from "@/components/games/SessionCard";
import { circleColorFor } from "@/lib/design";

function serializeMessages(messages: CircleMessageView[]): ChatMessage[] {
  return messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }));
}

export default async function CircleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return null; // the (app) layout already redirects unauthenticated users to /login

  const store = await getCirclesStore();

  let detail;
  try {
    detail = await store.getCircleDetail(id, user.id);
  } catch (err) {
    // Not a member — treat identically to "doesn't exist" so a guessed
    // Circle id can't confirm a group's existence to an outsider.
    if (err instanceof NotMemberError) notFound();
    throw err;
  }
  if (!detail) notFound();

  const messages = await store.listMessages(id, user.id);

  const { db } = await getGamesClient();
  const sessionSummaries = listUpcomingSessionsForCircle(db, id, user.id);
  const sessionCards: SessionCardData[] = sessionSummaries.map((s) => ({
    sessionId: s.session.id,
    circleId: s.circleId,
    circleName: s.circleName,
    venueName: s.venue?.name ?? null,
    startsAt: s.session.startsAt,
    slots: s.slots,
    confirmed: s.confirmed,
    reserves: s.reserves,
    viewerStatus: s.viewerStatus,
    rsvpWindowOpensAt: s.rsvpWindowOpensAt,
    fourthCallActive: isFourthCallActive(s),
  }));

  const { posts, rivalry } = listRecentResultsForCircle(db, id, user.id);
  const resultPosts: ResultPostData[] = posts.map((p) => ({
    matchId: p.matchId,
    playedAt: p.playedAt.toISOString(),
    sets: p.sets,
    outcome: p.outcome,
    winner: p.winner,
    teamA: p.teamA,
    teamB: p.teamB,
    respectCount: p.respectCount,
    viewerRespected: p.viewerRespected,
    rematchHref: p.rematchHref,
  }));

  const colour = detail.colour ?? circleColorFor(detail.id);

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-5">
      <header className="flex items-center gap-3">
        <div
          className="w-12 h-12 rounded-card flex items-center justify-center text-2xl shrink-0"
          style={{ background: colour }}
          aria-hidden
        >
          <span className="text-white font-extrabold text-base">{detail.emblem ?? detail.name.slice(0, 2).toUpperCase()}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-cu-card-title text-ink truncate" style={{ fontSize: 19 }}>
            {detail.name}
          </h1>
          <p className="text-cu-meta text-ink-muted mt-0.5">
            {detail.members.length} member{detail.members.length === 1 ? "" : "s"}
          </p>
        </div>
        <InviteShareButton inviteCode={detail.inviteCode} circleName={detail.name} />
      </header>

      <ToastBoundary>
        <CircleTabs
          circleId={detail.id}
          circleColour={colour}
          sessionCards={sessionCards}
          messages={serializeMessages(messages)}
          members={detail.members}
          currentUserId={user.id}
          inviteCode={detail.inviteCode}
          circleName={detail.name}
          isOrganiser={detail.myRole === "organiser"}
          resultPosts={resultPosts}
          rivalry={rivalry ? { opponentName: rivalry.opponentName, count: rivalry.count, direction: rivalry.direction } : null}
        />
      </ToastBoundary>
    </main>
  );
}
