import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { atlasStyle, ATLAS_FONTSTACK } from "@/lib/atlas/style";
import { ATLAS_ATTRIBUTION } from "@/lib/atlas/attribution";
import { blobSizePx } from "@/components/atlas/patch-blob";
import {
  markerKind,
  venueMarkerSpec,
  markerFeature,
  buildVenueMarker,
  buildClusterMarker,
  type AtlasMarker,
  type AtlasCluster,
} from "@/components/atlas/venue-marker";

const TILES = "pmtiles://http://localhost:8792/cuatro-london-z14.pmtiles";

function baseVenue(id: string, over: Partial<AtlasMarker["venue"]> = {}): AtlasMarker["venue"] {
  return { id, slug: id, name: id, lat: 51.5, lng: -0.05, indoorOutdoor: "outdoor", courtCount: 2, ...over };
}

/** One AtlasMarker of every rendered kind; exactly ONE is coral. */
function everyKind(): AtlasMarker[] {
  return [
    // home
    { venue: baseVenue("home"), openSeatCount: 0, soonestOpenSeat: null, circleCount: 2, homeToCount: 14, isViewerHome: true, quiet: false },
    // in-band coral open seat (the one coral moment)
    { venue: baseVenue("coral"), openSeatCount: 1, soonestOpenSeat: { sessionId: "s1", startsAt: 1, label: "Sun 10:00", inBand: true }, circleCount: 2, homeToCount: 14, isViewerHome: false, quiet: false, coral: true },
    // off-band open seat
    { venue: baseVenue("off"), openSeatCount: 1, soonestOpenSeat: { sessionId: "s2", startsAt: 2, label: "Mon 19:00", inBand: false }, circleCount: 1, homeToCount: 9, isViewerHome: false, quiet: false },
    // active venue (circles, no open seat)
    { venue: baseVenue("active"), openSeatCount: 0, soonestOpenSeat: null, circleCount: 2, homeToCount: 11, isViewerHome: false, quiet: false },
    // quiet venue
    { venue: baseVenue("quiet"), openSeatCount: 0, soonestOpenSeat: null, circleCount: 0, homeToCount: 0, isViewerHome: false, quiet: true },
    // just added
    { venue: baseVenue("new"), openSeatCount: 0, soonestOpenSeat: null, circleCount: 0, homeToCount: 0, isViewerHome: false, quiet: true, justAdded: true },
  ];
}

describe("atlasStyle", () => {
  for (const theme of ["dark", "light"] as const) {
    it(`produces a valid v8 style for ${theme}`, () => {
      const s = atlasStyle(theme, TILES);
      expect(s.version).toBe(8);
      expect(s.glyphs).toBe("/fonts/{fontstack}/{range}.pbf");
      // pmtiles source carries the passed URL + our attribution.
      const src = (s.sources as Record<string, { type: string; url?: string; attribution?: string }>).pm;
      expect(src.type).toBe("vector");
      expect(src.url).toBe(TILES);
      expect(src.attribution).toBe(ATLAS_ATTRIBUTION);
      // The layer set the map depends on.
      const ids = s.layers.map((l) => l.id);
      expect(ids).toEqual(
        expect.arrayContaining(["bg", "earth", "park", "water", "roads-minor", "roads-major", "hood-labels", "locality-labels"]),
      );
      // No labels below venue zoom except neighbourhoods (minzoom 13).
      const hood = s.layers.find((l) => l.id === "hood-labels")!;
      expect(hood.type).toBe("symbol");
      expect((hood as { minzoom?: number }).minzoom).toBe(13);
      expect((hood.layout as Record<string, unknown>)["text-font"]).toEqual([ATLAS_FONTSTACK]);
    });
  }

  it("differs per theme where it must (land colour)", () => {
    const dark = atlasStyle("dark", TILES);
    const light = atlasStyle("light", TILES);
    const bg = (id: string, s: ReturnType<typeof atlasStyle>) =>
      (s.layers.find((l) => l.id === id) as { paint?: Record<string, unknown> }).paint!["background-color"];
    expect(bg("bg", dark)).not.toBe(bg("bg", light));
    expect(bg("bg", dark)).toBe("#171a20");
    expect(bg("bg", light)).toBe("#ece8e0");
  });

  it("reads NEXT_PUBLIC_TILES_URL when no URL is passed", () => {
    const prev = process.env.NEXT_PUBLIC_TILES_URL;
    process.env.NEXT_PUBLIC_TILES_URL = "pmtiles://https://example/x.pmtiles";
    const s = atlasStyle("dark");
    expect((s.sources as Record<string, { url?: string }>).pm.url).toBe("pmtiles://https://example/x.pmtiles");
    process.env.NEXT_PUBLIC_TILES_URL = prev;
  });
});

describe("markerKind derivation", () => {
  it("maps signals to the right kind, with correct precedence", () => {
    const m = everyKind();
    expect(markerKind(m[0])).toBe("home");
    expect(markerKind(m[1])).toBe("seatCoral");
    expect(markerKind(m[2])).toBe("seatMuted");
    expect(markerKind(m[3])).toBe("active");
    expect(markerKind(m[4])).toBe("quiet");
    expect(markerKind(m[5])).toBe("justAdded");
  });

  it("just-added and home win over open seats / circles", () => {
    const homeWithSeat: AtlasMarker = { ...everyKind()[0], openSeatCount: 3, coral: true };
    expect(markerKind(homeWithSeat)).toBe("home");
  });
});

