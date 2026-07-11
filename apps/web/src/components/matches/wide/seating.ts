/**
 * Court-side seating for the wide record-a-result roster (issue #21).
 *
 * The 2v2 grid seats each pair the way they'd actually stand on court: team
 * A's column reads drive (right side) on top, backhand (left side) below;
 * team B's column is the mirror, backhand on top, drive below — so the two
 * players who'd face each other across the net sit on the same grid row,
 * exactly as the design's step 2 shows (Sam drive / Mags backhand vs Kav
 * backhand / Tom drive).
 *
 * SOFT SIGNAL ONLY: a preference just picks the DEFAULT seat. null or 'both'
 * expresses no preference, and every swap stays completely free — nothing
 * here gates, filters, or feeds Glass or rotation.
 */

export interface Seatable {
  /** users.courtSide: 'right' = drive, 'left' = backhand. */
  courtSide: "right" | "left" | "both" | null;
}

/** The court side a given seat represents: team A tops with drive, team B mirrors. */
export function seatSide(team: "A" | "B", seat: 0 | 1): "right" | "left" {
  const topIsDrive = team === "A";
  const isTop = seat === 0;
  return isTop === topIsDrive ? "right" : "left";
}

/**
 * Orders a pair into its two seats. Swaps only when the players' stated
 * preferences actually argue for it; a null/'both' player never displaces
 * anyone, and two same-side players keep their incoming order.
 */
export function seatPair<T extends Seatable>(pair: readonly [T, T], team: "A" | "B"): [T, T] {
  const [p, q] = pair;
  const top = seatSide(team, 0);
  const bottom = seatSide(team, 1);
  const wants = (player: T, side: "right" | "left") => player.courtSide === side;

  // q claims the top seat p doesn't want, or p claims the bottom seat q
  // doesn't want — either way they trade. Everything else stays put.
  if (wants(q, top) && !wants(p, top)) return [q, p];
  if (wants(p, bottom) && !wants(q, bottom)) return [q, p];
  return [p, q];
}
