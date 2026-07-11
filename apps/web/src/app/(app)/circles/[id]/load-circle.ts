import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { matches, sessions, users, venues, type CuatroDb } from "@cuatro/db";
import { computeWinner } from "@/server/matches-db";
import {
  NotMemberError,
  getCirclesStore,
  type CircleMessageView,
  type CircleDetail,
  type CircleMemberView,
  type CircleSummary,
} from "@/server/circles";
import { getGamesClient } from "@/server/games-db";
import { listUpcomingSessionsForCircle, isFourthCallActive } from "@/server/games-service";
import { circleAnchor, circleKnocks } from "@/server/open-door";
import type { KnockPanelItem } from "@/components/circles/knock-panel";
import type { EditAnchor, EditVenueOption } from "@/components/circles/edit-circle-sheet";
import { listCircleFeed } from "@/server/feed";
import { getUnreadCountForCircle } from "@/server/circle-unread";
import type { FeedItemData } from "@/components/circle-screens/circle-tabs";
import type { ChatMessage } from "@/components/circles/circle-chat";
import type { SessionCardData } from "@/components/games/SessionCard";
import { circleColorFor } from "@/lib/design";

/**
 * "N games" for the circle header (design/DESIGN-AUDIT.md C3) — a cheap inline
 * count alongside server/feed.ts's own join, not a new server export: the Feed
 * read model only ever returns its most-recent `limit` items, never a
 * circle-wide total.
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

/**
 * The "waiting on a confirm" feed card (WEB-SHELL-SPEC.md Wave B, wide feed).
 * A recorded-but-not-yet-sealed match reads "X sent 6–3 6–4 over Y" with a
 * PENDING chip and the line "Glass moves once the other side seals it". The
 * canonical Feed model (server/feed.ts) is verified-only by design, so the
 * wide feed reads pending matches here — display only, no mutation, no change
 * to the phone feed (which never showed them).
 */
export interface PendingSealCardData {
  matchId: string;
  playedAt: string;
  sets: { a: number; b: number }[];
  /** first names, winners then losers, e.g. "Kav" / "Sam & Mags" */
  winnerNames: string;
  loserNames: string;
}

async function loadPendingSealCards(db: CuatroDb, circleId: string): Promise<PendingSealCardData[]> {
  const rows = await db
    .select({ match: matches })
    .from(matches)
    .innerJoin(sessions, eq(matches.sessionId, sessions.id))
    .where(and(eq(sessions.circleId, circleId), eq(matches.status, "pending_confirmation")))
    .orderBy(desc(matches.playedAt), desc(matches.id))
    .limit(4);
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.flatMap((r) => [r.match.teamAPlayer1Id, r.match.teamAPlayer2Id, r.match.teamBPlayer1Id, r.match.teamBPlayer2Id]))];
  const nameRows = await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, ids));
  const firstNameById = new Map(nameRows.map((u) => [u.id, u.displayName.split(" ")[0]]));
  const join = (a: string, b: string) => `${firstNameById.get(a) ?? "Unknown"} & ${firstNameById.get(b) ?? "Unknown"}`;

  return rows.map(({ match: m }) => {
    const winner = computeWinner(m.score);
    const winners = winner === "A" ? [m.teamAPlayer1Id, m.teamAPlayer2Id] : [m.teamBPlayer1Id, m.teamBPlayer2Id];
    const losers = winner === "A" ? [m.teamBPlayer1Id, m.teamBPlayer2Id] : [m.teamAPlayer1Id, m.teamAPlayer2Id];
    return {
      matchId: m.id,
      playedAt: new Date(m.playedAt).toISOString(),
      sets: m.score,
      winnerNames: join(winners[0], winners[1]),
      loserNames: join(losers[0], losers[1]),
    };
  });
}

/**
 * The whole circle-context read model, loaded ONCE and shared by both the
 * phone page (CircleTabs) and every wide tab layout (WEB-SHELL-SPEC.md Wave B).
 * The base feed route and the nested chat/members/games routes all call this so
 * the phone experience they render below 900 is identical and the wide layouts
 * read from the same snapshot. On not-a-member / not-found it triggers
 * notFound() (same posture as the old page: a guessed id can't confirm a
 * circle's existence to an outsider).
 */
