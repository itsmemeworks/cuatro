import { notFound } from "next/navigation";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { matches, sessions, venues, type CuatroDb } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { NotMemberError, getCirclesStore, type CircleMessageView } from "@/server/circles";
import { getGamesClient } from "@/server/games-db";
import { listUpcomingSessionsForCircle, isFourthCallActive } from "@/server/games-service";
import { circleAnchor, circleKnocks } from "@/server/open-door";
import type { KnockPanelItem } from "@/components/circles/knock-panel";
import type { EditAnchor } from "@/components/circles/edit-circle-sheet";
import { listCircleFeed } from "@/server/feed";
import { getUnreadCountForCircle } from "@/server/circle-unread";
import { CircleTabs, type FeedItemData } from "@/components/circle-screens/circle-tabs";
import { ToastBoundary } from "@/components/circle-screens/toast-boundary";
import { InviteShareButton } from "@/components/circles/invite-share-button";
import { CircleSwitcher } from "@/components/circles/circle-switcher";
import { RememberLastCircle } from "@/components/circles/remember-last-circle";
import { AvatarStack } from "@/components/ui";
import { CircleHeaderHero } from "@/components/circles/circle-header";
import type { EditVenueOption } from "@/components/circles/edit-circle-sheet";
import type { ChatMessage } from "@/components/circles/circle-chat";
import type { SessionCardData } from "@/components/games/SessionCard";
import { circleColorFor } from "@/lib/design";

/**
 * "N games" for the circle header (design/DESIGN-AUDIT.md C3) — a cheap
 * inline count alongside server/feed.ts's own `loadVerifiedMatches` join,
 * not a new server export: the Feed read model only ever returns its
 * most-recent `limit` items, never a circle-wide total.
 */
async function countVerifiedMatches(db: CuatroDb, circleId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`cast(count(*) as int)` })
    .from(matches)
    .innerJoin(sessions, eq(matches.sessionId, sessions.id))
    .where(and(eq(sessions.circleId, circleId), eq(matches.status, "verified")));
  return row?.n ?? 0;
}

function serializeMessages(messages: CircleMessageView[]): ChatMessage[] {
  return messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }));
}

/** Tabs CircleTabs understands — the deep-link `?tab=` param is validated against this before it's threaded through (an unknown value falls back to Feed). */
const CIRCLE_TABS = ["feed", "chat", "members", "settings"] as const;
type CircleTab = (typeof CIRCLE_TABS)[number];

