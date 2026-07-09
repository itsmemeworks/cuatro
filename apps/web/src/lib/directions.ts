/**
 * Directions chips (design/HANDOFF.md's Standing Game "where" card, the
 * guest done screen, and design/DESIGN-AUDIT.md S1's Google/Apple Maps
 * buttons) — plain map-app search URLs keyed off whatever location text we
 * have. No Places API dependency at v0 (venues.ts's own comment: "we don't
 * own a club directory yet").
 */
export function googleMapsUrl(query: string): string {
  return `https://maps.google.com/?q=${encodeURIComponent(query)}`;
}

/** Apple Maps' equivalent search-by-query URL scheme (opens the Maps app on iOS, maps.apple.com elsewhere). */
export function appleMapsUrl(query: string): string {
  return `https://maps.apple.com/?q=${encodeURIComponent(query)}`;
}

/** Prefers a full street address over the bare venue name when both are known. */
export function venueDirectionsUrl(venue: { name: string; address?: string | null } | null | undefined): string | null {
  if (!venue) return null;
  return googleMapsUrl(venue.address || venue.name);
}

/** Apple Maps counterpart to venueDirectionsUrl — same address-over-name preference. */
export function venueAppleMapsUrl(venue: { name: string; address?: string | null } | null | undefined): string | null {
  if (!venue) return null;
  return appleMapsUrl(venue.address || venue.name);
}
