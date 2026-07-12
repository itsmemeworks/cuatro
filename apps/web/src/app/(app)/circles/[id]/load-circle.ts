import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { matches, sessions, users, venues, type CuatroDb } from "@cuatro/db";
import { computeWinner } from "@/server/matches-db";
import {
  NotMemberError,
  NotOrganiserError,
  getCirclesStore,
  type CircleMessageView,
  type CircleDetail,
  type CircleMemberView,
  type CircleSummary,
} from "@/server/circles";
import { getGamesClient } from "@/server/games-db";
import { listUpcomingSessionsForCircle, isFourthCallActive } from "@/server/games-service";
import { listStandingGamesForCircle } from "@/server/standing-games-service";
import { resolveMoneyOptIn, type MoneyOptIn } from "@/lib/booking";
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
 * count, not a new server export. Counts the circle's SESSIONS (played and on
 * the calendar, cancelled excluded): counting verified matches here rendered
 * "0 games" on a circle whose own Games tab listed five fixtures (QA4) — a
 * circle records its first result long after its first game exists, so the
 * header fact must agree with the calendar the members can see.
 */
async function countCircleGames(db: CuatroDb, circleId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`cast(count(*) as int)` })
    .from(sessions)
    .where(and(eq(sessions.circleId, circleId), ne(sessions.status, "cancelled")));
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
/**
 * A Standing Game as the wide Settings panel shows it (design "Circle ·
 * Settings" right column): the fixture facts, rotation posture, and the
 * resolved money opt-in (booking signpost XOR court cost XOR silence).
 * Serializable — it crosses into client components.
 */
export interface SettingsStandingGameView {
  id: string;
  weekday: number;
  startTime: string;
  durationMinutes: number;
  slots: number;
  active: boolean;
  rotationEnabled: boolean;
  rotationCutoffHours: number;
  rotationMode: "limited" | "unlimited";
  gameType: "competitive" | "friendly";
  venueName: string | null;
  moneyOptIn: MoneyOptIn;
}

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
  /** Issue #21: the primary (pinned) session's resolved money opt-in — the pinned bar shows a BookingChip when it's a booking. Null = silence. */
  pinnedMoneyOptIn: MoneyOptIn;
  /** Organiser-only (empty otherwise): the Circle's Standing Games for the wide Settings panel. */
  settingsStandingGames: SettingsStandingGameView[];
}

/**
 * The organiser panel's pending knocks, CAPABILITY-GATED (fix wave F3,
 * Sentry CUATRO-7 / QA2's post-hand-back error boundary): `myRole` comes from
 * a getCircleDetail read a few awaits earlier, and circleKnocks re-checks the
 * role itself — a transfer/removal committing BETWEEN the two reads made the
 * second throw NotOrganiserError straight into the members page's error
 * boundary. Losing the role mid-request just means the viewer gets the member
 * view (no knock queue), never a crash; the next render reads the fresh role.
 * Exported for the capability-gate test (test/circle-knocks-gate.test.ts).
 */
export async function pendingKnockItems(
  db: CuatroDb,
  circleId: string,
  userId: string,
  myRole: "organiser" | "member",
): Promise<KnockPanelItem[]> {
  if (myRole !== "organiser") return [];
  try {
    return (await circleKnocks(db, circleId, userId)).map((k) => ({
      knockId: k.knockId,
      displayName: k.displayName,
      avatarUrl: k.avatarUrl,
      rating: k.rating,
      confidence: k.confidence,
      reliability: k.reliability,
      distanceLabel: k.distanceLabel,
      message: k.message,
    }));
  } catch (err) {
    if (err instanceof NotOrganiserError || err instanceof NotMemberError) return [];
    throw err;
  }
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
  // Mirrors home/page.tsx toSessionCardData exactly (fix-wave F4 follow-on):
  // rotation games show the provisional/locked four with the availability
  // affordance — a bare RSVP mapping here recreated QA8's self-contradicting
  // card on the circle feed after home was fixed.
  const sessionCards: SessionCardData[] = sessionSummaries.map((s) => {
    const rotationLocked = s.rotation?.lockedAt != null;
    return {
      sessionId: s.session.id,
      circleId: s.circleId,
      circleName: s.circleName,
      circleColour: s.circleColour,
      circleEmblem: s.circleEmblem,
      venueName: s.venue?.name ?? null,
      startsAt: new Date(s.session.startsAt),
      timezone: s.timezone,
      slots: s.slots,
      confirmed: s.rotation ? s.rotation.lineup : s.confirmed,
      reserves: s.rotation ? s.rotation.sitting : s.reserves,
      viewerStatus: s.viewerStatus,
      rsvpWindowOpensAt: s.rsvpWindowOpensAt,
      fourthCallActive: s.rotation && !rotationLocked ? false : isFourthCallActive(s),
      rotation: s.rotation
        ? { locked: rotationLocked, viewerAvailable: s.rotation.viewerAvailable, availableCount: s.rotation.available.length }
        : null,
      moneyOptIn: s.moneyOptIn,
    };
  });

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
  const gamesCount = await countCircleGames(db, id);
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

  const pendingKnocks = await pendingKnockItems(db, id, userId, detail.myRole);

  // Issue #21: resolve the pinned (first upcoming) session's money opt-in from
  // the rows the summary already carries — booking silences cost, default is
  // silence. The pinned bar renders a BookingChip only for the booking kind.
  const primarySummary = sessionSummaries[0] ?? null;
  const pinnedMoneyOptIn = primarySummary
    ? resolveMoneyOptIn({ session: primarySummary.session, standingGame: primarySummary.standingGame })
    : null;

  // The wide Settings panel's standing-game cards (organiser only — the tab
  // itself is organiser-gated, so members never pay for this read).
  let settingsStandingGames: SettingsStandingGameView[] = [];
  if (detail.myRole === "organiser") {
    const standingGameRows = await listStandingGamesForCircle(db, id);
    const venueIds = [...new Set(standingGameRows.map((sg) => sg.venueId).filter((v): v is string => v != null))];
    const venueRows = venueIds.length
      ? await db.select({ id: venues.id, name: venues.name }).from(venues).where(inArray(venues.id, venueIds))
      : [];
    const venueNameById = new Map(venueRows.map((v) => [v.id, v.name]));
    settingsStandingGames = standingGameRows.map((sg) => ({
      id: sg.id,
      weekday: sg.weekday,
      startTime: sg.startTime,
      durationMinutes: sg.durationMinutes,
      slots: sg.slots,
      active: sg.active,
      rotationEnabled: sg.rotationEnabled,
      rotationCutoffHours: sg.rotationCutoffHours,
      rotationMode: sg.rotationMode,
      gameType: sg.gameType,
      venueName: sg.venueId ? (venueNameById.get(sg.venueId) ?? null) : null,
      moneyOptIn: resolveMoneyOptIn({ standingGame: sg }),
    }));
  }

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
    pinnedMoneyOptIn,
    settingsStandingGames,
  };
}
