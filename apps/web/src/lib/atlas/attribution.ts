/**
 * THE ATLAS attribution line (design/HANDOFF-DELTA-ATLAS.md: "Attribution
 * bottom-right, mono 10px: `CUATRO tiles · © OpenStreetMap`"). MapLibre's
 * default AttributionControl is disabled on every Atlas map; atlas-map renders
 * this string in its own 10px IBM Plex Mono element bottom-right.
 *
 * Middle-dot separator (· = U+00B7), never an em dash. This is data, not a
 * component, so the mini-map and any future embed share exactly one source.
 */
export const ATLAS_ATTRIBUTION = "CUATRO tiles · © OpenStreetMap";
