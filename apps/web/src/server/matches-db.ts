/**
 * Result-entry + Glass persistence, backed by @cuatro/db (drizzle + postgres-js).
 * `createMatchesStoreFromClient(client)` builds the store on an already-open
 * client — the process-wide `getMatchesStore()` singleton shares the one
 * connection in ./db.ts with the games surface (games-db.ts); tests inject a
 * fresh PGlite client via `createTestClient()`.
 *
 * Ownership boundary: this file owns everything under matches/confirmations/
 * rating_events/notifications writes. It does NOT touch packages/db schema —
 * see the "schema gap" note on `computeWinner` for the one place this bit.
 *
 * Transaction model: Postgres transactions are ASYNC — every `db.transaction`
 * callback below is `async` and awaits its statements (the old better-sqlite3
 * "no await inside" rule is inverted). Because Postgres MVCC does NOT serialize
 * writers, the read-then-decide-then-write critical sections take an explicit
 * `.for("update")` row lock on their anchoring row BEFORE deciding: the session
 * row in recordMatch (one match per session) and the match row in
 * confirmMatch/disputeMatch (the double-seal race). See the LOCK comments on
 * each. Realtime emits still fire AFTER the transaction commits, never inside.
 */
import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import {
  circleMembers,
  circles,
  matchConfirmations,
  matches,
  ratingEvents,
  rsvps,
  sessions,
  users,
  venues,
  type CuatroClient,
  type CuatroDb,
  type GameType,
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
import { normalizeGuestName } from "./guest";
import { insertNotification } from "./notify";
import { emitCircleEvent, emitSessionEvent, emitUserEvent } from "@/lib/realtime/broadcast";
import { captureEvent } from "@/lib/analytics";

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

/** One person the reporter can put on court at result-entry time — a confirmed RSVP, a Circle member who never RSVP'd, or (for the display of a just-added sub) a guest row. `rating` follows the users-table convention: null until the Placement Trio completes. */
export interface RosterPlayer {
  id: string;
  displayName: string;
  rating: number | null;
  avatarUrl: string | null;
  isGuest: boolean;
  /**
   * Preferred court side (issue #21): 'right' = drive, 'left' = backhand.
   * A SOFT SIGNAL ONLY — the wide roster editor uses it to default a seat
   * and render a small drive/backhand marker; null/'both' means no default
   * preference, and swapping is always completely free.
   */
  courtSide: "right" | "left" | "both" | null;
}

/**
 * The viewer's own public Glass state plus the two inputs the wide overlay's
 * seal preview needs that aren't derivable client-side: which opponents the
 * viewer has already faced (confidence moves only on NEW opponents) and any
 * recent verified matches involving the viewer (Echo Damping looks back 30
 * days for a repeat fixture). `rating` is the PUBLIC rating — null while the
 * Placement Trio is still pouring; the hidden internal rating never leaves
 * the server, so the preview simply doesn't render for an unrated viewer.
 */
export interface ViewerGlassContext {
  rating: number | null;
  confidencePct: number;
  verifiedMatchCount: number;
  opponentsFaced: string[];
  recentFixtures: FixtureOccurrence[];
}

/**
 * Everything the result-entry roster editor needs when the confirmed four
 * aren't the four who actually played: who RSVP'd in, and who else in the
 * Circle (plus the viewer themselves) can be swapped in. The reporter still
 * has to land on exactly four before a score can be sent.
 */
export interface RosterContext {
  session: { id: string; startsAt: Date; status: string; gameType: GameType };
  circleId: string;
  circleName: string;
  /** RSVP'd-in players, in the order slots filled — the roster's starting point. */
  confirmed: RosterPlayer[];
  /** Circle members not already in `confirmed`, plus the viewer if they aren't a member — the pool a sub can be picked from. */
  candidates: RosterPlayer[];
  /** Seal-preview inputs for the wide overlay (see ViewerGlassContext). Null only if the viewer row vanished mid-request. */
  viewerGlass: ViewerGlassContext | null;
}

/**
 * One row of the wide overlay's "Which game was it?" step: a recent played
 * session the viewer could record (or has recorded) a result for.
 */
export interface RecordableSession {
  sessionId: string;
  startsAt: Date;
  circleId: string;
  circleName: string;
  venueName: string | null;
  gameType: GameType;
  /** The session's live (non-void) match, if one exists — pending or sealed. */
  match: { id: string; status: string } | null;
}

/** A sub the reporter named who has no `users` row yet — created as a guest (is_guest=1) atomically when the match is recorded. `token` is the client-side stand-in used in the team slots until then. */
export interface PendingGuest {
  token: string;
  name: string;
}

export interface RecordMatchInput {
  sessionId: string;
  reporterId: string;
  /** Each slot is either an existing `users.id` or a PendingGuest `token` resolved via `newGuests`. */
  teamA: [string, string];
  teamB: [string, string];
  sets: SetScore[];
  /** Defaults to "completed". A "walkover" isn't reachable from the result-entry form yet (v0 has no no-show flow). */
  outcome?: MatchOutcome;
  /** Named substitutes with no account yet — turned into guest `users` rows inside recordMatch's own transaction, so a failed record leaves no orphan guests. */
  newGuests?: PendingGuest[];
}

/** Thrown when a session already has a live (non-void) match — one game, one record. The second reporter should land on the existing match to confirm it, not mint a duplicate. */
export class MatchAlreadyRecordedError extends Error {
  constructor(
    public readonly existingMatchId: string,
    public readonly existingStatus: string,
  ) {
    super("This game's result has already been recorded");
    this.name = "MatchAlreadyRecordedError";
  }
}

export type ConfirmOutcome =
  | { status: "pending_confirmation"; alreadyFinal: false }
  | { status: "verified"; alreadyFinal: boolean; ledgerEvents?: readonly LedgerEvent[] }
  | { status: "disputed"; alreadyFinal: true }
  | { status: "void"; alreadyFinal: true };

export interface MatchDetail {
  match: Match;
  players: Record<string, string>; // userId -> displayName, for the 4 participants
  /** userId -> avatarUrl for the 4 participants (wide layout renders avatar stacks; phone ignores it). */
  avatars: Record<string, string | null>;
  confirmedTeams: Team[];
  viewerTeam: Team | null;
  ledgerEvents: readonly LedgerEvent[] | null; // populated only once verified
  /** Where/when the match happened, for the wide layout's prose ("last night at Powerleague"). */
  context: { startsAt: Date; venueName: string | null; circleName: string };
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

/** The circle a match belongs to (matches carry only sessionId — same one extra lookup emitMatchEvent does). */
async function matchCircleId(db: CuatroDb, match: Match): Promise<string | undefined> {
  const [session] = await db.select({ circleId: sessions.circleId }).from(sessions).where(eq(sessions.id, match.sessionId));
  return session?.circleId;
}

/**
 * Confirmability facts for §9 metric 2 (both-team seal rate). A team that is
 * ALL guests cannot confirm (rule 13), so an all-guest-team match stays
 * legitimately pending forever and must be excluded from the seal-rate
 * denominator — `is_confirmable` = neither team all-guest.
 */
async function matchConfirmability(
  db: CuatroDb,
  match: Match,
): Promise<{ teamAAllGuest: boolean; teamBAllGuest: boolean; isConfirmable: boolean }> {
  const ids = fourPlayerIds(match);
  const rows = await db.select({ id: users.id, isGuest: users.isGuest }).from(users).where(inArray(users.id, ids));
  const guestById = new Map(rows.map((r) => [r.id, Boolean(r.isGuest)]));
  const teamAAllGuest = Boolean(guestById.get(match.teamAPlayer1Id)) && Boolean(guestById.get(match.teamAPlayer2Id));
  const teamBAllGuest = Boolean(guestById.get(match.teamBPlayer1Id)) && Boolean(guestById.get(match.teamBPlayer2Id));
  return { teamAAllGuest, teamBAllGuest, isConfirmable: !teamAAllGuest && !teamBAllGuest };
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
async function loadPlayerState(tx: CuatroDb, userId: string): Promise<{ state: PlayerState; userRow: User }> {
  const [userRow] = await tx.select().from(users).where(eq(users.id, userId));
  if (!userRow) throw new Error(`matches-db: unknown user "${userId}"`);

  if (userRow.verifiedMatchCount === 0) {
    const state = createPlayer(
      userId,
      userRow.placementPriorRating != null ? { placementPrior: userRow.placementPriorRating } : {},
    );
    return { state, userRow };
  }

  const priorEvents = await tx.select().from(ratingEvents).where(eq(ratingEvents.userId, userId));
  if (priorEvents.length === 0) {
    throw new Error(
      `matches-db: user "${userId}" has verifiedMatchCount=${userRow.verifiedMatchCount} but no rating_events`,
    );
  }
  // A guest identity merged into this account (server/guest.ts) parks its
  // events here MARKED — visible in the Ledger, but never part of this
  // account's LIVE trajectory. Compute current state from unmarked events only.
  const liveEvents = priorEvents.filter(
    (e) => !(e.factors as { mergedFromGuestUserId?: string }).mergedFromGuestUserId,
  );
  const trajectory = liveEvents.length > 0 ? liveEvents : priorEvents; // defensive fallback
  // createdAt is epoch-ms (Postgres bigint) now — sort on the number directly.
  const last = [...trajectory].sort((a, b) => a.createdAt - b.createdAt).at(-1)!;

  const opponents = new Set<string>();
  for (const ev of trajectory) {
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

/** Prior verified matches involving exactly these four players, for Echo Damping. `beforePlayedAt` is epoch-ms. */
async function loadRecentFixtures(tx: CuatroDb, fourIds: readonly PlayerId[], beforePlayedAt: number): Promise<FixtureOccurrence[]> {
  const windowStart = beforePlayedAt - ECHO_DAMPING_WINDOW_MS;
  const candidates = await tx
    .select()
    .from(matches)
    .where(and(eq(matches.status, "verified"), gte(matches.playedAt, windowStart), lt(matches.playedAt, beforePlayedAt)));
  const targetKey = fixtureKey(fourIds);
  return candidates
    .filter((m) => fixtureKey(fourPlayerIds(m)) === targetKey)
    .map((m) => ({ playedAt: m.playedAt, playerIds: fourPlayerIds(m) }));
}

/**
 * Closes the Reliability loop (../DESIGN.md → RELIABILITY, CLAUDE.md rule 13).
 * The moment a match is sealed, credit a show-up to each player who both
 * PLAYED it (is on the verified roster) AND had said they'd be there — an
 * `rsvps` row with status="in" on the linked session. That "in" row is exactly
 * what games-service.rsvpIn incremented rsvpInCount for, so showUpCount and
 * rsvpInCount stay paired: the Reliability ratio (showUpCount / rsvpInCount)
 * only ever moves for players who committed via RSVP.
 *
 * The three cases that get NOTHING here, all honestly:
 * - No-show: rsvp="in" but absent from the roster — not iterated, so their
 *   ratio quietly drops (their rsvpInCount already moved). This is the whole
 *   anti-no-show mechanic: automatic, no flag, no notification, no shaming.
 * - Sub / match-minted guest with no "in" row: never had rsvpInCount moved
 *   either, so the ratio's denominator is untouched — no phantom show-up.
 * - Ring-3 claimant (rsvp source=fourth_call, status="in"): DOES get credited,
 *   correctly — claiming a slot moved their rsvpInCount, and they turned up.
 *
 * Idempotent by construction: applyGlassAndPersist runs exactly once per match
 * (confirmMatch's status guard makes a re-confirm a no-op before reaching
 * here), so a double/re-verification can never double-credit. Runs inside the
 * verify transaction for both the Glass path and the skipped (walkover/retired)
 * path — a sealed match means the players turned up regardless of whether the
 * engine moved anyone's rating.
 */
async function creditShowUps(tx: CuatroDb, match: Match): Promise<void> {
  for (const id of fourPlayerIds(match)) {
    const [saidTheyWereIn] = await tx
      .select({ id: rsvps.id })
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, match.sessionId), eq(rsvps.userId, id), eq(rsvps.status, "in")));
    if (saidTheyWereIn) {
      await tx
        .update(users)
        .set({ showUpCount: sql`${users.showUpCount} + 1` })
        .where(eq(users.id, id));
    }
  }
}

/**
 * Runs the Glass engine for a now-fully-confirmed match and persists its
 * output: one rating_events row per player (the Ledger — append-only), the
 * users table's mirrored rating/confidence/verifiedMatchCount, Reliability
 * show-up credit (see creditShowUps), and notifications. Must run inside the
 * same transaction as the confirmation write that triggered it, so a crash
 * between "both confirmed" and "Glass applied" can't happen.
 */
async function applyGlassAndPersist(tx: CuatroDb, match: Match): Promise<readonly LedgerEvent[]> {
  // FRIENDLIES gate (V1-READINESS #10). This is the single server-side point
  // where rating events are written, so the classification gate lives here (the
  // engine in packages/glass is never touched). A friendly match is a real,
  // sealed result: it still credits Reliability show-ups and flips to
  // "verified" — so it counts for streaks, played-with, and match history
  // exactly like a competitive game — but it writes NO rating_events and never
  // moves users.rating / confidence / verifiedMatchCount. Same tail as the
  // walkover/retired skip path below, minus the Glass run.
  if (match.gameType === "friendly") {
    await creditShowUps(tx, match);
    await tx.update(matches).set({ status: "verified" }).where(eq(matches.id, match.id));
    return [];
  }

  const fourIds = fourPlayerIds(match);
  const playerStates: Record<string, PlayerState> = {};
  const userRows: Record<string, User> = {};
  for (const id of fourIds) {
    const { state, userRow } = await loadPlayerState(tx, id);
    playerStates[id] = state;
    userRows[id] = userRow;
  }

  const { gamesWonA, gamesWonB } = gamesTotals(match.score);
  const winner = computeWinner(match.score);
  const recentFixtures = await loadRecentFixtures(tx, fourIds, match.playedAt);
  const opponentNames = Object.fromEntries(fourIds.map((id) => [id, userRows[id]!.displayName]));

  const matchInput: MatchInput = {
    matchId: match.id,
    playedAt: match.playedAt,
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
    await creditShowUps(tx, match);
    await tx.update(matches).set({ status: "verified" }).where(eq(matches.id, match.id));
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
        ? `${PLACEMENT_REVEAL_EXPLANATION_PREFIX}. Your Glass number is live: ${ev.ratingAfter.toFixed(2)}`
        : wasUnrated
          ? `Placement match ${updated.matchesPlayed} of ${PLACEMENT_TRIO_SIZE}, your Glass number stays hidden until the Trio completes`
          : ev.explanation;

    await tx.insert(ratingEvents).values({
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
    });

    await tx
      .update(users)
      .set({
        rating: nowRated ? updated.rating : null,
        confidence: updated.confidence / 100,
        verifiedMatchCount: updated.matchesPlayed,
        updatedAt: Date.now(),
      })
      .where(eq(users.id, id));

    await insertNotification(
      tx,
      wasUnrated && nowRated
        ? { userId: id, type: "placement_complete", payload: { matchId: match.id, rating: updated.rating } }
        : { userId: id, type: "result_verified", payload: { matchId: match.id, delta: ev.delta, explanation } },
    );
  }

  await creditShowUps(tx, match);
  await tx.update(matches).set({ status: "verified" }).where(eq(matches.id, match.id));
  return ledgerEvents;
}

export interface MatchesStore {
  db: CuatroDb;
  getSessionForEntry(sessionId: string): Promise<SessionForEntry | null>;
  getRosterContext(sessionId: string, viewerId: string): Promise<RosterContext | null>;
  /** Recent played-window sessions across the viewer's Circles, newest first — the wide overlay's "Which game was it?" list. */
  getRecordableSessions(viewerId: string): Promise<RecordableSession[]>;
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
  close(): Promise<void>;
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

      return { session: { id: session.id, startsAt: new Date(session.startsAt), status: session.status }, players };
    },

    async getRosterContext(sessionId, viewerId) {
      const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
      if (!session) return null;

      const [circle] = await db.select({ name: circles.name }).from(circles).where(eq(circles.id, session.circleId));

      // Confirmed-in players first — same "slots fill in RSVP order" sort as
      // games-service.getSessionSummary (rsvpIn never assigns an "in" row a
      // position, so order comes from respondedAt, not DB order).
      const inRows = await db
        .select({
          userId: users.id,
          displayName: users.displayName,
          rating: users.rating,
          avatarUrl: users.avatarUrl,
          isGuest: users.isGuest,
          courtSide: users.courtSide,
          respondedAt: rsvps.respondedAt,
        })
        .from(rsvps)
        .innerJoin(users, eq(rsvps.userId, users.id))
        .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "in")));
      const confirmed: RosterPlayer[] = inRows
        // respondedAt is epoch-ms (Postgres bigint) now — compare the numbers.
        .sort((a, b) => (a.respondedAt ?? 0) - (b.respondedAt ?? 0))
        .map((r) => ({ id: r.userId, displayName: r.displayName, rating: r.rating, avatarUrl: r.avatarUrl, isGuest: r.isGuest, courtSide: r.courtSide }));

      const confirmedIds = new Set(confirmed.map((p) => p.id));

      // Everyone in the Circle who could be subbed in — members who didn't
      // RSVP in. `users.rating` is null-until-rated by convention, so it maps
      // straight onto RosterPlayer.rating with no extra Glass read.
      const memberRows = await db
        .select({
          userId: users.id,
          displayName: users.displayName,
          rating: users.rating,
          avatarUrl: users.avatarUrl,
          isGuest: users.isGuest,
          courtSide: users.courtSide,
        })
        .from(circleMembers)
        .innerJoin(users, eq(circleMembers.userId, users.id))
        .where(eq(circleMembers.circleId, session.circleId));
      const candidates: RosterPlayer[] = memberRows
        .filter((r) => !confirmedIds.has(r.userId))
        .map((r) => ({ id: r.userId, displayName: r.displayName, rating: r.rating, avatarUrl: r.avatarUrl, isGuest: r.isGuest, courtSide: r.courtSide }));

      // The reporter must end up as one of the four (they auto-confirm their
      // own team — see recordMatch). If they RSVP'd in they're already in
      // `confirmed`; if they're a member they're in `candidates`; otherwise
      // surface them explicitly so they can still add themselves.
      const alreadyListed = confirmedIds.has(viewerId) || candidates.some((c) => c.id === viewerId);
      if (!alreadyListed) {
        const [viewer] = await db
          .select({
            id: users.id,
            displayName: users.displayName,
            rating: users.rating,
            avatarUrl: users.avatarUrl,
            isGuest: users.isGuest,
            courtSide: users.courtSide,
          })
          .from(users)
          .where(eq(users.id, viewerId));
        if (viewer) candidates.unshift(viewer);
      }

      // Seal-preview inputs (wide overlay step 4). Only PUBLIC state travels:
      // users.rating stays null mid-Trio, and the hidden internal rating in
      // rating_events never leaves the server — the preview just doesn't
      // render for an unrated viewer. opponentsFaced comes from the viewer's
      // own Ledger rows (the same factors.opponentUserIds loadPlayerState
      // reads); recentFixtures is every verified match involving the viewer
      // inside the Echo Damping window before this session, which is
      // sufficient for the fixture check because the viewer is always one of
      // the four on court.
      let viewerGlass: ViewerGlassContext | null = null;
      const [viewerRow] = await db
        .select({ rating: users.rating, confidence: users.confidence, verifiedMatchCount: users.verifiedMatchCount })
        .from(users)
        .where(eq(users.id, viewerId));
      if (viewerRow) {
        const viewerEvents = await db
          .select({ factors: ratingEvents.factors })
          .from(ratingEvents)
          .where(eq(ratingEvents.userId, viewerId));
        const opponentsFaced = new Set<string>();
        for (const ev of viewerEvents) {
          for (const id of ev.factors.opponentUserIds) opponentsFaced.add(id);
        }
        const windowStart = session.startsAt - ECHO_DAMPING_WINDOW_MS;
        const fixtureRows = await db
          .select()
          .from(matches)
          .where(
            and(
              eq(matches.status, "verified"),
              gte(matches.playedAt, windowStart),
              lt(matches.playedAt, session.startsAt),
              or(
                eq(matches.teamAPlayer1Id, viewerId),
                eq(matches.teamAPlayer2Id, viewerId),
                eq(matches.teamBPlayer1Id, viewerId),
                eq(matches.teamBPlayer2Id, viewerId),
              ),
            ),
          );
        viewerGlass = {
          rating: viewerRow.rating,
          confidencePct: Math.round(viewerRow.confidence * 100),
          verifiedMatchCount: viewerRow.verifiedMatchCount,
          opponentsFaced: [...opponentsFaced],
          recentFixtures: fixtureRows.map((m) => ({ playedAt: m.playedAt, playerIds: fourPlayerIds(m) })),
        };
      }

      return {
        session: { id: session.id, startsAt: new Date(session.startsAt), status: session.status, gameType: session.gameType },
        circleId: session.circleId,
        circleName: circle?.name ?? "",
        confirmed,
        candidates,
        viewerGlass,
      };
    },

    async getRecordableSessions(viewerId) {
      // The wide overlay's step 1. "Recordable" = a session in one of the
      // viewer's Circles whose start time has passed, inside the same lookback
      // window The Rotation uses for "recent" (14 days keeps the list honest —
      // older than that and nobody remembers the score anyway). Cancelled
      // sessions never played, so they never appear.
      const now = Date.now();
      const windowStart = now - 14 * 24 * 60 * 60 * 1000;
      const rows = await db
        .select({
          sessionId: sessions.id,
          startsAt: sessions.startsAt,
          circleId: sessions.circleId,
          circleName: circles.name,
          venueName: venues.name,
          gameType: sessions.gameType,
        })
        .from(sessions)
        .innerJoin(circleMembers, and(eq(circleMembers.circleId, sessions.circleId), eq(circleMembers.userId, viewerId)))
        .innerJoin(circles, eq(circles.id, sessions.circleId))
        .leftJoin(venues, eq(venues.id, sessions.venueId))
        .where(and(lt(sessions.startsAt, now), gte(sessions.startsAt, windowStart), inArray(sessions.status, ["upcoming", "played"])))
        .orderBy(desc(sessions.startsAt))
        .limit(8);

      const out: RecordableSession[] = [];
      for (const r of rows) {
        const live = (
          await db
            .select({ id: matches.id, status: matches.status })
            .from(matches)
            .where(eq(matches.sessionId, r.sessionId))
            .orderBy(desc(matches.createdAt))
        ).find((m) => m.status !== "void");
        out.push({
          sessionId: r.sessionId,
          startsAt: new Date(r.startsAt),
          circleId: r.circleId,
          circleName: r.circleName,
          venueName: r.venueName ?? null,
          gameType: r.gameType,
          match: live ?? null,
        });
      }
      return out;
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
      // Slots may be existing user ids or PendingGuest tokens at this point;
      // distinctness/reporter/score checks all hold on the tokens, and are
      // re-checked on the resolved ids once guests exist (below), so a token
      // that happens to equal a real id can't smuggle in a duplicate player.
      const slotTokens = [...input.teamA, ...input.teamB];
      if (new Set(slotTokens).size !== 4) throw new Error("A match needs four distinct players");
      if (!slotTokens.includes(input.reporterId)) throw new Error("The reporter must be one of the four players");
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

      // Validate substitute names before opening the transaction (guest
      // creation happens inside it, so a bad name shouldn't get that far).
      // Every guest token must be one of the four slots — a spec for a token
      // nobody plays is a client bug, not something to silently drop.
      const guestSpecs = (input.newGuests ?? []).map((g) => {
        const name = normalizeGuestName(g.name);
        if (!name) throw new Error("A substitute needs a name");
        if (!slotTokens.includes(g.token)) throw new Error(`Guest token "${g.token}" isn't one of the four players`);
        return { token: g.token, name };
      });

      const [session] = await db.select().from(sessions).where(eq(sessions.id, input.sessionId));
      if (!session) throw new Error(`No such session "${input.sessionId}"`);
      const [circle] = await db.select({ countryCode: circles.countryCode }).from(circles).where(eq(circles.id, session.circleId));
      const guestCountryCode = circle?.countryCode ?? "GB";

      let createdMatch: Match | undefined;
      const result = await db.transaction(async (tx) => {
        // LOCK: one match per session (v1 audit blocker B1). Without this two
        // players can each record the same game, both get sealed, and Glass +
        // Reliability double-count (verified live: 109% reliability). Postgres
        // MVCC would let two concurrent recordMatch calls both read "no live
        // match" and both insert. FOR UPDATE on the anchoring session row
        // serializes them: the second waits, then sees the first's committed
        // match and bails via MatchAlreadyRecordedError. A voided match doesn't
        // block a re-record.
        await tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, input.sessionId)).for("update");
        const existing = (
          await tx
            .select({ id: matches.id, status: matches.status })
            .from(matches)
            .where(eq(matches.sessionId, input.sessionId))
        ).find((m) => m.status !== "void");
        if (existing) throw new MatchAlreadyRecordedError(existing.id, existing.status);
        // Mint a guest `users` row per named substitute — same shape as
        // server/guest.ts's insertGuestUser (isGuest, no email, Circle's
        // country), but with the name already known so no placeholder/name
        // step is needed. Created here so a rollback (e.g. a bad slot) leaves
        // no orphan guest behind.
        const tokenToId = new Map<string, string>();
        for (const g of guestSpecs) {
          const [guest] = await tx
            .insert(users)
            .values({ displayName: g.name, isGuest: true, countryCode: guestCountryCode })
            .returning();
          tokenToId.set(g.token, guest.id);
        }
        const resolve = (token: string) => tokenToId.get(token) ?? token;
        const teamA: [string, string] = [resolve(input.teamA[0]), resolve(input.teamA[1])];
        const teamB: [string, string] = [resolve(input.teamB[0]), resolve(input.teamB[1])];
        if (new Set([...teamA, ...teamB]).size !== 4) throw new Error("A match needs four distinct players");

        const [created] = await tx
          .insert(matches)
          .values({
            sessionId: input.sessionId,
            teamAPlayer1Id: teamA[0],
            teamAPlayer2Id: teamA[1],
            teamBPlayer1Id: teamB[0],
            teamBPlayer2Id: teamB[1],
            score: input.sets,
            status: "pending_confirmation",
            outcome,
            // FRIENDLIES: snapshot the session's classification onto the match
            // at record time, so the seal path (and the Ledger) can say whether
            // Glass moved without joining back to a session/circle that may
            // change later. Competitive is the default everywhere.
            gameType: session.gameType,
            playedAt: session.startsAt,
          })
          .returning();
        createdMatch = created;

        const reporterTeam = teamOf(created, input.reporterId)!;
        await tx
          .insert(matchConfirmations)
          .values({ matchId: created.id, team: reporterTeam, confirmedByUserId: input.reporterId });

        const otherTeamIds = reporterTeam === "A" ? teamB : teamA;
        for (const id of otherTeamIds) {
          await insertNotification(tx, {
            userId: id,
            type: "confirm_result",
            payload: { matchId: created.id, sessionId: input.sessionId },
          });
        }

        return { matchId: created.id };
      });

      if (createdMatch) {
        await emitMatchEvent(db, createdMatch, "recorded");
        // §9 metric 2: match_recorded. Carries game_type (so seal rate filters
        // to competitive) and the confirmability flags (so all-guest-team
        // matches, which can never seal, are excluded from the denominator).
        const [circleId, confirmability] = await Promise.all([
          matchCircleId(db, createdMatch),
          matchConfirmability(db, createdMatch),
        ]);
        if (circleId) {
          captureEvent("match_recorded", {
            distinctId: input.reporterId,
            circleId,
            sessionId: createdMatch.sessionId,
            timestamp: createdMatch.createdAt,
            properties: {
              match_id: createdMatch.id,
              game_type: createdMatch.gameType,
              team_a_all_guest: confirmability.teamAAllGuest,
              team_b_all_guest: confirmability.teamBAllGuest,
              is_confirmable: confirmability.isConfirmable,
              recorded_by: input.reporterId,
              ts: createdMatch.createdAt,
            },
          });
        }
      }
      return result;
    },

    async confirmMatch(matchId, userId) {
      let touchedMatch: Match | undefined;
      // §9 metric 2 facts, hoisted so the events fire after commit: the team
      // this call confirmed for, and whether it was a NEW confirmation (a
      // duplicate same-team confirm is a no-op that must not emit match_confirmed).
      let confirmingTeam: Team | undefined;
      let newConfirmation = false;
      const outcome = await db.transaction(async (tx): Promise<ConfirmOutcome> => {
        // LOCK: the double-seal race. Seal = any real member of a team confirms
        // for it (rule 13). Two members (one per team) confirming at the same
        // instant could each read status="pending_confirmation" and each see
        // "both teams now confirmed", both running applyGlassAndPersist (double
        // Glass + double Reliability). FOR UPDATE on the match row serializes
        // the two confirms: the second waits for the first to commit, then the
        // status guard below sees "verified" and returns alreadyFinal.
        const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update");
        if (!match) throw new Error(`No such match "${matchId}"`);

        const team = teamOf(match, userId);
        if (!team) throw new Error("Only a match participant can confirm it");
        confirmingTeam = team;

        // Idempotency: once a match is final, further confirm calls (e.g. a
        // double-click, or a teammate confirming again) are no-ops.
        if (match.status !== "pending_confirmation") {
          return { status: match.status as "verified" | "disputed" | "void", alreadyFinal: true };
        }

        const [existing] = await tx
          .select()
          .from(matchConfirmations)
          .where(and(eq(matchConfirmations.matchId, matchId), eq(matchConfirmations.team, team)));
        if (!existing) {
          await tx.insert(matchConfirmations).values({ matchId, team, confirmedByUserId: userId });
          newConfirmation = true;
        }

        const confirmations = await tx.select().from(matchConfirmations).where(eq(matchConfirmations.matchId, matchId));
        const teamsConfirmed = new Set(confirmations.map((c) => c.team));
        if (teamsConfirmed.size < 2) {
          touchedMatch = match;
          return { status: "pending_confirmation", alreadyFinal: false };
        }

        const ledgerEvents = await applyGlassAndPersist(tx, match);
        touchedMatch = match;
        return { status: "verified", alreadyFinal: false, ledgerEvents };
      });

      // Only broadcast on an actual state change — a no-op confirm on an
      // already-final match (see the idempotency branch above) leaves
      // touchedMatch unset and nothing for clients to refetch.
      if (touchedMatch) {
        await emitMatchEvent(db, touchedMatch, outcome.status);
        const circleId = await matchCircleId(db, touchedMatch);
        if (circleId) {
          // §9 metric 2: match_confirmed fires only on a genuinely new team
          // confirmation; match_sealed fires when this confirm was the second
          // team (status became verified). Both carry game_type so the seal
          // rate can filter to competitive.
          if (newConfirmation && confirmingTeam) {
            captureEvent("match_confirmed", {
              distinctId: userId,
              circleId,
              sessionId: touchedMatch.sessionId,
              timestamp: Date.now(),
              properties: {
                match_id: touchedMatch.id,
                game_type: touchedMatch.gameType,
                confirming_team: confirmingTeam.toLowerCase(),
                confirmed_by: userId,
                ts: Date.now(),
              },
            });
          }
          if (outcome.status === "verified") {
            captureEvent("match_sealed", {
              distinctId: userId,
              circleId,
              sessionId: touchedMatch.sessionId,
              timestamp: Date.now(),
              properties: { match_id: touchedMatch.id, game_type: touchedMatch.gameType, ts: Date.now() },
            });
          }
        }
      }
      return outcome;
    },

    async disputeMatch(matchId, userId) {
      let touchedMatch: Match | undefined;
      const outcome = await db.transaction(async (tx): Promise<ConfirmOutcome> => {
        // LOCK: same match row as confirmMatch, so a dispute and a confirm
        // racing on the same match can't both slip past the status guard (one
        // sealing while the other disputes). FOR UPDATE serializes them.
        const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update");
        if (!match) throw new Error(`No such match "${matchId}"`);

        const team = teamOf(match, userId);
        if (!team) throw new Error("Only a match participant can dispute it");

        // Disputes are terminal in v0 — a match that's already verified,
        // disputed, or void doesn't get re-opened.
        if (match.status !== "pending_confirmation") {
          return { status: match.status as "verified" | "disputed" | "void", alreadyFinal: true };
        }

        await tx.update(matches).set({ status: "disputed" }).where(eq(matches.id, matchId));
        touchedMatch = match;

        for (const id of fourPlayerIds(match)) {
          await insertNotification(tx, { userId: id, type: "result_disputed", payload: { matchId } });
        }

        return { status: "disputed", alreadyFinal: true };
      });

      if (touchedMatch) {
        await emitMatchEvent(db, touchedMatch, outcome.status);
        // §9 metric 2: match_disputed. Disputes are terminal in v1, so a rising
        // count is a real problem even when the seal rate looks healthy
        // (METRICS.md metric 2). touchedMatch is set only on the real transition.
        const circleId = await matchCircleId(db, touchedMatch);
        if (circleId) {
          captureEvent("match_disputed", {
            distinctId: userId,
            circleId,
            sessionId: touchedMatch.sessionId,
            timestamp: Date.now(),
            properties: { match_id: touchedMatch.id, game_type: touchedMatch.gameType, ts: Date.now() },
          });
        }
      }
      return outcome;
    },

    async getMatchDetail(matchId, viewerId) {
      const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
      if (!match) return null;

      const fourIds = fourPlayerIds(match);
      const nameRows = await db
        .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
        .from(users)
        .where(inArray(users.id, fourIds));
      const players = Object.fromEntries(nameRows.map((r) => [r.id, r.displayName]));
      const avatars = Object.fromEntries(nameRows.map((r) => [r.id, r.avatarUrl]));

      // Where/when, for the wide layout's prose. The session always exists
      // (matches.sessionId is NOT NULL) but tolerate a missing row anyway.
      const [sessionRow] = await db
        .select({ startsAt: sessions.startsAt, venueName: venues.name, circleName: circles.name })
        .from(sessions)
        .innerJoin(circles, eq(circles.id, sessions.circleId))
        .leftJoin(venues, eq(venues.id, sessions.venueId))
        .where(eq(sessions.id, match.sessionId));

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
        avatars,
        confirmedTeams,
        viewerTeam: teamOf(match, viewerId),
        ledgerEvents,
        context: {
          startsAt: new Date(sessionRow?.startsAt ?? match.playedAt),
          venueName: sessionRow?.venueName ?? null,
          circleName: sessionRow?.circleName ?? "",
        },
      };
    },

    async getProfileGlassView(userId) {
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return null;

      const reliabilityPct = user.rsvpInCount > 0 ? Math.min(100, Math.round((user.showUpCount / user.rsvpInCount) * 100)) : null;

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
        createdAt: new Date(r.createdAt),
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
          playedAt: new Date(m.playedAt),
          opponentNames: opponentRows.map((r) => r.displayName).join(" & "),
        });
      }
      return pending;
    },

    async close() {
      await client.close();
    },
  };
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
