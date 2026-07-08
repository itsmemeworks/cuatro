export type PlayerId = string;
export type MatchId = string;

/**
 * The full state Glass tracks for one player. Immutable — engine functions
 * return new PlayerState objects rather than mutating in place.
 */
export interface PlayerState {
  readonly playerId: PlayerId;
  /** Hidden true rating, 1.00-7.00, always 2 decimal places. */
  readonly rating: number;
  /** 0-95, integer percentage points. */
  readonly confidence: number;
  /** Count of verified matches this player has completed. */
  readonly matchesPlayed: number;
  /** Every unique opponent player id this player has ever faced in a verified match. */
  readonly opponentsFaced: readonly PlayerId[];
}

/** Unrated players have no public Glass number yet; Placement Trio still running. */
export type PlayerStatus = "unrated" | "rated";

export interface PlayerCreationOptions {
  /**
   * Optional imported level (e.g. "I'm a 3.4 on Playtomic") used only to seed
   * the player's hidden starting rating. Never displayed as a Glass number —
   * that's a UI-layer rule, not something this engine enforces, since the
   * engine has no concept of "display" at all.
   */
  placementPrior?: number;
}

export type MatchOutcome = "completed" | "walkover" | "retired";

/**
 * One padel match between two teams of two. All timestamps are caller-supplied
 * (epoch milliseconds) — the engine never reads the system clock.
 */
export interface MatchInput {
  readonly matchId: MatchId;
  readonly playedAt: number;
  readonly teamA: readonly [PlayerId, PlayerId];
  readonly teamB: readonly [PlayerId, PlayerId];
  readonly winner: "A" | "B";
  readonly gamesWonA: number;
  readonly gamesWonB: number;
  /** Only verified (both-teams-confirmed) matches move ratings. */
  readonly verified: boolean;
  /** Defaults to "completed". See README "Walkover & retired policy". */
  readonly outcome?: MatchOutcome;
}

/**
 * A past verified match, reduced to just what Echo Damping needs: when it was
 * played and which four players were on court (team assignment doesn't
 * matter — a repeat fixture is the same four people, however the teams shake out).
 */
export interface FixtureOccurrence {
  readonly playedAt: number;
  readonly playerIds: readonly [PlayerId, PlayerId, PlayerId, PlayerId];
}

export interface MatchFactors {
  /** This player's team's pre-match win probability. */
  readonly expectancy: number;
  readonly margin: number;
  /** 1 = no damping (first meeting, or outside the 30-day window). */
  readonly echoDamping: number;
  readonly kUsed: number;
}

/**
 * One append-only Ledger entry. Emitted for every player in every applied
 * (verified, non-skipped) match.
 */
export interface LedgerEvent {
  readonly playerId: PlayerId;
  readonly matchId: MatchId;
  readonly delta: number;
  readonly ratingBefore: number;
  readonly ratingAfter: number;
  readonly confidenceBefore: number;
  readonly confidenceAfter: number;
  readonly factors: MatchFactors;
  readonly explanation: string;
}

export type ProcessMatchStatus = "applied" | "skipped";

export interface ProcessMatchInput {
  readonly match: MatchInput;
  /** Must contain a PlayerState for all four players in `match`. */
  readonly players: Readonly<Record<PlayerId, PlayerState>>;
  /**
   * Prior verified matches usable for Echo Damping detection. Only entries
   * whose four players exactly match the current match's four players, and
   * whose playedAt falls in the trailing 30-day window, affect the result —
   * callers may pass an unfiltered full match history.
   */
  readonly recentFixtures?: readonly FixtureOccurrence[];
  /** Optional display names, used only to make `explanation` read naturally. */
  readonly opponentNames?: Readonly<Record<PlayerId, string>>;
}

export interface ProcessMatchResult {
  readonly status: ProcessMatchStatus;
  /** Present when status is "skipped": "unverified" | "walkover" | "no-games-played" | "retired-no-games". */
  readonly reason?: string;
  readonly updatedPlayers?: Readonly<Record<PlayerId, PlayerState>>;
  readonly ledgerEvents?: readonly LedgerEvent[];
}
