import {
  CONFIDENCE_CAP,
  CONFIDENCE_DELTA_BOOST_RANGE,
  CONFIDENCE_FLOOR,
  ECHO_DAMPING_BASE,
  ECHO_DAMPING_WINDOW_MS,
  ELO_DIVISOR,
  PLACEMENT_K,
  PLACEMENT_TRIO_SIZE,
  SCALE_MAX,
  SCALE_MIN,
  STABLE_K,
} from "./constants.js";
import type { FixtureOccurrence, PlayerId } from "./types.js";

/** Rounds to 2 decimal places, correcting for binary floating point drift. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function clampRating(value: number): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, value));
}

export function clampConfidence(value: number): number {
  return Math.min(CONFIDENCE_CAP, Math.max(CONFIDENCE_FLOOR, value));
}

/**
 * Standard Elo win expectancy on a 1-7 scale: P(self) = 1 / (1 + 10^(-(Rself-Ropp)/0.5)).
 * The 0.5 divisor is what makes a 0.5-point rating gap play like a "normal"
 * Elo gap — see DESIGN.md's worked example (0.10 gap -> P = 0.613).
 */
export function winExpectancy(ratingSelf: number, ratingOpponent: number): number {
  return 1 / (1 + Math.pow(10, -(ratingSelf - ratingOpponent) / ELO_DIVISOR));
}

/**
 * 1 + (gamesWonShare - 0.5), where gamesWonShare is the WINNING team's share
 * of total games played. A single scalar is computed per match and applied
 * to both teams' deltas (see README "Margin multiplier is match-wide, not
 * per-team" for why: using each team's own share would shrink the loser's
 * penalty on a blowout, which is backwards).
 */
export function marginMultiplier(winningTeamGamesWon: number, totalGames: number): number {
  if (totalGames <= 0) return 1;
  const share = winningTeamGamesWon / totalGames;
  return 1 + (share - 0.5);
}

/** K = 0.12 for a player's first PLACEMENT_TRIO_SIZE verified matches, else 0.04. */
export function kFor(matchesPlayedBeforeThisMatch: number): number {
  return matchesPlayedBeforeThisMatch < PLACEMENT_TRIO_SIZE ? PLACEMENT_K : STABLE_K;
}

/**
 * Continuous, monotonically decreasing boost applied on top of the
 * Placement/Stable K split so "low-confidence players move more" holds even
 * within a K tier (e.g. a Placement player facing only repeat opponents).
 * confidence=0 -> 1+CONFIDENCE_DELTA_BOOST_RANGE; confidence=95 (the cap) ->
 * 1 + 0.05*CONFIDENCE_DELTA_BOOST_RANGE (~1.0125 at the default 0.25 range).
 */
export function confidenceMultiplier(confidenceBefore: number): number {
  return 1 + (1 - confidenceBefore / 100) * CONFIDENCE_DELTA_BOOST_RANGE;
}

/** Order-independent identity for "the same four players", used by Echo Damping. */
export function fixtureKey(playerIds: readonly PlayerId[]): string {
  return [...playerIds].sort().join("|");
}

export interface EchoDampingResult {
  /** 0.6^(occurrence-1). 1 means no damping (first meeting, or stale history). */
  readonly multiplier: number;
  /** 1 = first meeting, 2 = second meeting within the window, etc. */
  readonly occurrence: number;
}

/**
 * Counts how many times these exact four players have played each other in
 * the 30 days strictly before `currentPlayedAt`, and returns the resulting
 * decay multiplier (2nd occurrence x0.6, 3rd x0.36, ...).
 */
export function echoDamping(
  currentPlayedAt: number,
  currentPlayerIds: readonly PlayerId[],
  history: readonly FixtureOccurrence[],
): EchoDampingResult {
  const key = fixtureKey(currentPlayerIds);
  const windowStart = currentPlayedAt - ECHO_DAMPING_WINDOW_MS;
  const priorCount = history.filter(
    (entry) =>
      entry.playedAt >= windowStart &&
      entry.playedAt < currentPlayedAt &&
      fixtureKey(entry.playerIds) === key,
  ).length;
  const occurrence = priorCount + 1;
  const multiplier = Math.pow(ECHO_DAMPING_BASE, occurrence - 1);
  return { multiplier, occurrence };
}
