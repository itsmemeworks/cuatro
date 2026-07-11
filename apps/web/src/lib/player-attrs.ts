/**
 * Dominant hand + court side vocabulary (GitHub issue #21). Both fields are
 * optional and nullable forever, and they are SOFT SIGNALS ONLY: they never
 * gate joining anything, never filter a Fourth Call, and never affect Glass,
 * rotation, or matchmaking. Real padel lingo for the sides: right side =
 * drive, left side = backhand.
 *
 * Schema columns: users.dominant_hand / users.court_side (packages/db).
 * Lead-seeded for Wave C — shared across territories, edit via the lead.
 */

export const DOMINANT_HANDS = [
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "both", label: "Both" },
] as const;

export type DominantHand = (typeof DOMINANT_HANDS)[number]["id"];

export const COURT_SIDES = [
  { id: "right", label: "Right side", lingo: "drive", short: "Drive" },
  { id: "left", label: "Left side", lingo: "backhand", short: "Backhand" },
  { id: "both", label: "Both", lingo: null, short: "Both" },
] as const;

export type CourtSide = (typeof COURT_SIDES)[number]["id"];

export function courtSide(id: string | null | undefined) {
  return COURT_SIDES.find((s) => s.id === id) ?? null;
}

export function dominantHand(id: string | null | undefined) {
  return DOMINANT_HANDS.find((h) => h.id === id) ?? null;
}

/** Mono-fact rendering for profiles, e.g. "Right side (drive)". Null when unset. */
export function courtSideFact(id: string | null | undefined): string | null {
  const side = courtSide(id);
  if (!side) return null;
  return side.lingo ? `${side.label} (${side.lingo})` : side.label;
}
