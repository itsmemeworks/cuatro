import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { NotMemberError, getCirclesStore, type CircleMessageView } from "@/server/circles";
import { getGamesClient } from "@/server/games-db";
import { listUpcomingSessionsForCircle, isFourthCallActive } from "@/server/games-service";
import { listCircleFeed } from "@/server/feed";
import { getUnreadCountForCircle } from "@/server/circle-unread";
import { CircleTabs, type FeedItemData } from "@/components/circle-screens/circle-tabs";
import { ToastBoundary } from "@/components/circle-screens/toast-boundary";
import { InviteShareButton } from "@/components/circles/invite-share-button";
import { CircleSwitcher } from "@/components/circles/circle-switcher";
import { RememberLastCircle } from "@/components/circles/remember-last-circle";
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
  // Powers the compact multi-Circle switcher (see components/circles/circle-switcher.tsx) — this app is multi-circle even though the Circle tab shows one at a time.
  const allCircles = await store.listCirclesForUser(user.id);

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

  const { items, rivalry } = listCircleFeed(db, id, user.id);
  const feedItems: FeedItemData[] = items.map((item) =>
    item.kind === "result"
      ? {
          kind: "result",
          post: {
            matchId: item.post.matchId,
            playedAt: item.post.playedAt.toISOString(),
            sets: item.post.sets,
            outcome: item.post.outcome,
            winner: item.post.winner,
            teamA: item.post.teamA,
            teamB: item.post.teamB,
            respectCount: item.post.respectCount,
            viewerRespected: item.post.viewerRespected,
            commentCount: item.post.commentCount,
            rematchHref: item.post.rematchHref,
          },
        }
      : {
          kind: "placement_reveal",
          reveal: {
            ratingEventId: item.reveal.ratingEventId,
            matchId: item.reveal.matchId,
            playedAt: item.reveal.playedAt.toISOString(),
            displayName: item.reveal.displayName,
            rating: item.reveal.rating,
            confidencePct: item.reveal.confidencePct,
            verifiedGamesRequired: item.reveal.verifiedGamesRequired,
            respectCount: item.reveal.respectCount,
            viewerRespected: item.reveal.viewerRespected,
          },
        },
  );

  const unreadChatBadge = getUnreadCountForCircle(db, id, user.id);

  const colour = detail.colour ?? circleColorFor(detail.id);

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-5">
      <RememberLastCircle circleId={detail.id} />
      <CircleSwitcher circles={allCircles} activeCircleId={detail.id} />

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
          unreadChatBadge={unreadChatBadge}
          sessionCards={sessionCards}
          messages={serializeMessages(messages)}
          members={detail.members}
          currentUserId={user.id}
          inviteCode={detail.inviteCode}
          circleName={detail.name}
          isOrganiser={detail.myRole === "organiser"}
          feedItems={feedItems}
          rivalry={rivalry ? { opponentName: rivalry.opponentName, count: rivalry.count, direction: rivalry.direction } : null}
        />
      </ToastBoundary>
    </main>
  );
}
