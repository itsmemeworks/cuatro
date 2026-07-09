/**
 * Result-entry + Glass persistence, backed by @cuatro/db (drizzle + better-sqlite3).
 * `createMatchesStore(dbPath?)` opens its own isolated client (what the
 * test suite uses); the process-wide `getMatchesStore()` singleton instead
 * shares the one connection in ./db.ts with the games surface (games-db.ts)
 * — see that file's header for why.
 *
 * Ownership boundary: this file owns everything under matches/confirmations/
 * rating_events/notifications writes. It does NOT touch packages/db schema —
 * see the "schema gap" note on `computeWinner` for the one place this bit.
 *
 * Transaction model: better-sqlite3 is synchronous, and drizzle's
 * `db.transaction()` for this driver requires a synchronous callback (no
 * `await` inside it) — see node_modules/drizzle-orm/better-sqlite3/session.d.ts
 * (`transaction<T>(cb: (tx) => T): T`, not `Promise<T>`). If the callback were
 * async, the transaction would COMMIT before any awaited statement inside it
 * actually ran. Every transaction body below therefore uses tx.run()/.get()/
 * .all() exclusively, never `await`, and any async work (e.g. loading the
 * session row for its playedAt) happens before the transaction starts.
 */
import { and, desc, eq, gte, inArray, lt, or } from "drizzle-orm";
import {
  createClient,
  matchConfirmations,
  matches,
  ratingEvents,
  rsvps,
  sessions,
  users,
  type CuatroClient,
  type CuatroDb,
  type Match,
  type SetScore,
  type User,
} from "@cuatro/db";
import {
  createPlayer,
  processMatch,
  fixtureKey,
  ECHO_DAMPING_WINDOW_MS,
  PLACEMENT_TRIO_SIZE,
  type FixtureOccurrence,
  type LedgerEvent,
  type MatchInput,
  type MatchOutcome,
  type PlayerId,
  type PlayerState,
} from "@cuatro/glass";
import { getDb } from "./db";
import { insertNotification } from "./notify";
import { emitCircleEvent, emitSessionEvent, emitUserEvent } from "@/lib/realtime/broadcast";

export type Team = "A" | "B";

/**
 * The literal marker applyGlassAndPersist writes into a rating_event's
 * `explanation` the moment a player's Placement Trio completes. server/
 * feed.ts's placement-reveal Feed items (design/DESIGN-AUDIT.md F2) key off
 * this exact prefix rather than re-deriving "was this player's Nth verified
 * match exactly PLACEMENT_TRIO_SIZE" from scratch — same signal, one place
 * it's written.
 */
export const PLACEMENT_REVEAL_EXPLANATION_PREFIX = "Placement Trio complete";

export interface SessionEntryPlayer {
  id: string;
  displayName: string;
}

export interface SessionForEntry {
  session: { id: string; startsAt: Date; status: string };
  players: SessionEntryPlayer[];
}

export interface RecordMatchInput {
  sessionId: string;
  reporterId: string;
  teamA: [string, string];
  teamB: [string, string];
  sets: SetScore[];
  /** Defaults to "completed". A "walkover" isn't reachable from the result-entry form yet (v0 has no no-show flow). */
  outcome?: MatchOutcome;
}

export type ConfirmOutcome =
  | { status: "pending_confirmation"; alreadyFinal: false }
  | { status: "verified"; alreadyFinal: boolean; ledgerEvents?: readonly LedgerEvent[] }
  | { status: "disputed"; alreadyFinal: true }
  | { status: "void"; alreadyFinal: true };

export interface MatchDetail {
  match: Match;
  players: Record<string, string>; // userId -> displayName, for the 4 participants
  confirmedTeams: Team[];
  viewerTeam: Team | null;
  ledgerEvents: readonly LedgerEvent[] | null; // populated only once verified
}

export interface ProfileGlassView {
  displayName: string;
  status: "unrated" | "rated";
  rating: number | null;
  confidencePct: number;
  verifiedMatchCount: number;
  matchesUntilPlacement: number;
  reliabilityPct: number | null;
  lateCancelCount: number;
}

