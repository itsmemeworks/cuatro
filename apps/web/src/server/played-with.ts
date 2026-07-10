/**
 * THE PLAYED-WITH RING — Fourth Call ring 2a's candidate query.
 *
 * Pete's intent: "prioritize my mates in my own circles first, then players
 * I've played with before, from any circle. That makes more sense than
 * randomly inviting people you've never had a connection with." So the Fourth
 * Call ladder is now connection-first: ring 1 (this circle) -> ring 2a (people
 * you've played with) -> ring 2b (the geo Local Ring) -> ring 3 (share link).
 *
 * This module answers one question, as a pure read-only query: given a game
 * short a player, WHO has actually shared a court with the four already in?
 * A played-with candidate is a distinct player who appears on the roster of at
 * least one VERIFIED match alongside any of this session's confirmed
 * slot-holders. That is a real, earned connection (you've played together),
 * not proximity on a map.
 *
 * Like server/local-ring.ts, the escalation around this (writing the invites,
 * the never-nag-twice gate, realtime) lives in games-service.ts's
 * checkFourthCallPlayedWith, which consumes this. It is async (a couple of
 * reads), so it runs OUTSIDE any better-sqlite3 transaction; the caller does
 * the synchronous insert once it holds the list.
 *
 * Exclusions (who is NOT a played-with candidate):
 *   - the confirmed slot-holders themselves,
 *   - members of this session's circle (they are ring 1's job),
 *   - guests, and anyone who opted out of discovery (findable = 0),
 *   - anyone already in or reserve on this session,
 *   - anyone already invited/notified for this Fourth Call (never nag twice;
 *     the caller threads this in as excludeUserIds, same as the geo ring).
 *
 * Ordering: connection strength first (how many verified matches you've shared
 * with the four), recency as the tiebreak (played together more recently wins),
 * then Reliability (attendance). Capped at the same fan-out as the geo ring.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import { circleMembers, matches, rsvps, sessions, users, type CuatroDb } from "@cuatro/db";

/** Never reach the whole address book: one escalation invites at most this many played-with players (matches the geo ring's cap). */
export const PLAYED_WITH_FANOUT_CAP = 8;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlayedWithCandidate {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  rating: number | null;
  /** Show-up rate as a fraction 0..1, or null when the player has no RSVP history yet. */
  reliability: number | null;
  /** How many verified matches this player has shared with any of the session's confirmed four. */
  sharedMatchCount: number;
  /** Epoch ms of the most recent shared match — for ordering only; the UI shows lastPlayedWithLabel. */
  lastPlayedWithMs: number;
  /** Coarse, warm, no em dashes, e.g. "played together 3 times, last played in the last month". */
  lastPlayedWithLabel: string;
}

export interface PlayedWithOptions {
  limit?: number;
  /** Players to leave out entirely — the escalation passes everyone already invited/declined for this session (never nag twice). */
  excludeUserIds?: string[];
  /** For the recency label; defaults to now. */
  now?: Date;
}

/** Coarse "how long ago" phrase — deliberately fuzzy (no exact dates leaked, no em dashes), reads after "last played ". */
function coarseAgo(lastMs: number, now: number): string {
  const days = (now - lastMs) / DAY_MS;
  if (days < 7) return "in the last week";
  if (days < 31) return "in the last month";
  if (days < 93) return "in the last few months";
  if (days < 365) return "earlier this year";
  return "over a year ago";
}

function playedWithLabel(count: number, lastMs: number, now: number): string {
  const times = count === 1 ? "played together once" : `played together ${count} times`;
  return `${times}, last played ${coarseAgo(lastMs, now)}`;
}

function rosterOf(m: {
  teamAPlayer1Id: string;
  teamAPlayer2Id: string;
  teamBPlayer1Id: string;
  teamBPlayer2Id: string;
}): string[] {
  return [m.teamAPlayer1Id, m.teamAPlayer2Id, m.teamBPlayer1Id, m.teamBPlayer2Id];
}

/**
 * Players who've shared a verified match with this session's confirmed
 * slot-holders, ordered by connection strength (shared-match count), recency,
 * then Reliability, capped at `limit` (default {@link PLAYED_WITH_FANOUT_CAP}).
 *
 * Returns [] when the session has no confirmed players yet (there's no roster
 * to derive a connection from) or when nobody outside the circle qualifies.
 */
