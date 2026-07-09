/**
 * Directions chip (design/HANDOFF.md's Standing Game "where" card and the
 * guest done screen) — a plain Google Maps search URL keyed off whatever
 * location text we have. No Places API dependency at v0 (venues.ts's own
 * comment: "we don't own a club directory yet").
 */
export function googleMapsUrl(query: string): string {
  return `https://maps.google.com/?q=${encodeURIComponent(query)}`;
}

/** Prefers a full street address over the bare venue name when both are known. */
export function venueDirectionsUrl(venue: { name: string; address?: string | null } | null | undefined): string | null {
  if (!venue) return null;
  return googleMapsUrl(venue.address || venue.name);
}
