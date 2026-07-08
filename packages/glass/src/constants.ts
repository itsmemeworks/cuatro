/**
 * GLASS tuning constants. See README.md for the reasoning behind every
 * number that isn't lifted verbatim from DESIGN.md section 2.
 */

/** Display/storage scale bounds. Ratings are always clamped and rounded to 2dp. */
export const SCALE_MIN = 1.0;
export const SCALE_MAX = 7.0;

/** Hidden starting rating for a brand-new player with no placement prior. */
export const DEFAULT_STARTING_RATING = 3.0;

/** A player is "Unrated" until this many verified matches are complete. */
export const PLACEMENT_TRIO_SIZE = 3;

/** K-factor while a player is inside their Placement Trio (their first 3 verified matches). */
export const PLACEMENT_K = 0.12;

/** K-factor once a player has completed Placement. */
export const STABLE_K = 0.04;

/** Confidence gained per brand-new verified opponent, in percentage points. */
export const CONFIDENCE_STEP = 8;

/** Confidence never exceeds this value — Glass never claims certainty. */
export const CONFIDENCE_CAP = 95;

export const CONFIDENCE_FLOOR = 0;

/**
 * How much extra a low-confidence player's rating moves, on top of the
 * Placement/Stable K split. See README "Confidence scaling" for the formula
 * and worked numbers. 0.25 means a 0%-confidence player's delta magnitude is
 * boosted by up to +25%, tapering to +~1.3% boost at the 95% confidence cap.
 */
export const CONFIDENCE_DELTA_BOOST_RANGE = 0.25;

/** Echo Damping: repeat-fixture decay base. 2nd meeting = ^1, 3rd = ^2, ... */
export const ECHO_DAMPING_BASE = 0.6;

/** Echo Damping only looks back this far for repeat-fixture detection. */
export const ECHO_DAMPING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** The divisor in the Elo win-expectancy exponent: 10^(-(Ra-Rb)/ELO_DIVISOR). */
export const ELO_DIVISOR = 0.5;
