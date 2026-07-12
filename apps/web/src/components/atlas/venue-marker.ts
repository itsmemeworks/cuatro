/**
 * THE ATLAS marker DOM builders (design/HANDOFF-DELTA-ATLAS.md "Marker
 * system" table). Every marker is a plain HTMLElement handed to a maplibre
 * `Marker` (anchor: center) — maplibre owns the element's positioning
 * transform, so nothing here sets `transform` on the root; animations that
 * scale (pop) run on the circle child instead.
 *
 * Colours are CSS custom properties (--color-*), not per-theme hex, so markers
 * re-theme automatically off the app's `data-theme` exactly like the rest of
 * the UI — the theme swap is free, no rebuild on toggle. Values map from the
 * design's tokens: tBone→ink, tOnBone→ground, tCoral→action, tCoralTx→
 * action-strong, tCard→surface, tAmberC→streak, tGoodC→win, tInkNN→a mix of
 * --color-ink at NN%.
 *
 * The "one coral moment per panel" law is NOT decided here: the caller sets
 * `coral` on exactly one marker (the single best in-band open seat) and this
 * module renders coral iff that flag is set. Every other open-seat venue
 * renders the muted dashed style.
 */

/** The Atlas server view's per-venue shape. PLACEHOLDER until T1's
 * `@/server/atlas` (getAtlasView) lands — mirror this there and the lead
 * reconciles the import. Field names match the venues schema
 * (packages/db/src/schema/venues.ts): indoorOutdoor + courtCount, nullable. */
export type IndoorOutdoor = "indoor" | "outdoor" | "mixed";

export interface AtlasVenue {
  id: string;
  slug: string | null;
  name: string;
  lat: number;
  lng: number;
  indoorOutdoor: IndoorOutdoor | null;
  courtCount: number | null;
}

export interface AtlasSoonestSeat {
  sessionId: string;
  /** UTC epoch ms. */
  startsAt: number;
  /** Pre-formatted short label, e.g. "Sun 10:00" (server formats in the venue's tz). */
  label: string;
  /** Within the viewer's Glass band. */
  inBand: boolean;
}

export interface AtlasMarker {
  venue: AtlasVenue;
  openSeatCount: number;
  soonestOpenSeat: AtlasSoonestSeat | null;
  circleCount: number;
  /** Players who call this venue home (the trust signal). */
  homeToCount: number;
  /** This venue is the viewer's own home court (the patch anchor). */
  isViewerHome: boolean;
  /** No Circles, no open seats — a faint dot. */
  quiet: boolean;
  /**
   * Set by the CALLER on at most ONE marker: the single best open seat, in
   * band, soonest. Renders dashed coral + pulse. Never decided in this module.
   */
  coral?: boolean;
  /** Freshly added by this viewer this session → amber just-added marker with a pop-in. */
  justAdded?: boolean;
}

/**
 * A PRE-AGGREGATED country-view cluster ("THE UK, ROUGHLY", design screen 8).
 * PLACEHOLDER until T1's `@/server/atlas` exports it — `getAtlasView` returns
 * `markers: []` + `clusters: AtlasCluster[]` in the no-patch state. These are
 * NOT the map's own GeoJSON clusters; they render as standalone cluster cards
 * at their centroid and are never re-clustered.
 */
export interface AtlasCluster {
  /** Region caption, e.g. "London" (rendered mono caps). */
  area: string;
  venueCount: number;
  lat: number;
  lng: number;
}

export type MarkerKind =
  | "home"
  | "seatCoral"
  | "seatMuted"
  | "active"
  | "quiet"
  | "justAdded";

/** Ink at a given alpha, theme-reactive (mirrors the design's tInkNN tokens). */
const ink = (pct: number) => `color-mix(in srgb, var(--color-ink) ${pct}%, transparent)`;

/** Legibility shadow over the themed map canvas (design tTs, approximated with
 * the ground colour which matches the token's base in both themes). */
const LABEL_SHADOW = "0 1px 5px var(--color-ground), 0 0 2px var(--color-ground)";

const SANS = "var(--c4-font-sans)";
const MONO = "var(--c4-font-mono)";

/** Derive the visual kind from an AtlasMarker's signals. Order matters:
 * a just-added marker and the viewer's home win over seat/active/quiet. */
export function markerKind(m: AtlasMarker): MarkerKind {
  if (m.justAdded) return "justAdded";
  if (m.isViewerHome) return "home";
  if (m.coral) return "seatCoral";
  if (m.openSeatCount > 0) return "seatMuted";
  if (m.circleCount > 0) return "active";
  return "quiet";
}

