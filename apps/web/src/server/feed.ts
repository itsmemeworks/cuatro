/**
 * Circle Feed read model: verified-match result posts, placement-reveal
 * posts, and the rivalry/streak callout (design/HANDOFF.md screen 4,
 * design/DESIGN-AUDIT.md F2). Lives apart from server/circles.ts (which owns
 * Circle/chat persistence) and server/matches-db.ts (which owns a single
 * match's own record/confirm/dispute lifecycle) because this is a third
 * thing — a circle-scoped aggregation *over* already-verified matches —
 * rather than a mutation on either.
 *
 * 👏 Respect is the one reaction kind in v0 (see @cuatro/db's
 * match_reactions table); 💬 counts come from server/comments.ts's
 * match_comments table (design/DESIGN-AUDIT.md F1) — this module only reads
 * counts, comment CRUD itself lives there.
 *
 * `listCircleFeed` is the canonical Feed data source (result posts ∪
 * placement reveals, merged and time-sorted — see FeedItem):
 * `listRecentResultsForCircle` stays around, unchanged in shape, purely for
 * backward compatibility with existing callers/tests that only want result
 * posts.
 */
import { and, desc, eq, inArray, like } from "drizzle-orm";
import {
  circleMembers,
  matchReactions,
  matches,
  ratingEvents,
  sessions,
  standingGames,
  users,
  type CuatroDb,
  type SetScore,
} from "@cuatro/db";
import { PLACEMENT_TRIO_SIZE, type MatchOutcome } from "@cuatro/glass";
import { computeWinner, PLACEMENT_REVEAL_EXPLANATION_PREFIX } from "./matches-db";
import { getCommentCounts } from "./comments";
import { emitCircleEvent } from "@/lib/realtime/broadcast";

/** A streak below this length isn't a "rivalry" yet — just a couple of results. */
export const MIN_RIVALRY_STREAK = 3;
const DEFAULT_FEED_LIMIT = 10;

export interface FeedPlayerRef {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface ResultPostTeam {
  players: FeedPlayerRef[];
  /** Average of both players' Ledger delta for this match; null when the match was skipped by the Glass engine (walkover, or a retired match with no games — see matches-db.ts's applyGlassAndPersist). */
  avgDelta: number | null;
}

export interface ResultPostView {
  matchId: string;
  sessionId: string;
  playedAt: Date;
  sets: SetScore[];
  outcome: MatchOutcome;
  winner: "A" | "B";
  teamA: ResultPostTeam;
  teamB: ResultPostTeam;
  respectCount: number;
  viewerRespected: boolean;
  commentCount: number;
  /** "rematch?" creates nothing — links to the circle's standing game page, or the circle itself if it has none. */
  rematchHref: string;
}

/**
 * "P finished her Placement Trio — Glass revealed: 4.15 / 3 verified games ·
 * confidence 41%" (design/DESIGN-AUDIT.md C5) — one item per player whose
 * Trio completed on `matchId`. `matchId` is the triggering match, so 👏
 * Respect reuses match_reactions/toggleRespect exactly as a result post does
 * (see listCircleFeed's header note on why that's trivial here).
 */
export interface PlacementRevealView {
  ratingEventId: string;
  matchId: string;
  playedAt: Date;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  rating: number;
  confidencePct: number;
  verifiedGamesRequired: number;
  respectCount: number;
  viewerRespected: boolean;
}

export type FeedItem =
  | { kind: "result"; post: ResultPostView }
  | { kind: "placement_reveal"; reveal: PlacementRevealView };

export interface RivalryCallout {
  opponentUserId: string;
  opponentName: string;
  /** Consecutive matches, most-recent-first, with the same result for this specific viewer/opponent pairing. */
  count: number;
  direction: "beaten" | "lost_to";
}

interface StreakMatch {
  id: string;
  playedAt: Date;
  teamA: readonly [string, string];
  teamB: readonly [string, string];
  winner: "A" | "B";
}

/**
 * Pure (no DB): the viewer's current head-to-head streak against whichever
 * opponent it's longest against, "pairwise player-vs-player" per the
 * design brief — a doubles match contributes one data point per opponent
 * the viewer's team played against (i.e. up to two per match), not one per
 * whole match. Ties in `playedAt` (millisecond timestamps, and a fixture
 * only ever plays one match per session in v0) are broken by `id` so the
 * "most recent first" ordering — and therefore the streak itself — is
 * deterministic rather than dependent on array insertion order.
 */
export function computeRivalryCallout(
  matchesForViewer: StreakMatch[],
  viewerId: string,
  nameOf: (userId: string) => string,
): RivalryCallout | null {
  const sorted = [...matchesForViewer].sort((a, b) => {
    const byTime = b.playedAt.getTime() - a.playedAt.getTime();
    if (byTime !== 0) return byTime;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });

  // Newest-first list of {won} per opponent the viewer has faced.
  const perOpponent = new Map<string, boolean[]>();
  for (const m of sorted) {
    const viewerTeam = m.teamA.includes(viewerId) ? "A" : m.teamB.includes(viewerId) ? "B" : null;
    if (!viewerTeam) continue;
    const opponentTeam = viewerTeam === "A" ? m.teamB : m.teamA;
    const won = m.winner === viewerTeam;
    for (const opponentId of opponentTeam) {
      if (opponentId === viewerId) continue;
      const list = perOpponent.get(opponentId) ?? [];
      list.push(won);
      perOpponent.set(opponentId, list);
    }
  }

  let best: RivalryCallout | null = null;
  for (const [opponentId, results] of perOpponent) {
    const mostRecent = results[0];
    let count = 0;
    // A streak is broken the moment a result flips — the first divergence
    // from the most recent outcome ends it, so a 3-win / 1-loss / 2-win
    // history against the same opponent reports a *current* streak of 2,
    // not 5 (the loss resets it rather than merely interrupting a count).
    for (const won of results) {
      if (won !== mostRecent) break;
      count++;
    }
    if (count < MIN_RIVALRY_STREAK) continue;
    if (!best || count > best.count) {
      best = { opponentUserId: opponentId, opponentName: nameOf(opponentId), count, direction: mostRecent ? "beaten" : "lost_to" };
    }
  }
  return best;
}

function isMember(db: CuatroDb, circleId: string, userId: string): boolean {
  return !!db
    .select({ userId: circleMembers.userId })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)))
    .get();
}

