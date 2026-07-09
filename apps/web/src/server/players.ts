import { and, count, eq, inArray } from "drizzle-orm";
import { circleMembers, sessions, users, venues } from "@cuatro/db";
import { getDb } from "@/server/db";
import {
  gamesTotals,
  getMatchesStore,
  type LedgerEntryView,
  type MatchHistorySummary,
  type ProfileGlassView,
} from "@/server/matches-db";
import { computeBestWin, computeStreak, type StreakInfo } from "@/components/glass/profile-stats";

/**
 * The public-profile read model. `/profile` (own) and `/players/[userId]`
 * (anyone) render the SAME transparency surface — Glass, confidence,
 * Reliability, stats, and the full append-only Ledger — so the data assembly
 * that used to live inline in the own-profile page is extracted here and
 * takes a `userId`. What's deliberately NOT here (private to the owner):
 * email, discovery/settings, The Tab, invite links. Composes the existing
 * matches-db + circles reads; adds no new query surface those files don't
 * already expose.
 */

export interface PlayerPublicUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isGuest: boolean;
}

/** One of the "Last three" result chips (W/L + game score, from the player's own perspective). */
export interface PlayerLastResult {
  id: string;
  won: boolean;
  label: string;
}

export interface PlayerProfile {
  user: PlayerPublicUser;
  glass: ProfileGlassView | null;
  history: MatchHistorySummary;
  /** The player's total Circle memberships (shown on their OWN profile). */
  circlesCount: number;
  /** Circles the viewer shares with this player (shown on a viewer's public view). Null when the viewer is the player. */
  circlesInCommon: number | null;
  sparklineValues: number[];
  deltaSinceFirst: number | null;
  streak: StreakInfo;
  bestWin: number | null;
  lastThree: (PlayerLastResult | null)[];
}

/**
 * Assembles a player's public profile. `viewerId` (when it differs from
 * `userId`) enables the cheap "circles in common" count. Returns null when
 * no such user exists — callers map that to the app's 404.
 */
export async function getPlayerProfile(userId: string, viewerId?: string): Promise<PlayerProfile | null> {
  const { db } = await getDb();
  const [row] = await db
    .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl, isGuest: users.isGuest })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;

  const store = await getMatchesStore();
  const [glass, history, entries] = await Promise.all([
    store.getProfileGlassView(userId),
    store.getMatchHistorySummary(userId),
    store.getLedger(userId), // newest-first — powers the sparkline, streak, best-win, and last-three chips
  ]);

  const [circlesRow] = await db.select({ n: count() }).from(circleMembers).where(eq(circleMembers.userId, userId));
  const circlesCount = circlesRow?.n ?? 0;

  let circlesInCommon: number | null = null;
  if (viewerId && viewerId !== userId) {
    const viewerCircles = await db
      .select({ circleId: circleMembers.circleId })
      .from(circleMembers)
      .where(eq(circleMembers.userId, viewerId));
    const viewerCircleIds = viewerCircles.map((c) => c.circleId);
    if (viewerCircleIds.length > 0) {
      const [commonRow] = await db
        .select({ n: count() })
        .from(circleMembers)
        .where(and(eq(circleMembers.userId, userId), inArray(circleMembers.circleId, viewerCircleIds)));
      circlesInCommon = commonRow?.n ?? 0;
    } else {
      circlesInCommon = 0;
    }
  }

  const sparklineValues = [...entries].reverse().map((e) => e.ratingAfter);
  const deltaSinceFirst = entries.length > 0 ? entries.reduce((sum, e) => sum + e.delta, 0) : null;
  const streak = computeStreak(entries);
  const bestWin = computeBestWin(entries);

  const lastThree = await Promise.all(
    entries.slice(0, 3).map(async (e) => {
      // getMatchDetail from the PLAYER's perspective (not the viewer's) so W/L
      // and the game split read as this player's own result.
      const detail = await store.getMatchDetail(e.matchId, userId);
      if (!detail || !detail.viewerTeam) return null;
      const { gamesWonA, gamesWonB } = gamesTotals(detail.match.score);
      const [yourGames, oppGames] = detail.viewerTeam === "A" ? [gamesWonA, gamesWonB] : [gamesWonB, gamesWonA];
      const won = e.delta >= 0;
      return { id: e.id, won, label: `${won ? "W" : "L"} ${yourGames}–${oppGames}` };
    }),
  );

  return {
    user: row,
    glass,
    history,
    circlesCount,
    circlesInCommon,
    sparklineValues,
    deltaSinceFirst,
    streak,
    bestWin,
    lastThree,
  };
}

/** One Ledger row with the display enrichment both Ledger surfaces render (opponent, score, venue). */
export interface LedgerEnrichedRow {
  entry: LedgerEntryView;
  opponentNames: string | null;
  score: string | null;
  venueName: string | null;
}

export interface PlayerLedger {
  user: PlayerPublicUser;
  glass: ProfileGlassView | null;
  rows: LedgerEnrichedRow[];
}

/**
 * Assembles a player's full Ledger with the "date · venue", opponent, and
 * score enrichment the Ledger screen shows. The venue join is a display-only
 * enrichment done here (not in matches-db.ts, owned elsewhere), same as the
 * own-ledger page did inline. Returns null when no such user exists.
 */
export async function getPlayerLedger(userId: string): Promise<PlayerLedger | null> {
  const { db } = await getDb();
  const [user] = await db
    .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl, isGuest: users.isGuest })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;

  const store = await getMatchesStore();
  const [glass, entries] = await Promise.all([store.getProfileGlassView(userId), store.getLedger(userId)]);

  const details = await Promise.all(entries.map((entry) => store.getMatchDetail(entry.matchId, userId)));

  const sessionIds = [...new Set(details.map((d) => d?.match.sessionId).filter((id): id is string => !!id))];
  const venueBySessionId = new Map<string, string>();
  if (sessionIds.length > 0) {
    const sessionRows = db.select({ id: sessions.id, venueId: sessions.venueId }).from(sessions).where(inArray(sessions.id, sessionIds)).all();
    const venueIds = [...new Set(sessionRows.map((r) => r.venueId).filter((id): id is string => !!id))];
    const venueRows = venueIds.length > 0 ? db.select({ id: venues.id, name: venues.name }).from(venues).where(inArray(venues.id, venueIds)).all() : [];
    const venueNameById = new Map(venueRows.map((v) => [v.id, v.name]));
    for (const sr of sessionRows) {
      const name = sr.venueId ? venueNameById.get(sr.venueId) : undefined;
      if (name) venueBySessionId.set(sr.id, name);
    }
  }

  const rows: LedgerEnrichedRow[] = entries.map((entry, i) => {
    const detail = details[i];
    if (!detail || !detail.viewerTeam) return { entry, opponentNames: null, score: null, venueName: null };
    const { gamesWonA, gamesWonB } = gamesTotals(detail.match.score);
    const [yourGames, oppGames] = detail.viewerTeam === "A" ? [gamesWonA, gamesWonB] : [gamesWonB, gamesWonA];
    const opponentIds =
      detail.viewerTeam === "A"
        ? [detail.match.teamBPlayer1Id, detail.match.teamBPlayer2Id]
        : [detail.match.teamAPlayer1Id, detail.match.teamAPlayer2Id];
    const opponentNames = opponentIds.map((id) => detail.players[id] ?? "someone").join(" & ");
    return { entry, opponentNames, score: `${yourGames}–${oppGames}`, venueName: venueBySessionId.get(detail.match.sessionId) ?? null };
  });

  return { user, glass, rows };
}