/** The sub-line under a marker for its kind. */
function subLine(m: AtlasMarker, kind: MarkerKind): string {
  switch (kind) {
    case "home":
      return "your patch anchors here";
    case "seatCoral": {
      const n = m.openSeatCount;
      const when = m.soonestOpenSeat ? ` · ${m.soonestOpenSeat.label}` : "";
      return `${n} seat${n === 1 ? "" : "s"}${when}`;
    }
    case "seatMuted": {
      const n = m.openSeatCount;
      if (m.soonestOpenSeat && m.soonestOpenSeat.inBand) return `${n} seat${n === 1 ? "" : "s"} · ${m.soonestOpenSeat.label}`;
      return `${n} seat${n === 1 ? "" : "s"} · off your band`;
    }
    case "active":
      return `${m.circleCount} Circle${m.circleCount === 1 ? "" : "s"}`;
    case "justAdded":
      return "just added · by you";
    case "quiet":
      return "";
  }
}

interface CircleSpec {
  size: number;
  bg: string;
  border: string;
  color: string;
  glyph: string;
  font: string;
  ring?: string;
  pulse?: boolean;
  pop?: boolean;
}

function circleSpec(m: AtlasMarker, kind: MarkerKind): CircleSpec {
  switch (kind) {
    case "home":
      return {
        size: 30,
        bg: "var(--color-ink)",
        border: "none",
        color: "var(--color-ground)",
        glyph: "◆",
        font: `800 12px ${SANS}`,
        ring: `0 0 0 5px var(--color-ink-hairline-2)`,
      };
    case "seatCoral":
      return {
        size: 36,
        bg: "var(--color-surface)",
        border: "2px dashed var(--color-action)",
        color: "var(--color-action-strong)",
        glyph: String(Math.max(1, m.openSeatCount)),
        font: `700 12px ${MONO}`,
        pulse: true,
      };
    case "seatMuted":
      return {
        size: 32,
        bg: "var(--color-surface)",
        border: `2px dashed ${ink(35)}`,
        color: ink(60),
        glyph: String(Math.max(1, m.openSeatCount)),
        font: `700 12px ${MONO}`,
      };
    case "active":
      return {
        size: 32,
        bg: "var(--color-surface)",
        border: `1.5px solid var(--color-ink-hairline-4)`,
        color: "var(--color-ink)",
        glyph: String(m.circleCount),
        font: `700 12px ${MONO}`,
      };
    case "justAdded":
      return {
        size: 18,
        bg: "var(--color-surface)",
        border: "2px solid var(--color-streak)",
        color: "transparent",
        glyph: "",
        font: `700 12px ${MONO}`,
        pop: true,
      };
    case "quiet":
      return {
        size: 13,
        bg: "transparent",
        border: `2px solid ${ink(30)}`,
        color: "transparent",
        glyph: "",
        font: `700 12px ${MONO}`,
      };
  }
}

/** Name-label colour + sub-line colour for the kind. */
function labelColors(kind: MarkerKind): { name: string; sub: string } {
  switch (kind) {
    case "seatCoral":
      return { name: "var(--color-ink)", sub: "var(--color-action-strong)" };
    case "justAdded":
      return { name: "var(--color-ink)", sub: "var(--color-streak)" };
    case "quiet":
      return { name: ink(50), sub: ink(35) };
    default:
      return { name: "var(--color-ink)", sub: ink(45) };
  }
}

/**
 * Pure description of a venue marker's rendering — the single source the DOM
 * builder consumes, and what tests assert against without needing a DOM. If
 * `pulse` is true the marker is the panel's one coral moment.
 */
export interface VenueMarkerSpec {
  kind: MarkerKind;
  size: number;
  glyph: string;
  sub: string;
  /** Coral open-seat pulse ring (the one coral moment). */
  pulse: boolean;
  /** Just-added pop-in. */
  pop: boolean;
}

export function venueMarkerSpec(m: AtlasMarker): VenueMarkerSpec {
  const kind = markerKind(m);
  const spec = circleSpec(m, kind);
  return {
    kind,
    size: spec.size,
    glyph: spec.glyph,
    sub: subLine(m, kind),
    pulse: !!spec.pulse,
    pop: !!spec.pop,
  };
}

/**
 * Build the DOM element for a venue marker. The root is a 44px-min hit area
 * (design: "visual sizes sit inside a 44px hit area") laid out as a column:
 * the circle, then the Archivo name label, then the Plex Mono sub-line.
 */