export interface LedgerEntryView {
  id: string;
  matchId: string;
  delta: number;
  ratingBefore: number | null;
  ratingAfter: number;
  confidenceBeforePct: number;
  confidenceAfterPct: number;
  factors: {
    expectedWin: number;
    marginMultiplier: number;
    echoDampingMultiplier: number;
    kFactor: number;
    isFirstMeeting: boolean;
  };
  explanation: string;
  createdAt: Date;
  outcome: MatchOutcome;
}

export interface MatchHistorySummary {
  played: number;
  wins: number;
  losses: number;
}

/** One match still waiting on the viewer's own team to confirm it — the /home action-item feed. */
export interface PendingConfirmationView {
  matchId: string;
  sessionId: string;
  playedAt: Date;
  opponentNames: string;
}

/** Which team (if any) a user is on for a given match row. */
function teamOf(match: Match, userId: string): Team | null {
  if (match.teamAPlayer1Id === userId || match.teamAPlayer2Id === userId) return "A";
  if (match.teamBPlayer1Id === userId || match.teamBPlayer2Id === userId) return "B";
  return null;
}

function opponentIdsOf(match: Match, userId: string): [string, string] {
  return teamOf(match, userId) === "A"
    ? [match.teamBPlayer1Id, match.teamBPlayer2Id]
    : [match.teamAPlayer1Id, match.teamAPlayer2Id];
}

function fourPlayerIds(match: Match): [string, string, string, string] {
  return [match.teamAPlayer1Id, match.teamAPlayer2Id, match.teamBPlayer1Id, match.teamBPlayer2Id];
}

/**
 * Broadcasts a "match" event to the session, its circle, and all four
 * players — called AFTER the write transaction that produced `status` has
 * committed (see recordMatch/confirmMatch/disputeMatch below), never from
 * inside it. `circleId` isn't on `matches` (only `sessionId` is), so this
 * does one extra lookup; matches-db.ts already accepts an async top-level
 * query here (see recordMatch's own pre-transaction session fetch).
 */
async function emitMatchEvent(db: CuatroDb, match: Match, status: string): Promise<void> {
  const [session] = await db.select({ circleId: sessions.circleId }).from(sessions).where(eq(sessions.id, match.sessionId));
  emitSessionEvent(match.sessionId, "match", { matchId: match.id, status });
  if (session) emitCircleEvent(session.circleId, "match", { matchId: match.id, sessionId: match.sessionId, status });
  for (const uid of fourPlayerIds(match)) {
    emitUserEvent(uid, "match", { matchId: match.id, sessionId: match.sessionId, status });
  }
}

/**
 * The winner is derived entirely from `score` — there is no `winner` column
 * on `matches` (only `outcome`, for the completed/retired/walkover
 * distinction — see @cuatro/glass's README "Walkover / retired policy").
 * Ties on sets fall back to total games; the "A" final fallback only
 * matters for a retired match recorded with zero games, which the Glass
 * engine skips outright rather than trusting this fallback's pick.
 */
export function computeWinner(sets: SetScore[]): "A" | "B" {
  let setsA = 0;
  let setsB = 0;
  let gamesA = 0;
  let gamesB = 0;
  for (const s of sets) {
    gamesA += s.a;
    gamesB += s.b;
    if (s.a > s.b) setsA++;
    else if (s.b > s.a) setsB++;
  }
  if (setsA !== setsB) return setsA > setsB ? "A" : "B";
  if (gamesA !== gamesB) return gamesA > gamesB ? "A" : "B";
  return "A";
}

export function gamesTotals(sets: SetScore[]): { gamesWonA: number; gamesWonB: number } {
  return sets.reduce(
    (acc, s) => ({ gamesWonA: acc.gamesWonA + s.a, gamesWonB: acc.gamesWonB + s.b }),
    { gamesWonA: 0, gamesWonB: 0 },
  );
}