describe("venueMarkerSpec", () => {
  it("labels seats and circles in the sub-line", () => {
    const [home, coral, off, active] = everyKind();
    expect(venueMarkerSpec(home).sub).toBe("your patch anchors here");
    expect(venueMarkerSpec(coral).sub).toBe("1 seat · Sun 10:00");
    expect(venueMarkerSpec(off).sub).toBe("1 seat · off your band");
    expect(venueMarkerSpec(active).sub).toBe("2 Circles");
  });

  it("only the coral marker pulses; only just-added pops", () => {
    const specs = everyKind().map(venueMarkerSpec);
    expect(specs.filter((s) => s.pulse)).toHaveLength(1);
    expect(specs.find((s) => s.pulse)!.kind).toBe("seatCoral");
    expect(specs.filter((s) => s.pop)).toHaveLength(1);
    expect(specs.find((s) => s.pop)!.kind).toBe("justAdded");
  });
});

describe("markerFeature + one-coral invariant", () => {
  it("emits GeoJSON points with the clustering props", () => {
    const f = markerFeature(everyKind()[1]);
    expect(f.type).toBe("Feature");
    expect(f.geometry.coordinates).toEqual([-0.05, 51.5]);
    expect(f.properties!.venueId).toBe("coral");
    expect(f.properties!.coral).toBe(1);
    expect(f.properties!.inBandSeat).toBe(1);
  });

  it("at most one feature is tagged coral for a tagged view", () => {
    const feats = everyKind().map(markerFeature);
    expect(feats.filter((f) => f.properties!.coral === 1)).toHaveLength(1);
  });
});

describe("blobSizePx (patch size buckets)", () => {
  it("maps radius km to the design's fixed diameters", () => {
    expect(blobSizePx(1.2)).toBe(110); // tight
    expect(blobSizePx(2.5)).toBe(170); // local
    expect(blobSizePx(5)).toBe(240); // wide
  });
});

// ---- DOM builder smoke: run the real builders against a minimal element
// shim (vitest runs in the node env with no DOM, and we may not add jsdom). ----
describe("buildVenueMarker / buildClusterMarker (DOM output)", () => {
  beforeAll(() => {
    class FakeClassList {
      private s = new Set<string>();
      add(...c: string[]) { for (const x of c) this.s.add(x); }
      contains(c: string) { return this.s.has(c); }
    }
    interface FakeEl {
      style: Record<string, string>;
      dataset: Record<string, string>;
      classList: FakeClassList;
      className: string;
      children: FakeEl[];
      textContent: string;
      appendChild(c: FakeEl): void;
      addEventListener(): void;
    }
    const make = (): FakeEl => ({
      style: {},
      dataset: {},
      classList: new FakeClassList(),
      className: "",
      children: [],
      textContent: "",
      appendChild(c) { this.children.push(c); },
      addEventListener() {},
    });
    (globalThis as { document?: unknown }).document = { createElement: () => make() };
  });
  afterAll(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it("tags the root with kind + venueId and pulses only the coral marker", () => {
    const markers = everyKind();
    const coralEl = buildVenueMarker(markers[1]) as unknown as {
      dataset: Record<string, string>;
      children: { classList: { contains(c: string): boolean } }[];
    };
    expect(coralEl.dataset.kind).toBe("seatCoral");
    expect(coralEl.dataset.venueId).toBe("coral");
    expect(coralEl.children[0].classList.contains("animate-cu-seat-pulse")).toBe(true);

    const quietEl = buildVenueMarker(markers[4]) as unknown as {
      children: { classList: { contains(c: string): boolean } }[];
    };
    expect(quietEl.children[0].classList.contains("animate-cu-seat-pulse")).toBe(false);

    // Exactly one coral pulse across the whole tagged view.
    const pulsing = markers
      .map((m) => buildVenueMarker(m) as unknown as { children: { classList: { contains(c: string): boolean } }[] })
      .filter((el) => el.children[0].classList.contains("animate-cu-seat-pulse"));
    expect(pulsing).toHaveLength(1);
  });

  it("cluster marker shows the venue count", () => {
    const el = buildClusterMarker(214, "LONDON") as unknown as {
      dataset: Record<string, string>;
      children: { textContent: string }[];
    };
    expect(el.dataset.clusterCount).toBe("214");
    expect(el.children[0].textContent).toBe("214");
    expect(el.children[1].textContent).toBe("LONDON");
  });

  it("country-view AtlasCluster feeds the cluster card (count + area caption)", () => {
    // The no-patch country view renders pre-aggregated AtlasClusters through
    // the same 42px card builder (venueCount + area name).
    const c: AtlasCluster = { area: "London", venueCount: 214, lat: 51.5, lng: -0.12 };
    const el = buildClusterMarker(c.venueCount, c.area) as unknown as {
      dataset: Record<string, string>;
      children: { textContent: string }[];
    };
    expect(el.dataset.clusterCount).toBe("214");
    expect(el.children[0].textContent).toBe("214");
    expect(el.children[1].textContent).toBe("London"); // caps applied by CSS text-transform
  });
});