export function buildVenueMarker(m: AtlasMarker): HTMLElement {
  const kind = markerKind(m);
  const spec = circleSpec(m, kind);
  const colors = labelColors(kind);

  const root = document.createElement("div");
  root.className = "cu-atlas-marker";
  root.dataset.kind = kind;
  root.dataset.venueId = m.venue.id;
  Object.assign(root.style, {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    cursor: "pointer",
    userSelect: "none",
    // 44px hit area centred on the circle (design accessibility rule).
    minWidth: "44px",
    minHeight: "44px",
    justifyContent: "center",
  } satisfies Partial<CSSStyleDeclaration>);

  const circle = document.createElement("div");
  circle.className = "cu-atlas-marker__dot";
  if (spec.pulse) circle.classList.add("animate-cu-seat-pulse");
  if (spec.pop) circle.classList.add("animate-cu-marker-pop");
  Object.assign(circle.style, {
    boxSizing: "border-box",
    width: `${spec.size}px`,
    height: `${spec.size}px`,
    borderRadius: "50%",
    background: spec.bg,
    border: spec.border,
    color: spec.color,
    font: spec.font,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: spec.ring ?? "none",
  } satisfies Partial<CSSStyleDeclaration>);
  if (spec.glyph) circle.textContent = spec.glyph;
  root.appendChild(circle);

  // Quiet venues carry only a faint name; everyone else gets name + sub-line.
  const name = document.createElement("div");
  name.className = "cu-atlas-marker__name";
  Object.assign(name.style, {
    marginTop: "5px",
    font: `700 10.5px ${SANS}`,
    color: colors.name,
    textShadow: LABEL_SHADOW,
    whiteSpace: "nowrap",
  } satisfies Partial<CSSStyleDeclaration>);
  name.textContent = m.venue.name;
  root.appendChild(name);

  const sub = subLine(m, kind);
  if (sub) {
    const subEl = document.createElement("div");
    subEl.className = "cu-atlas-marker__sub";
    Object.assign(subEl.style, {
      marginTop: "2px",
      font: `500 10px ${MONO}`,
      color: colors.sub,
      textShadow: LABEL_SHADOW,
      whiteSpace: "nowrap",
    } satisfies Partial<CSSStyleDeclaration>);
    subEl.textContent = sub;
    root.appendChild(subEl);
  }

  return root;
}

/**
 * Build a cluster marker (design: "42px card, 1px tInk18, mono count tInk7,
 * city name mono caps tInk45; count = venue count"). `label` is the caption
 * shown under the bubble (city name for country view, empty otherwise).
 */
export function buildClusterMarker(count: number, label?: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "cu-atlas-cluster";
  root.dataset.clusterCount = String(count);
  Object.assign(root.style, {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    cursor: "pointer",
    userSelect: "none",
    minWidth: "44px",
    minHeight: "44px",
    justifyContent: "center",
  } satisfies Partial<CSSStyleDeclaration>);

  const bubble = document.createElement("div");
  Object.assign(bubble.style, {
    boxSizing: "border-box",
    width: "42px",
    height: "42px",
    borderRadius: "50%",
    background: "var(--color-surface)",
    border: `1px solid var(--color-ink-hairline-3)`,
    color: ink(70),
    font: `700 12px ${MONO}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 14px 34px rgba(0,0,0,.35)",
  } satisfies Partial<CSSStyleDeclaration>);
  bubble.textContent = String(count);
  root.appendChild(bubble);

  if (label) {
    const cap = document.createElement("div");
    Object.assign(cap.style, {
      marginTop: "5px",
      font: `600 10px ${MONO}`,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: ink(45),
      textShadow: LABEL_SHADOW,
      whiteSpace: "nowrap",
    } satisfies Partial<CSSStyleDeclaration>);
    cap.textContent = label;
    root.appendChild(cap);
  }

  return root;
}

/** GeoJSON Feature for one venue marker — the source shape the map clusters over. */
export function markerFeature(m: AtlasMarker): GeoJSON.Feature<GeoJSON.Point> {
  const kind = markerKind(m);
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [m.venue.lng, m.venue.lat] },
    properties: {
      venueId: m.venue.id,
      kind,
      coral: m.coral ? 1 : 0,
      openSeats: m.openSeatCount,
      circles: m.circleCount,
      inBandSeat: m.soonestOpenSeat?.inBand ? 1 : 0,
    },
  };
}
