/**
 * Discover page composition — the READ model behind /discover (WEB-SHELL-SPEC
 * Wave B). Discover is a desktop-first restatement of two surfaces the phone
 * app already ships: The Board (public games with open slots near the viewer's
 * patch, server/discovery.ts) and Open Door (Circles open to join near the
 * patch, server/open-door.ts). This module ONLY composes those shipped read
 * models plus resolvePatch — it adds NO queries of its own beyond the viewer's
 * own Glass rating (needed for the level-band colouring below) and never
 * mutates. The knock actions the cards fire are the same endpoints the phone
 * Board / Open Door cards use (/api/knocks/session, /api/knocks/circle).
 *
 * Level band (the one piece of view logic this surface adds): the design
 * colours a game's dashed open slots CORAL when the game sits inside the
 * viewer's Glass band and GREY ("outside your band") when not. That is a pure
 * function of the viewer's rating and the game's confirmed ratings — see
 * `gameInViewerBand`, which reuses the shared GLASS_BAND half-width so the
 * colour matches the same ±band the rest of discovery reasons about.
 */
import { GLASS_BAND, glassBandFor } from "@/lib/geo";
import { boardGames, type BoardConfirmedPlayer } from "@/server/discovery";
import { nearbyCircles, type NearbyCircle } from "@/server/open-door";
import { resolvePatch } from "@/server/patch";
import type { CuatroDb } from "@cuatro/db";

/** A confirmed slot-holder as a Discover game card shows them (mirror of BoardConfirmedPlayer). */
export interface DiscoverConfirmedPlayer {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  rating: number | null;
  isGuest: boolean;
}

/** One "public game this week" card on Discover. */
export interface DiscoverGame {
  sessionId: string;
  circleId: string;
  circleName: string;
  circleColour: string | null;
  circleEmblem: string | null;
  venueName: string | null;
  /** UTC epoch ms — the client formats the local "when" label itself. */
  startsAtMs: number;
  slots: number;
  slotsOpen: number;
  confirmedCount: number;
  confirmed: DiscoverConfirmedPlayer[];
  distanceLabel: string;
  levelLine: string;
  /** True when the game overlaps the viewer's Glass band — drives coral vs grey open slots + the caption. */
  inBand: boolean;
  /** The viewer already has a pending ask on this session (card shows the waiting state). */
  viewerHasPendingKnock: boolean;
}

export interface DiscoverView {
  /** Null when the viewer has no resolvable patch → the "set your patch" empty state (server/patch.ts). */
  hasPatch: boolean;
  /** A short area label for the header subline, e.g. the home venue's name; null when nothing to name. */
  patchAreaLabel: string | null;
  /** The viewer's own Glass rating, for the (static) level-band filter chip; null while unrated. */
  viewerRating: number | null;
  games: DiscoverGame[];
  /** Only OPEN-tier Circles surface here (the "Circles open to join" heading); invite-only Circles reach players through their games in `games`. */
  openCircles: NearbyCircle[];
}

/**
 * Does this game sit inside the viewer's Glass band? True (coral slots) when:
 *  - the viewer is unrated (no band to be outside of — unrated matches any,
 *    the same "we don't know yet, don't exclude" rule the geo layer uses), or
 *  - the game has no rated confirmed players yet (unknown level → don't grey
 *    it out), or
 *  - the game's rated range [min,max] overlaps the viewer's ±GLASS_BAND window.
 * False (grey "outside your band") only when the viewer is rated, the game has
 * a known rated range, and that range lies wholly outside the viewer's band.
 */
export function gameInViewerBand(
  viewerRating: number | null,
  confirmedRatings: (number | null)[],
): boolean {
  const band = glassBandFor(viewerRating);
  if (!band) return true; // unrated viewer → no band filter
  const rated = confirmedRatings.filter((r): r is number => r != null);
  if (rated.length === 0) return true; // unknown game level → not "outside"
  const min = Math.min(...rated);
  const max = Math.max(...rated);
  return max >= viewerRating! - GLASS_BAND && min <= viewerRating! + GLASS_BAND;
}

function toConfirmed(players: BoardConfirmedPlayer[]): DiscoverConfirmedPlayer[] {
  return players.map((p) => ({
    userId: p.userId,
    displayName: p.displayName,
    avatarUrl: p.avatarUrl,
    rating: p.rating,
    isGuest: p.isGuest,
  }));
}

/**
 * Assemble the Discover view for a viewer. Composes resolvePatch + boardGames +
 * nearbyCircles; when there is no patch, returns the empty (set-your-patch)
 * shape without touching the discovery queries (they would return [] anyway,
 * but the gate reads clearer here). `viewerRating` and `patchAreaLabel` are
 * supplied by the caller (the page already loads the Glass view + can name the
 * home venue) so this module keeps to composing the discovery read models.
 */
export async function getDiscoverView(
  db: CuatroDb,
  viewerId: string,
  opts: { viewerRating: number | null; patchAreaLabel: string | null },
): Promise<DiscoverView> {
  const patch = await resolvePatch(db, viewerId);
  if (!patch) {
    return {
      hasPatch: false,
      patchAreaLabel: opts.patchAreaLabel,
      viewerRating: opts.viewerRating,
      games: [],
      openCircles: [],
    };
  }

  const [board, circles] = await Promise.all([
    boardGames(db, viewerId),
    nearbyCircles(db, viewerId),
  ]);

  const games: DiscoverGame[] = board.map((g) => ({
    sessionId: g.sessionId,
    circleId: g.circleId,
    circleName: g.circleName,
    circleColour: g.circleColour,
    circleEmblem: g.circleEmblem,
    venueName: g.venueName,
    startsAtMs: g.startsAt.getTime(),
    slots: g.slots,
    slotsOpen: g.slotsOpen,
    confirmedCount: g.confirmedCount,
    confirmed: toConfirmed(g.confirmed),
    distanceLabel: g.distanceLabel,
    levelLine: g.levelLine,
    inBand: gameInViewerBand(opts.viewerRating, g.confirmed.map((c) => c.rating)),
    viewerHasPendingKnock: g.viewerHasPendingKnock,
  }));

  // "Circles open to join" = OPEN tier only. Invite-only Circles already reach
  // a viewer through their open games (which appear in `games` above under the
  // Circle's name), so listing them again here as un-knockable cards would be
  // noise — the phone's /circles surface shows both tiers because it is the
  // membership home; Discover's circle rail is the join-a-group affordance.
  const openCircles = circles.filter((c) => c.tier === "open");

  return {
    hasPatch: true,
    patchAreaLabel: opts.patchAreaLabel,
    viewerRating: opts.viewerRating,
    games,
    openCircles,
  };
}