/**
 * Reconstructs the Glass PlayerState the engine needs for one user.
 *
 * `users.rating` is NULL during Placement (see users.ts), so the hidden
 * internal rating always comes from the most recent rating_events row for
 * this user, not the users table — matching the design note on
 * packages/db/src/schema/rating-events.ts ("the Ledger tracks a real
 * internal number even during the Placement Trio"). A brand-new user with
 * zero verified matches has no rating_events row at all, so falls back to
 * @cuatro/glass's own createPlayer default (optionally seeded from
 * placementPriorRating) — this keeps the "no history" starting state
 * identical to what the engine itself considers a fresh player.
 *
 * `opponentsFaced` is the union of every past rating_event's
 * `factors.opponentUserIds` for this user — there's no separate column for
 * it, and this is exactly what PlayerState.opponentsFaced means.
 *
 * DB confidence is stored as a 0-1 fraction (see users.ts/rating-events.ts);
 * the engine works in 0-95 integer percentage points. Converted at the
 * boundary here and, symmetrically, when writing results back.
 */
function loadPlayerState(tx: CuatroDb, userId: string): { state: PlayerState; userRow: User } {
  const userRow = tx.select().from(users).where(eq(users.id, userId)).get();
  if (!userRow) throw new Error(`matches-db: unknown user "${userId}"`);

  if (userRow.verifiedMatchCount === 0) {
    const state = createPlayer(
      userId,
      userRow.placementPriorRating != null ? { placementPrior: userRow.placementPriorRating } : {},
    );
    return { state, userRow };
  }

  const priorEvents = tx.select().from(ratingEvents).where(eq(ratingEvents.userId, userId)).all();
  if (priorEvents.length === 0) {
    throw new Error(
      `matches-db: user "${userId}" has verifiedMatchCount=${userRow.verifiedMatchCount} but no rating_events`,
    );
  }
  const last = [...priorEvents].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).at(-1)!;

  const opponents = new Set<string>();
  for (const ev of priorEvents) {
    for (const id of ev.factors.opponentUserIds) opponents.add(id);
  }

  const state: PlayerState = {
    playerId: userId,
    rating: last.ratingAfter,
    confidence: Math.round(last.confidenceAfter * 100),
    matchesPlayed: userRow.verifiedMatchCount,
    opponentsFaced: [...opponents],
  };
  return { state, userRow };
}

/** Prior verified matches involving exactly these four players, for Echo Damping. */
function loadRecentFixtures(tx: CuatroDb, fourIds: readonly PlayerId[], beforePlayedAt: Date): FixtureOccurrence[] {
  const windowStart = new Date(beforePlayedAt.getTime() - ECHO_DAMPING_WINDOW_MS);
  const candidates = tx
    .select()
    .from(matches)
    .where(and(eq(matches.status, "verified"), gte(matches.playedAt, windowStart), lt(matches.playedAt, beforePlayedAt)))
    .all();
  const targetKey = fixtureKey(fourIds);
  return candidates
    .filter((m) => fixtureKey(fourPlayerIds(m)) === targetKey)
    .map((m) => ({ playedAt: m.playedAt.getTime(), playerIds: fourPlayerIds(m) }));
}

/**
 * Runs the Glass engine for a now-fully-confirmed match and persists its
 * output: one rating_events row per player (the Ledger — append-only), the
 * users table's mirrored rating/confidence/verifiedMatchCount, and
 * notifications. Must run inside the same transaction as the confirmation
 * write that triggered it, so a crash between "both confirmed" and "Glass
 * applied" can't happen.
 */
