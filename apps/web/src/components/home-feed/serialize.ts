import type { BoardGame } from "@/server/discovery";
import type { HomeFeedItem } from "@/server/home-feed";
import type { BoardCardProps } from "@/components/games/board-card";
import type { HomeFeedItemData } from "./home-feed-section";

/**
 * server/home-feed.ts → client-serializable view data. Lives beside the
 * section component (not in the server module) so the server aggregate stays
 * import-light and the Date→string/label decisions sit with the UI that
 * renders them.
 */

/** One shared Board→card mapping — the /home page's "Near you" section and the home feed both use it, so the two can never drift. */
export function boardGameToCardProps(g: BoardGame): BoardCardProps {
  return {
    sessionId: g.sessionId,
    circleId: g.circleId,
    circleName: g.circleName,
    circleColour: g.circleColour,
    circleEmblem: g.circleEmblem,
    venueName: g.venueName,
    whenLabel: g.startsAt.toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }),
    distanceLabel: g.distanceLabel,
    levelLine: g.levelLine,
    slotsOpen: g.slotsOpen,
    confirmed: g.confirmed,
    initialPending: g.viewerHasPendingKnock,
  };
}

/** "Thu 20:00" in the session's own timezone (same recipe as circle-tabs' formatWhen, but per-session tz per the world-ready rule). */
function slotWhenLabel(startsAt: number, timezone: string): string {
  return new Date(startsAt)
    .toLocaleString("en-GB", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit" })
    .replace(",", "");
}

export function serializeHomeFeedItems(items: HomeFeedItem[]): HomeFeedItemData[] {
  return items.map((item): HomeFeedItemData => {
    switch (item.kind) {
      case "result":
        return {
          kind: "result",
          circle: item.circle,
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
        };
      case "placement_reveal":
        return {
          kind: "placement_reveal",
          circle: item.circle,
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
        };
      case "open_slot":
        return {
          kind: "open_slot",
          slot: {
            sessionId: item.slot.sessionId,
            circleId: item.slot.circleId,
            circleName: item.slot.circleName,
            circleColour: item.slot.circleColour,
            circleEmblem: item.slot.circleEmblem,
            venueName: item.slot.venueName,
            whenLabel: slotWhenLabel(item.slot.startsAt, item.slot.timezone),
            slotsOpen: item.slot.slotsOpen,
          },
        };
      case "board_game":
        return { kind: "board_game", game: boardGameToCardProps(item.game) };
    }
  });
}