/** Every verified match ever played in this circle's sessions, newest first. */
function loadVerifiedMatches(db: CuatroDb, circleId: string) {
  return db
    .select({ match: matches })
    .from(matches)
    .innerJoin(sessions, eq(matches.sessionId, sessions.id))
    .where(and(eq(sessions.circleId, circleId), eq(matches.status, "verified")))
    .orderBy(desc(matches.playedAt))
    .all()
    .map((r) => r.match);
}

function fourIds(m: { teamAPlayer1Id: string; teamAPlayer2Id: string; teamBPlayer1Id: string; teamBPlayer2Id: string }) {
  return [m.teamAPlayer1Id, m.teamAPlayer2Id, m.teamBPlayer1Id, m.teamBPlayer2Id];
}

/**
 * The Feed's result posts (most recent `limit`, default 10) plus the
 * viewer's rivalry callout computed over the circle's full verified-match
 * history. Callers (circle-tabs.tsx via the circle page) are expected to
 * have already verified circle membership — this mirrors
 * listUpcomingSessionsForCircle's trust boundary in games-service.ts, not
 * server/circles.ts's own store methods, which gate independently.
 */
export function listRecentResultsForCircle(
  db: CuatroDb,
  circleId: string,
  viewerUserId: string,
  limit = DEFAULT_FEED_LIMIT,
): { posts: ResultPostView[]; rivalry: RivalryCallout | null } {
  const allMatches = loadVerifiedMatches(db, circleId);
  if (allMatches.length === 0) return { posts: [], rivalry: null };

  const displayMatches = allMatches.slice(0, limit);
  const matchIds = displayMatches.map((m) => m.id);

  const allUserIds = [...new Set(allMatches.flatMap(fourIds))];
  const userRows = db.select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl }).from(users).where(inArray(users.id, allUserIds)).all();
  const userById = new Map(userRows.map((u) => [u.id, u]));
  const nameOf = (userId: string) => userById.get(userId)?.displayName ?? "Unknown";
  const refOf = (userId: string): FeedPlayerRef => {
    const u = userById.get(userId);
    return { userId, displayName: u?.displayName ?? "Unknown", avatarUrl: u?.avatarUrl ?? null };
  };

  const deltaRows = matchIds.length
    ? db.select({ matchId: ratingEvents.matchId, userId: ratingEvents.userId, delta: ratingEvents.delta }).from(ratingEvents).where(inArray(ratingEvents.matchId, matchIds)).all()
    : [];
  const deltaByMatch = new Map<string, Map<string, number>>();
  for (const row of deltaRows) {
    if (!deltaByMatch.has(row.matchId)) deltaByMatch.set(row.matchId, new Map());
    deltaByMatch.get(row.matchId)!.set(row.userId, row.delta);
  }

  const reactionRows = matchIds.length
    ? db.select({ matchId: matchReactions.matchId, userId: matchReactions.userId }).from(matchReactions).where(and(inArray(matchReactions.matchId, matchIds), eq(matchReactions.kind, "respect"))).all()
    : [];
  const reactionsByMatch = new Map<string, string[]>();
  for (const row of reactionRows) {
    const list = reactionsByMatch.get(row.matchId) ?? [];
    list.push(row.userId);
    reactionsByMatch.set(row.matchId, list);
  }

  const activeStandingGame = db.select({ id: standingGames.id }).from(standingGames).where(and(eq(standingGames.circleId, circleId), eq(standingGames.active, true))).get();
  const rematchHref = activeStandingGame ? `/games/standing/${activeStandingGame.id}` : `/circles/${circleId}`;

  const commentCounts = getCommentCounts(db, matchIds);

  function teamDelta(deltas: Map<string, number> | undefined, playerIds: readonly [string, string]): number | null {
    if (!deltas) return null;
    const values = playerIds.map((id) => deltas.get(id)).filter((v): v is number => v != null);
    if (values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  const posts: ResultPostView[] = displayMatches.map((m) => {
    const deltas = deltaByMatch.get(m.id);
    const reactorIds = reactionsByMatch.get(m.id) ?? [];
    return {
      matchId: m.id,
      sessionId: m.sessionId,
      playedAt: m.playedAt,
      sets: m.score,
      outcome: m.outcome,
      winner: computeWinner(m.score),
      teamA: { players: [refOf(m.teamAPlayer1Id), refOf(m.teamAPlayer2Id)], avgDelta: teamDelta(deltas, [m.teamAPlayer1Id, m.teamAPlayer2Id]) },
      teamB: { players: [refOf(m.teamBPlayer1Id), refOf(m.teamBPlayer2Id)], avgDelta: teamDelta(deltas, [m.teamBPlayer1Id, m.teamBPlayer2Id]) },
      respectCount: reactorIds.length,
      viewerRespected: reactorIds.includes(viewerUserId),
      commentCount: commentCounts.get(m.id) ?? 0,
      rematchHref,
    };
  });

  const streakMatches: StreakMatch[] = allMatches.map((m) => ({
    id: m.id,
    playedAt: m.playedAt,
    teamA: [m.teamAPlayer1Id, m.teamAPlayer2Id],
    teamB: [m.teamBPlayer1Id, m.teamBPlayer2Id],
    winner: computeWinner(m.score),
  }));
  const rivalry = computeRivalryCallout(streakMatches, viewerUserId, nameOf);

  return { posts, rivalry };
}

/**
 * The canonical Feed data source (design/DESIGN-AUDIT.md F2): result posts
 * ∪ placement-reveal posts, time-sorted together and capped to `limit`
 * overall. Wraps listRecentResultsForCircle for the result-post half rather
 * than re-querying — a placement reveal's `matchId` is always one of the
 * same `displayMatches` that call already loaded (a reveal is written on
 * the very match that completed someone's Trio), so `posts` already carries
 * everything a reveal needs to reuse for 👏 Respect (see
 * PlacementRevealView's header note).
 */
export function listCircleFeed(
  db: CuatroDb,
  circleId: string,
  viewerUserId: string,
  limit = DEFAULT_FEED_LIMIT,
): { items: FeedItem[]; rivalry: RivalryCallout | null } {
  const { posts, rivalry } = listRecentResultsForCircle(db, circleId, viewerUserId, limit);
  if (posts.length === 0) return { items: [], rivalry };

  const matchIds = posts.map((p) => p.matchId);
  const postByMatchId = new Map(posts.map((p) => [p.matchId, p]));

  const revealRows = db
    .select({
      id: ratingEvents.id,
      matchId: ratingEvents.matchId,
      userId: ratingEvents.userId,
      ratingAfter: ratingEvents.ratingAfter,
      confidenceAfter: ratingEvents.confidenceAfter,
    })
    .from(ratingEvents)
    .where(and(inArray(ratingEvents.matchId, matchIds), like(ratingEvents.explanation, `${PLACEMENT_REVEAL_EXPLANATION_PREFIX}%`)))
    .all();

  const revealUserIds = [...new Set(revealRows.map((r) => r.userId))];
  const revealUsers = revealUserIds.length
    ? db.select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl }).from(users).where(inArray(users.id, revealUserIds)).all()
    : [];
  const revealUserById = new Map(revealUsers.map((u) => [u.id, u]));

  const reveals: PlacementRevealView[] = revealRows.map((r) => {
    const post = postByMatchId.get(r.matchId)!;
    const u = revealUserById.get(r.userId);
    return {
      ratingEventId: r.id,
      matchId: r.matchId,
      playedAt: post.playedAt,
      userId: r.userId,
      displayName: u?.displayName ?? "Unknown",
      avatarUrl: u?.avatarUrl ?? null,
      rating: r.ratingAfter,
      confidencePct: Math.round(r.confidenceAfter * 100),
      verifiedGamesRequired: PLACEMENT_TRIO_SIZE,
      respectCount: post.respectCount,
      viewerRespected: post.viewerRespected,
    };
  });

  function timeOf(item: FeedItem): number {
    return (item.kind === "result" ? item.post.playedAt : item.reveal.playedAt).getTime();
  }
  function sortIdOf(item: FeedItem): string {
    return item.kind === "result" ? item.post.matchId : item.reveal.ratingEventId;
  }

  const items: FeedItem[] = [
    ...posts.map((post): FeedItem => ({ kind: "result", post })),
    ...reveals.map((reveal): FeedItem => ({ kind: "placement_reveal", reveal })),
  ]
    .sort((a, b) => {
      const byTime = timeOf(b) - timeOf(a);
      if (byTime !== 0) return byTime;
      const aId = sortIdOf(a);
      const bId = sortIdOf(b);
      return aId < bId ? 1 : aId > bId ? -1 : 0;
    })
    .slice(0, limit);

  return { items, rivalry };
}