export interface CircleContext {
  /** the signed-in viewer — every wide tab needs it (row "· you", RSVP, etc.) */
  currentUserId: string;
  detail: CircleDetail;
  colour: string;
  messages: ChatMessage[];
  allCircles: CircleSummary[];
  sessionCards: SessionCardData[];
  feedItems: FeedItemData[];
  rivalry: { opponentName: string; opponentAvatarUrl: string | null; count: number; direction: "beaten" | "lost_to" } | null;
  unreadChatBadge: number;
  gamesCount: number;
  anchor: EditAnchor | null;
  venueOptions: EditVenueOption[];
  homeCourtName: string | null;
  homeCourtExplicit: boolean;
  pendingKnocks: KnockPanelItem[];
  foundedYear: number | undefined;
  members: CircleMemberView[];
  /** wide feed only — pending (unsealed) matches; the phone feed never shows these */
  pendingSeals: PendingSealCardData[];
}

export async function loadCircleContext(id: string, userId: string): Promise<CircleContext> {
  const store = await getCirclesStore();

  let detail;
  try {
    detail = await store.getCircleDetail(id, userId);
  } catch (err) {
    if (err instanceof NotMemberError) notFound();
    throw err;
  }
  if (!detail) notFound();

  const messages = await store.listMessages(id, userId);
  const allCircles = await store.listCirclesForUser(userId);

  const { db } = await getGamesClient();
  const sessionSummaries = await listUpcomingSessionsForCircle(db, id, userId);
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

  const { items, rivalry } = await listCircleFeed(db, id, userId);
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

  const unreadChatBadge = await getUnreadCountForCircle(db, id, userId);
  const gamesCount = await countVerifiedMatches(db, id);
  const pendingSeals = await loadPendingSealCards(db, id);

  // Home court: the Circle's most-used pinned venue (server/open-door.ts's
  // derived anchor — no schema column). Null until a Standing Game or session
  // pins a venue with coordinates.
  const anchorPoint = await circleAnchor(db, id);
  let anchor: EditAnchor | null = null;
  if (anchorPoint) {
    const [venue] = await db.select({ address: venues.address }).from(venues).where(eq(venues.id, anchorPoint.venueId));
    anchor = { venueName: anchorPoint.venueName, address: venue?.address ?? null };
  }

  const venueOptions: EditVenueOption[] = await db
    .select({ id: venues.id, name: venues.name })
    .from(venues)
    .where(and(isNotNull(venues.lat), isNotNull(venues.lng)))
    .orderBy(asc(venues.name));

  const homeCourtName = detail.homeVenueId ? detail.homeVenueName : (anchor?.venueName ?? null);
  const homeCourtExplicit = detail.homeVenueId != null;

  const pendingKnocks: KnockPanelItem[] =
    detail.myRole === "organiser"
      ? (await circleKnocks(db, id, userId)).map((k) => ({
          knockId: k.knockId,
          displayName: k.displayName,
          avatarUrl: k.avatarUrl,
          rating: k.rating,
          reliability: k.reliability,
          distanceLabel: k.distanceLabel,
          message: k.message,
        }))
      : [];

  const foundedYear = allCircles.find((c) => c.id === id)?.createdAt.getFullYear();
  const colour = detail.colour ?? circleColorFor(detail.id);

  return {
    currentUserId: userId,
    detail,
    colour,
    messages: serializeMessages(messages),
    allCircles,
    sessionCards,
    feedItems,
    rivalry: rivalry
      ? {
          opponentName: rivalry.opponentName,
          opponentAvatarUrl: detail.members.find((m) => m.userId === rivalry.opponentUserId)?.avatarUrl ?? null,
          count: rivalry.count,
          direction: rivalry.direction,
        }
      : null,
    unreadChatBadge,
    gamesCount,
    anchor,
    venueOptions,
    homeCourtName,
    homeCourtExplicit,
    pendingKnocks,
    foundedYear,
    members: detail.members,
    pendingSeals,
  };
}