function applyGlassAndPersist(tx: CuatroDb, match: Match): readonly LedgerEvent[] {
  const fourIds = fourPlayerIds(match);
  const playerStates: Record<string, PlayerState> = {};
  const userRows: Record<string, User> = {};
  for (const id of fourIds) {
    const { state, userRow } = loadPlayerState(tx, id);
    playerStates[id] = state;
    userRows[id] = userRow;
  }

  const { gamesWonA, gamesWonB } = gamesTotals(match.score);
  const winner = computeWinner(match.score);
  const recentFixtures = loadRecentFixtures(tx, fourIds, match.playedAt);
  const opponentNames = Object.fromEntries(fourIds.map((id) => [id, userRows[id]!.displayName]));

  const matchInput: MatchInput = {
    matchId: match.id,
    playedAt: match.playedAt.getTime(),
    teamA: [match.teamAPlayer1Id, match.teamAPlayer2Id],
    teamB: [match.teamBPlayer1Id, match.teamBPlayer2Id],
    winner,
    gamesWonA,
    gamesWonB,
    verified: true,
    outcome: match.outcome,
  };

  const result = processMatch({ match: matchInput, players: playerStates, recentFixtures, opponentNames });

  // Games > 0 is enforced at record time for a "completed" match, but a
  // "retired"/"walkover" one can legitimately have zero games — that's
  // exactly the case @cuatro/glass's engine skips (see its README's
  // walkover/retired policy table). Either way, still flip the match to
  // verified with no Ledger movement rather than leaving it stuck.
  if (result.status === "skipped") {
    tx.update(matches).set({ status: "verified" }).where(eq(matches.id, match.id)).run();
    return [];
  }

  const ledgerEvents = result.ledgerEvents!;
  const updatedPlayers = result.updatedPlayers!;

  for (const id of fourIds) {
    const ev = ledgerEvents.find((e) => e.playerId === id)!;
    const updated = updatedPlayers[id]!;
    const userRow = userRows[id]!;
    const wasUnrated = userRow.verifiedMatchCount < PLACEMENT_TRIO_SIZE;
    const nowRated = updated.matchesPlayed >= PLACEMENT_TRIO_SIZE;
    const isFirstEventEver = userRow.verifiedMatchCount === 0;

    const explanation =
      wasUnrated && nowRated
        ? `${PLACEMENT_REVEAL_EXPLANATION_PREFIX} — your Glass number is live: ${ev.ratingAfter.toFixed(2)}`
        : wasUnrated
          ? `Placement match ${updated.matchesPlayed} of ${PLACEMENT_TRIO_SIZE} — your Glass number stays hidden until the Trio completes`
          : ev.explanation;

    tx.insert(ratingEvents)
      .values({
        userId: id,
        matchId: match.id,
        delta: ev.delta,
        ratingBefore: isFirstEventEver ? null : ev.ratingBefore,
        ratingAfter: ev.ratingAfter,
        confidenceBefore: ev.confidenceBefore / 100,
        confidenceAfter: ev.confidenceAfter / 100,
        factors: {
          expectedWin: ev.factors.expectancy,
          marginMultiplier: ev.factors.margin,
          echoDampingMultiplier: ev.factors.echoDamping,
          kFactor: ev.factors.kUsed,
          opponentUserIds: [...opponentIdsOf(match, id)],
          isFirstMeeting: ev.factors.echoDamping === 1,
        },
        explanation,
      })
      .run();

    tx.update(users)
      .set({
        rating: nowRated ? updated.rating : null,
        confidence: updated.confidence / 100,
        verifiedMatchCount: updated.matchesPlayed,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .run();

    insertNotification(
      tx,
      wasUnrated && nowRated
        ? { userId: id, type: "placement_complete", payload: { matchId: match.id, rating: updated.rating } }
        : { userId: id, type: "result_verified", payload: { matchId: match.id, delta: ev.delta, explanation } },
    );
  }

  tx.update(matches).set({ status: "verified" }).where(eq(matches.id, match.id)).run();
  return ledgerEvents;
}

export interface MatchesStore {
  db: CuatroDb;
  getSessionForEntry(sessionId: string): Promise<SessionForEntry | null>;
  /** The most recently recorded match for a session, if any — used to cross-link a played session to "Record result" vs. its existing match. */
  getMatchForSession(sessionId: string): Promise<{ id: string; status: string } | null>;
  recordMatch(input: RecordMatchInput): Promise<{ matchId: string }>;
  confirmMatch(matchId: string, userId: string): Promise<ConfirmOutcome>;
  disputeMatch(matchId: string, userId: string): Promise<ConfirmOutcome>;
  getMatchDetail(matchId: string, viewerId: string): Promise<MatchDetail | null>;
  getProfileGlassView(userId: string): Promise<ProfileGlassView | null>;
  getLedger(userId: string): Promise<LedgerEntryView[]>;
  getMatchHistorySummary(userId: string): Promise<MatchHistorySummary>;
  getPendingConfirmationsForUser(userId: string): Promise<PendingConfirmationView[]>;
  close(): void;
}

/**
 * Builds the store on top of an already-open client — the shape tests need
 * (an isolated `:memory:` client per test) and the shape the shared
 * process-wide singleton needs (one client reused across every store
 * dependent) both go through here; only how the client was obtained differs.
 */
export function createMatchesStoreFromClient(client: CuatroClient): MatchesStore {
  const { db } = client;

  return {
    db,

    async getSessionForEntry(sessionId) {
      const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
      if (!session) return null;

      const players = await db
        .select({ id: users.id, displayName: users.displayName })
        .from(rsvps)
        .innerJoin(users, eq(rsvps.userId, users.id))
        .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "in")));

      return { session: { id: session.id, startsAt: session.startsAt, status: session.status }, players };
    },

    async getMatchForSession(sessionId) {
      const rows = await db
        .select({ id: matches.id, status: matches.status })
        .from(matches)
        .where(eq(matches.sessionId, sessionId))
        .orderBy(desc(matches.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async recordMatch(input) {
      const outcome = input.outcome ?? "completed";
      const allIds = [...input.teamA, ...input.teamB];
      if (new Set(allIds).size !== 4) throw new Error("A match needs four distinct players");
      if (!allIds.includes(input.reporterId)) throw new Error("The reporter must be one of the four players");
      if (input.sets.length > 3) throw new Error("Enter at most 3 sets");
      // A "completed" match needs a real score; a "retired" one may have
      // ended with zero games played (see @cuatro/glass README's walkover/
      // retired policy table) — those still get recorded, just skipped by
      // the Glass engine at confirmation time rather than rejected here.
      if (outcome === "completed" && input.sets.length < 1) throw new Error("Enter between 1 and 3 sets");
      for (const s of input.sets) {
        if (s.a < 0 || s.b < 0) throw new Error("Games won cannot be negative");
      }
      const { gamesWonA, gamesWonB } = gamesTotals(input.sets);
      if (outcome === "completed" && gamesWonA + gamesWonB <= 0) {
        throw new Error("At least one game must have been played");
      }

      const [session] = await db.select().from(sessions).where(eq(sessions.id, input.sessionId));
      if (!session) throw new Error(`No such session "${input.sessionId}"`);

      let createdMatch: Match | undefined;
      const result = db.transaction((tx) => {
        const created = tx
          .insert(matches)
          .values({
            sessionId: input.sessionId,
            teamAPlayer1Id: input.teamA[0],
            teamAPlayer2Id: input.teamA[1],
            teamBPlayer1Id: input.teamB[0],
            teamBPlayer2Id: input.teamB[1],
            score: input.sets,
            status: "pending_confirmation",
            outcome,
            playedAt: session.startsAt,
          })
          .returning()
          .get();
        createdMatch = created;

        const reporterTeam = teamOf(created, input.reporterId)!;
        tx.insert(matchConfirmations)
          .values({ matchId: created.id, team: reporterTeam, confirmedByUserId: input.reporterId })
          .run();

        const otherTeamIds = reporterTeam === "A" ? input.teamB : input.teamA;
        for (const id of otherTeamIds) {
          insertNotification(tx, {
            userId: id,
            type: "confirm_result",
            payload: { matchId: created.id, sessionId: input.sessionId },
          });
        }

        return { matchId: created.id };
      });

      if (createdMatch) await emitMatchEvent(db, createdMatch, "recorded");
      return result;
    },

    async confirmMatch(matchId, userId) {
      let touchedMatch: Match | undefined;
      const outcome = db.transaction((tx): ConfirmOutcome => {
        const match = tx.select().from(matches).where(eq(matches.id, matchId)).get();
        if (!match) throw new Error(`No such match "${matchId}"`);

        const team = teamOf(match, userId);
        if (!team) throw new Error("Only a match participant can confirm it");

        // Idempotency: once a match is final, further confirm calls (e.g. a
        // double-click, or a teammate confirming again) are no-ops.
        if (match.status !== "pending_confirmation") {
          return { status: match.status as "verified" | "disputed" | "void", alreadyFinal: true };
        }

        const existing = tx
          .select()
          .from(matchConfirmations)
          .where(and(eq(matchConfirmations.matchId, matchId), eq(matchConfirmations.team, team)))
          .get();
        if (!existing) {
          tx.insert(matchConfirmations).values({ matchId, team, confirmedByUserId: userId }).run();
        }

        const confirmations = tx.select().from(matchConfirmations).where(eq(matchConfirmations.matchId, matchId)).all();
        const teamsConfirmed = new Set(confirmations.map((c) => c.team));
        if (teamsConfirmed.size < 2) {
          touchedMatch = match;
          return { status: "pending_confirmation", alreadyFinal: false };
        }

        const ledgerEvents = applyGlassAndPersist(tx, match);
        touchedMatch = match;
        return { status: "verified", alreadyFinal: false, ledgerEvents };
      });

      // Only broadcast on an actual state change — a no-op confirm on an
      // already-final match (see the idempotency branch above) leaves
      // touchedMatch unset and nothing for clients to refetch.
      if (touchedMatch) await emitMatchEvent(db, touchedMatch, outcome.status);
      return outcome;
    },

    async disputeMatch(matchId, userId) {
      let touchedMatch: Match | undefined;
      const outcome = db.transaction((tx): ConfirmOutcome => {
        const match = tx.select().from(matches).where(eq(matches.id, matchId)).get();
        if (!match) throw new Error(`No such match "${matchId}"`);

        const team = teamOf(match, userId);
        if (!team) throw new Error("Only a match participant can dispute it");

        // Disputes are terminal in v0 — a match that's already verified,
        // disputed, or void doesn't get re-opened.
        if (match.status !== "pending_confirmation") {
          return { status: match.status as "verified" | "disputed" | "void", alreadyFinal: true };
        }

        tx.update(matches).set({ status: "disputed" }).where(eq(matches.id, matchId)).run();
        touchedMatch = match;

        for (const id of fourPlayerIds(match)) {
          insertNotification(tx, { userId: id, type: "result_disputed", payload: { matchId } });
        }

        return { status: "disputed", alreadyFinal: true };
      });

      if (touchedMatch) await emitMatchEvent(db, touchedMatch, outcome.status);
      return outcome;
    },

    async getMatchDetail(matchId, viewerId) {
      const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
      if (!match) return null;

      const fourIds = fourPlayerIds(match);
      const nameRows = await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, fourIds));
      const players = Object.fromEntries(nameRows.map((r) => [r.id, r.displayName]));

      const confirmations = await db.select().from(matchConfirmations).where(eq(matchConfirmations.matchId, matchId));
      const confirmedTeams = confirmations.map((c) => c.team as Team);

      const ledgerRows =
        match.status === "verified"
          ? await db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId))
          : [];
      const ledgerEvents =
        match.status === "verified"
          ? ledgerRows.map(
              (r): LedgerEvent => ({
                playerId: r.userId,
                matchId: r.matchId,
                delta: r.delta,
                ratingBefore: r.ratingBefore ?? r.ratingAfter - r.delta,
                ratingAfter: r.ratingAfter,
                confidenceBefore: Math.round(r.confidenceBefore * 100),
                confidenceAfter: Math.round(r.confidenceAfter * 100),
                factors: {
                  expectancy: r.factors.expectedWin,
                  margin: r.factors.marginMultiplier,
                  echoDamping: r.factors.echoDampingMultiplier,
                  kUsed: r.factors.kFactor,
                },
                explanation: r.explanation,
              }),
            )
          : null;

      return {
        match,
        players,
        confirmedTeams,
        viewerTeam: teamOf(match, viewerId),
        ledgerEvents,
      };
    },

    async getProfileGlassView(userId) {
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return null;

      const reliabilityPct = user.rsvpInCount > 0 ? Math.round((user.showUpCount / user.rsvpInCount) * 100) : null;

      return {
        displayName: user.displayName,
        status: user.verifiedMatchCount >= PLACEMENT_TRIO_SIZE ? "rated" : "unrated",
        rating: user.rating,
        confidencePct: Math.round(user.confidence * 100),
        verifiedMatchCount: user.verifiedMatchCount,
        matchesUntilPlacement: Math.max(0, PLACEMENT_TRIO_SIZE - user.verifiedMatchCount),
        reliabilityPct,
        lateCancelCount: user.lateCancelCount,
      };
    },

    async getLedger(userId) {
      const rows = await db
        .select({ event: ratingEvents, matchOutcome: matches.outcome })
        .from(ratingEvents)
        .innerJoin(matches, eq(ratingEvents.matchId, matches.id))
        .where(eq(ratingEvents.userId, userId))
        .orderBy(desc(ratingEvents.createdAt));
      return rows.map(({ event: r, matchOutcome }) => ({
        id: r.id,
        matchId: r.matchId,
        delta: r.delta,
        ratingBefore: r.ratingBefore,
        ratingAfter: r.ratingAfter,
        confidenceBeforePct: Math.round(r.confidenceBefore * 100),
        confidenceAfterPct: Math.round(r.confidenceAfter * 100),
        factors: {
          expectedWin: r.factors.expectedWin,
          marginMultiplier: r.factors.marginMultiplier,
          echoDampingMultiplier: r.factors.echoDampingMultiplier,
          kFactor: r.factors.kFactor,
          isFirstMeeting: r.factors.isFirstMeeting,
        },
        explanation: r.explanation,
        createdAt: r.createdAt,
        outcome: matchOutcome,
      }));
    },

    async getMatchHistorySummary(userId) {
      const rows = await db
        .select()
        .from(matches)
        .where(
          and(
            eq(matches.status, "verified"),
            or(
              eq(matches.teamAPlayer1Id, userId),
              eq(matches.teamAPlayer2Id, userId),
              eq(matches.teamBPlayer1Id, userId),
              eq(matches.teamBPlayer2Id, userId),
            ),
          ),
        );

      let wins = 0;
      let losses = 0;
      for (const m of rows) {
        const team = teamOf(m, userId)!;
        if (computeWinner(m.score) === team) wins++;
        else losses++;
      }
      return { played: rows.length, wins, losses };
    },

    async getPendingConfirmationsForUser(userId) {
      const candidates = await db
        .select()
        .from(matches)
        .where(
          and(
            eq(matches.status, "pending_confirmation"),
            or(
              eq(matches.teamAPlayer1Id, userId),
              eq(matches.teamAPlayer2Id, userId),
              eq(matches.teamBPlayer1Id, userId),
              eq(matches.teamBPlayer2Id, userId),
            ),
          ),
        )
        .orderBy(desc(matches.playedAt));

      const pending: PendingConfirmationView[] = [];
      for (const m of candidates) {
        const team = teamOf(m, userId);
        if (!team) continue;

        const confirmedTeams = new Set(
          (await db.select({ team: matchConfirmations.team }).from(matchConfirmations).where(eq(matchConfirmations.matchId, m.id))).map(
            (c) => c.team,
          ),
        );
        // Already confirmed by the viewer's own team (whether the viewer or
        // their partner did it) — not an action item for this viewer.
        if (confirmedTeams.has(team)) continue;

        const opponentRows = await db
          .select({ displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, opponentIdsOf(m, userId)));

        pending.push({
          matchId: m.id,
          sessionId: m.sessionId,
          playedAt: m.playedAt,
          opponentNames: opponentRows.map((r) => r.displayName).join(" & "),
        });
      }
      return pending;
    },

    close() {
      client.close();
    },
  };
}

/** Convenience wrapper for tests and one-off scripts that want a fresh, isolated client (e.g. `:memory:`). */
export function createMatchesStore(dbPath?: string): MatchesStore {
  return createMatchesStoreFromClient(createClient(dbPath));
}

let storePromise: Promise<MatchesStore> | null = null;

export function getMatchesStore(): Promise<MatchesStore> {
  if (!storePromise) storePromise = getDb().then(createMatchesStoreFromClient);
  return storePromise;
}

/** Test-only: force a fresh store on next getMatchesStore() call. */
export function __resetMatchesStoreForTests() {
  storePromise = null;
}