export default async function CircleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const rawTab = Array.isArray(tabParam) ? tabParam[0] : tabParam;
  const initialTab: CircleTab = CIRCLE_TABS.includes(rawTab as CircleTab) ? (rawTab as CircleTab) : "feed";
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
  const sessionSummaries = await listUpcomingSessionsForCircle(db, id, user.id);
  const sessionCards: SessionCardData[] = sessionSummaries.map((s) => ({
    sessionId: s.session.id,
    circleId: s.circleId,
    circleName: s.circleName,
    circleColour: s.circleColour,
    circleEmblem: s.circleEmblem,
    venueName: s.venue?.name ?? null,
    startsAt: new Date(s.session.startsAt),
    slots: s.slots,
    confirmed: s.confirmed,
    reserves: s.reserves,
    viewerStatus: s.viewerStatus,
    rsvpWindowOpensAt: s.rsvpWindowOpensAt,
    fourthCallActive: isFourthCallActive(s),
  }));

  const { items, rivalry } = await listCircleFeed(db, id, user.id);
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
            avatarUrl: item.reveal.avatarUrl,
            rating: item.reveal.rating,
            confidencePct: item.reveal.confidencePct,
            verifiedGamesRequired: item.reveal.verifiedGamesRequired,
            respectCount: item.reveal.respectCount,
            viewerRespected: item.reveal.viewerRespected,
          },
        },
  );

  const unreadChatBadge = await getUnreadCountForCircle(db, id, user.id);
  const gamesCount = await countVerifiedMatches(db, id);

  // Home court: the Circle's most-used pinned venue (server/open-door.ts's
  // derived anchor — no schema column). Everyone sees the venue name; the
  // edit surface additionally shows its full address. Null until a Standing
  // Game or session pins a venue with coordinates.
  const anchorPoint = await circleAnchor(db, id);
  let anchor: EditAnchor | null = null;
  if (anchorPoint) {
    const [venue] = await db.select({ address: venues.address }).from(venues).where(eq(venues.id, anchorPoint.venueId));
    anchor = { venueName: anchorPoint.venueName, address: venue?.address ?? null };
  }

  // The pinned venues the organiser can pick as an explicit home court (the
  // same set the profile home-venue picker offers). Only loaded for the edit
  // surface, but cheap enough to always fetch.
  const venueOptions: EditVenueOption[] = await db
    .select({ id: venues.id, name: venues.name })
    .from(venues)
    .where(and(isNotNull(venues.lat), isNotNull(venues.lng)))
    .orderBy(asc(venues.name));

  // Home court, stated honestly: an organiser's explicit choice reads "set by
  // organiser"; otherwise it's the derived anchor, "based on where you play".
  const homeCourtName = detail.homeVenueId ? detail.homeVenueName : (anchor?.venueName ?? null);
  const homeCourtExplicit = detail.homeVenueId != null;

  // Open Door: an organiser sees pending knocks + the door controls. circleKnocks
  // itself re-checks the organiser role, so this is safe even if myRole drifted.
  const pendingKnocks: KnockPanelItem[] =
    detail.myRole === "organiser"
      ? (await circleKnocks(db, id, user.id)).map((k) => ({
          knockId: k.knockId,
          displayName: k.displayName,
          avatarUrl: k.avatarUrl,
          rating: k.rating,
          reliability: k.reliability,
          distanceLabel: k.distanceLabel,
          message: k.message,
        }))
      : [];
  // CircleDetail itself carries no createdAt (see server/circles.ts) — the
  // summary list this page already fetches for the switcher does, so "est.
  // YYYY" reuses that instead of adding a second circles-table lookup.
  const foundedYear = allCircles.find((c) => c.id === id)?.createdAt.getFullYear();

  const colour = detail.colour ?? circleColorFor(detail.id);

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-5">
      <RememberLastCircle circleId={detail.id} />
      <CircleSwitcher circles={allCircles} activeCircleId={detail.id} />

      <CircleHeaderHero
        circleId={detail.id}
        headerImage={detail.headerImage}
        colour={colour}
        emblem={detail.emblem}
        name={detail.name}
        facts={
          <>
            {detail.members.length} member{detail.members.length === 1 ? "" : "s"} · {gamesCount} game
            {gamesCount === 1 ? "" : "s"}
            {foundedYear != null && ` · est. ${foundedYear}`}
          </>
        }
      />

      <div className="flex items-center gap-3">
        <AvatarStack
          people={detail.members.slice(0, 4).map((m) => ({ src: m.avatarUrl, name: m.displayName }))}
          size="sm"
          ring="ground"
        />
        <div className="flex-1" />
        <InviteShareButton
          inviteCode={detail.inviteCode}
          circleName={detail.name}
          label={detail.members.length <= 1 ? "Invite" : "Copy ↗"}
        />
      </div>

      {homeCourtName ? (
        <p className="text-cu-meta text-ink-muted">
          Home court: <span className="text-ink">{homeCourtName}</span>
          {homeCourtExplicit ? " · set by organiser" : " · based on where you play"}
        </p>
      ) : (
        <p className="text-cu-meta text-ink-muted">
          No home court yet. Set one in Edit Circle, or play a venue with an address and it pins itself.
        </p>
      )}

      <ToastBoundary>
        <CircleTabs
          circleId={detail.id}
          circleColour={colour}
          circleEmblem={detail.emblem}
          unreadChatBadge={unreadChatBadge}
          sessionCards={sessionCards}
          messages={serializeMessages(messages)}
          members={detail.members}
          currentUserId={user.id}
          inviteCode={detail.inviteCode}
          circleName={detail.name}
          isOrganiser={detail.myRole === "organiser"}
          openDoor={detail.openDoor}
          boardEnabled={detail.boardEnabled}
          vibeLine={detail.vibeLine}
          anchor={anchor}
          headerImage={detail.headerImage}
          homeVenueId={detail.homeVenueId}
          maxMembers={detail.maxMembers}
          memberCount={detail.memberCount}
          venueOptions={venueOptions}
          pendingKnocks={pendingKnocks}
          feedItems={feedItems}
          initialTab={initialTab}
          rivalry={
            rivalry
              ? {
                  opponentName: rivalry.opponentName,
                  // computeRivalryCallout only returns the opponent's id/name (server/feed.ts) —
                  // their avatar is resolved here from the members list this page already loaded.
                  opponentAvatarUrl: detail.members.find((m) => m.userId === rivalry.opponentUserId)?.avatarUrl ?? null,
                  count: rivalry.count,
                  direction: rivalry.direction,
                }
              : null
          }
        />
      </ToastBoundary>
    </main>
  );
}