export async function playedWithCandidates(
  db: CuatroDb,
  sessionId: string,
  options: PlayedWithOptions = {},
): Promise<PlayedWithCandidate[]> {
  const limit = options.limit ?? PLAYED_WITH_FANOUT_CAP;
  const now = (options.now ?? new Date()).getTime();

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!session) return [];

  // The four we're finding a player for: this session's confirmed slot-holders.
  const confirmed = await db
    .select({ userId: rsvps.userId })
    .from(rsvps)
    .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "in")));
  const confirmedIds = confirmed.map((c) => c.userId);
  if (confirmedIds.length === 0) return []; // no roster to connect through

  // Every verified match with at least one of the confirmed four on court.
  const verified = await db
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.status, "verified"),
        or(
          inArray(matches.teamAPlayer1Id, confirmedIds),
          inArray(matches.teamAPlayer2Id, confirmedIds),
          inArray(matches.teamBPlayer1Id, confirmedIds),
          inArray(matches.teamBPlayer2Id, confirmedIds),
        ),
      ),
    );
  if (verified.length === 0) return [];

  // Accumulate, per co-player, the count of shared verified matches and the
  // most recent one. One match counts once per co-player even if two of the
  // confirmed four were on it (it's still a single shared game).
  const confirmedSet = new Set(confirmedIds);
  const acc = new Map<string, { count: number; lastMs: number }>();
  for (const m of verified) {
    const coPlayers = new Set(rosterOf(m).filter((id) => !confirmedSet.has(id)));
    const playedMs = m.playedAt.getTime();
    for (const id of coPlayers) {
      const cur = acc.get(id) ?? { count: 0, lastMs: 0 };
      cur.count += 1;
      cur.lastMs = Math.max(cur.lastMs, playedMs);
      acc.set(id, cur);
    }
  }
  const candidateIds = [...acc.keys()];
  if (candidateIds.length === 0) return [];

  // Structural exclusions: this circle's members (ring 1 reaches them), anyone
  // already in/reserve on the session, and the caller's never-nag-twice set.
  const memberRows = await db
    .select({ userId: circleMembers.userId })
    .from(circleMembers)
    .where(eq(circleMembers.circleId, session.circleId));
  const circleMemberSet = new Set(memberRows.map((r) => r.userId));

  const participantRows = await db
    .select({ userId: rsvps.userId })
    .from(rsvps)
    .where(and(eq(rsvps.sessionId, sessionId), inArray(rsvps.status, ["in", "reserve"])));
  const participantSet = new Set(participantRows.map((r) => r.userId));

  const excludeSet = new Set(options.excludeUserIds ?? []);

  const userRows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      rating: users.rating,
      isGuest: users.isGuest,
      findable: users.findable,
      showUpCount: users.showUpCount,
      rsvpInCount: users.rsvpInCount,
    })
    .from(users)
    .where(inArray(users.id, candidateIds));

  const candidates: PlayedWithCandidate[] = userRows
    .filter(
      (u) =>
        !u.isGuest &&
        u.findable &&
        !circleMemberSet.has(u.id) &&
        !participantSet.has(u.id) &&
        !excludeSet.has(u.id),
    )
    .map((u) => {
      const a = acc.get(u.id)!;
      return {
        userId: u.id,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        rating: u.rating,
        reliability: u.rsvpInCount > 0 ? Math.min(1, u.showUpCount / u.rsvpInCount) : null,
        sharedMatchCount: a.count,
        lastPlayedWithMs: a.lastMs,
        lastPlayedWithLabel: playedWithLabel(a.count, a.lastMs, now),
      };
    });

  candidates.sort((x, y) => {
    // Connection strength first: more shared matches wins.
    if (x.sharedMatchCount !== y.sharedMatchCount) return y.sharedMatchCount - x.sharedMatchCount;
    // Recency tiebreak: played together more recently wins.
    if (x.lastPlayedWithMs !== y.lastPlayedWithMs) return y.lastPlayedWithMs - x.lastPlayedWithMs;
    // Then Reliability: a track record beats none; higher shows-up-rate wins.
    const rx = x.reliability;
    const ry = y.reliability;
    if (rx != null && ry != null && rx !== ry) return ry - rx;
    if (rx == null && ry != null) return 1;
    if (rx != null && ry == null) return -1;
    return 0;
  });

  return candidates.slice(0, limit);
}