export type ToggleRespectOutcome =
  | { ok: true; respected: boolean; count: number }
  | { ok: false; error: "match_not_found" | "match_not_verified" | "not_a_circle_member" };

/**
 * Toggle the viewer's 👏 Respect on a verified match — members of the
 * match's circle only (mirrors server/circles.ts's membership gate, applied
 * here rather than delegated to it since this module owns match_reactions).
 * Idempotent by construction: the unique (match, user, kind) index means a
 * double-tap either inserts once or deletes the one row that exists, never
 * accumulates duplicates.
 */
export function toggleRespect(db: CuatroDb, matchId: string, userId: string): ToggleRespectOutcome {
  let circleId: string | undefined;

  const outcome = db.transaction((tx): ToggleRespectOutcome => {
    const match = tx.select().from(matches).where(eq(matches.id, matchId)).get();
    if (!match) return { ok: false, error: "match_not_found" };
    if (match.status !== "verified") return { ok: false, error: "match_not_verified" };

    const session = tx.select({ circleId: sessions.circleId }).from(sessions).where(eq(sessions.id, match.sessionId)).get();
    if (!session) return { ok: false, error: "match_not_found" };
    circleId = session.circleId;

    if (!isMember(tx, session.circleId, userId)) return { ok: false, error: "not_a_circle_member" };

    const existing = tx
      .select({ id: matchReactions.id })
      .from(matchReactions)
      .where(and(eq(matchReactions.matchId, matchId), eq(matchReactions.userId, userId), eq(matchReactions.kind, "respect")))
      .get();

    if (existing) {
      tx.delete(matchReactions).where(eq(matchReactions.id, existing.id)).run();
    } else {
      tx.insert(matchReactions).values({ matchId, userId, kind: "respect" }).run();
    }

    const count = tx
      .select({ userId: matchReactions.userId })
      .from(matchReactions)
      .where(and(eq(matchReactions.matchId, matchId), eq(matchReactions.kind, "respect")))
      .all().length;

    return { ok: true, respected: !existing, count };
  });

  if (outcome.ok && circleId) {
    emitCircleEvent(circleId, "reaction", { matchId });
  }
  return outcome;
}
