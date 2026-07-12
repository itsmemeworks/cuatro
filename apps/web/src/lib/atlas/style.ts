/**
 * THE ATLAS MapLibre style (design/HANDOFF-DELTA-ATLAS.md "Map tile styling
 * tokens"). The map must look like CUATRO, not a satnav: a token-generated
 * vector style over a self-hosted Protomaps PMTiles source, with no default
 * blue web-map look and no labels below venue zoom except neighbourhood names.
 *
 * Theme swap is `map.setStyle(atlasStyle(next), { diff: true })` — MapLibre
 * diffs paint props without reloading tiles or losing the camera. So this
 * function is the single source for both themes; keep it PURE (no window, no
 * env read at module load — the tiles URL is a parameter).
 *
 * Token values MIRROR globals.css (--color-map-*). If a token changes there,
 * change it here; atlas-style.test.ts asserts both theme objects exist and are
 * shaped, and the marker/blob DOM reads the CSS vars directly so they can't
 * drift, but these tile colours are baked into the GL style and must be kept
 * in step by hand.
 */
import type { StyleSpecification } from "maplibre-gl";
import { ATLAS_ATTRIBUTION } from "./attribution";

export type AtlasTheme = "dark" | "light";

/** The map/label palette per theme — mirrors globals.css --color-map-* + tInk35. */
const TOKENS: Record<AtlasTheme, {
  land: string;
  road1: string;
  road2: string;
  park: string;
  water: string;
  /** Neighbourhood / locality label ink = tInk35 for the theme. */
  label: string;
  /** Halo behind labels for legibility = the land colour (opaque). */
  labelHalo: string;
}> = {
  dark: {
    land: "#171a20",
    road1: "#242933",
    road2: "#20242d",
    park: "rgba(75, 201, 139, 0.08)",
    water: "rgba(120, 170, 255, 0.1)",
    label: "rgba(245, 242, 236, 0.35)",
    labelHalo: "#171a20",
  },
  light: {
    land: "#ece8e0",
    road1: "#dbd5c9",
    road2: "#e2ddd2",
    park: "rgba(31, 138, 91, 0.1)",
    water: "rgba(90, 130, 200, 0.14)",
    label: "rgba(25, 23, 19, 0.35)",
    labelHalo: "#ece8e0",
  },
};

/** Fontstack folder name under /public/fonts — must match the generated glyph PBFs exactly. */
export const ATLAS_FONTSTACK = "IBM Plex Mono Regular";

const SOURCE_ID = "pm";

/**
 * Build the full MapLibre style for a theme.
 *
 * @param theme    'dark' | 'light'
 * @param tilesUrl The pmtiles:// source URL (defaults to NEXT_PUBLIC_TILES_URL).
 *                 Shape: `pmtiles://<http(s) url to the .pmtiles file>`; the
 *                 pmtiles Protocol (registered once in the client) reads it by
 *                 HTTP Range. Passed explicitly in tests so the fn stays pure.
 */
export function atlasStyle(
  theme: AtlasTheme,
  tilesUrl: string = process.env.NEXT_PUBLIC_TILES_URL ?? "",
): StyleSpecification {
  const t = TOKENS[theme];
  return {
    version: 8,
    name: `CUATRO Atlas (${theme})`,
    glyphs: "/fonts/{fontstack}/{range}.pbf",
    sources: {
      [SOURCE_ID]: {
        type: "vector",
        url: tilesUrl,
        attribution: ATLAS_ATTRIBUTION,
      },
    },
    layers: [
      {
        id: "bg",
        type: "background",
        paint: { "background-color": t.land },
      },
      {
        id: "earth",
        type: "fill",
        source: SOURCE_ID,
        "source-layer": "earth",
        paint: { "fill-color": t.land },
      },
      {
        id: "park",
        type: "fill",
        source: SOURCE_ID,
        "source-layer": "landuse",
        filter: [
          "in",
          ["get", "kind"],
          ["literal", ["park", "forest", "golf_course", "nature_reserve", "recreation_ground", "grass", "wood"]],
        ],
        paint: { "fill-color": t.park },
      },
      {
        id: "water",
        type: "fill",
        source: SOURCE_ID,
        "source-layer": "water",
        paint: { "fill-color": t.water },
      },
      {
        id: "roads-minor",
        type: "line",
        source: SOURCE_ID,
        "source-layer": "roads",
        filter: ["==", ["get", "kind"], "minor_road"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": t.road2,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.4, 16, 2.5],
        },
      },
      {
        id: "roads-major",
        type: "line",
        source: SOURCE_ID,
        "source-layer": "roads",
        filter: ["in", ["get", "kind"], ["literal", ["highway", "major_road"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": t.road1,
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.6, 16, 4],
        },
      },
      // Neighbourhood names only appear from z13 up (no labels below venue zoom).
      {
        id: "hood-labels",
        type: "symbol",
        source: SOURCE_ID,
        "source-layer": "places",
        filter: ["==", ["get", "kind"], "neighbourhood"],
        minzoom: 13,
        layout: {
          "text-field": ["get", "name"],
          "text-font": [ATLAS_FONTSTACK],
          "text-size": 10,
          "text-letter-spacing": 0.02,
          "text-transform": "none",
          "text-max-width": 7,
        },
        paint: {
          "text-color": t.label,
          "text-halo-color": t.labelHalo,
          "text-halo-width": 1,
        },
      },
      // Town/city names for the country ("THE UK, ROUGHLY") view — gated on
      // population_rank so only the biggest places label when zoomed right out,
      // and dropped once neighbourhoods take over.
      {
        id: "locality-labels",
        type: "symbol",
        source: SOURCE_ID,
        "source-layer": "places",
        filter: [
          "all",
          ["==", ["get", "kind"], "locality"],
          [">=", ["coalesce", ["get", "population_rank"], 0], 8],
        ],
        minzoom: 4,
        maxzoom: 13,
        layout: {
          "text-field": ["get", "name"],
          "text-font": [ATLAS_FONTSTACK],
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, 9, 10, 12],
          "text-letter-spacing": 0.04,
          "text-transform": "uppercase",
          "text-max-width": 8,
        },
        paint: {
          "text-color": t.label,
          "text-halo-color": t.labelHalo,
          "text-halo-width": 1,
        },
      },
    ],
  };
}
