"use client";

/**
 * THE ATLAS live map (the real maplibre-gl instance). Loaded only via the
 * ssr:false wrapper in atlas-map.tsx — never import this directly (it touches
 * `window`). maplibre-gl + pmtiles are behind that dynamic import so they
 * never enter the server bundle or any non-map route.
 *
 * Rendering model (stack decision doc): a Protomaps PMTiles vector source
 * styled from tokens (lib/atlas/style.ts), with venue markers as DOM elements
 * synced from a clustered GeoJSON source via the querySourceFeatures pattern.
 * The "one coral moment" invariant is decided upstream (caller tags one
 * marker `coral`); we only render it. At most one live GL map per screen.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { atlasStyle, type AtlasTheme } from "@/lib/atlas/style";
import { ATLAS_ATTRIBUTION } from "@/lib/atlas/attribution";
import { registerPmtilesProtocol } from "@/lib/atlas/pmtiles-protocol";
import {
  buildVenueMarker,
  buildClusterMarker,
  markerFeature,
  type AtlasMarker,
  type AtlasCluster,
} from "./venue-marker";
import { PatchBlob } from "./patch-blob";

export interface AtlasPatch {
  lat: number;
  lng: number;
  radiusKm: number;
}

export interface AtlasMapProps {
  /** Force a theme. Omitted → auto-follow the app's data-theme (and OS scheme). */
  theme?: AtlasTheme;
  markers: AtlasMarker[];
  /**
   * Pre-aggregated country-view clusters ("THE UK, ROUGHLY"). Rendered as
   * cluster cards at their centroids when the viewer has no patch (server
   * returns markers=[] + clusters here). Independent of the map's own
   * self-clustering of `markers`. Non-interactive by design.
   */
  clusters?: AtlasCluster[];
  /** The camera home + patch blob. null → UK country view, clusters only, no blob. */
  patch: AtlasPatch | null;
  onMarkerTap: (venueId: string) => void;
  onClusterTap?: (clusterId: number, lngLat: [number, number]) => void;
  className?: string;
}

const SOURCE_ID = "venues";
const UK_CENTER: [number, number] = [-2.9, 54.3];
const UK_ZOOM = 4.7;

/** Camera zoom for a patch radius — tighter patches open closer in. */
function zoomForRadius(radiusKm: number): number {
  if (radiusKm <= 1.5) return 13.4;
  if (radiusKm <= 3.5) return 12.5;
  return 11.7;
}

/** Read the app's current theme from the document (data-theme wins, else OS). */
function readTheme(): AtlasTheme {
  if (typeof document === "undefined") return "dark";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export default function AtlasMapClient({
  theme: themeProp,
  markers,
  clusters,
  patch,
  onMarkerTap,
  onClusterTap,
  className,
}: AtlasMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // StrictMode (dev) runs the build effect setup→cleanup→setup synchronously.
  // maplibre's map.remove() tears down the shared worker pool, and a map
  // created in the same tick can't load. So cleanup DEFERS removal to a
  // macrotask and the immediate re-setup cancels it, reusing the one map.
  const removalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markerElsRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  // Pre-aggregated country-view cluster cards (own DOM Markers, maplibre keeps
  // them positioned by lng/lat — no self-clustering, no move-sync needed).
  const countryClusterEls = useRef<maplibregl.Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);

  // Live refs so the map's own event handlers always see current props without
  // re-binding (the map is built once).
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const clustersRef = useRef(clusters);
  clustersRef.current = clusters;
  const onMarkerTapRef = useRef(onMarkerTap);
  onMarkerTapRef.current = onMarkerTap;
  const onClusterTapRef = useRef(onClusterTap);
  onClusterTapRef.current = onClusterTap;

  // Render the pre-aggregated country-view cluster cards. Reads current props
  // via refs so it stays stable and callable from both the map's load handler
  // and the clusters-change effect.
  const renderCountryClusters = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of countryClusterEls.current) m.remove();
    countryClusterEls.current = [];
    for (const c of clustersRef.current ?? []) {
      const el = buildClusterMarker(c.venueCount, c.area);
      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([c.lng, c.lat])
        .addTo(map);
      countryClusterEls.current.push(marker);
    }
  }, []);

  // Auto-following theme (only used when themeProp is absent).
  const [autoTheme, setAutoTheme] = useState<AtlasTheme>(themeProp ?? "dark");
  const theme = themeProp ?? autoTheme;

  useEffect(() => {
    if (themeProp) return; // controlled — don't observe
    setAutoTheme(readTheme());
    const obs = new MutationObserver(() => setAutoTheme(readTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onMq = () => setAutoTheme(readTheme());
    mq.addEventListener("change", onMq);
    return () => {
      obs.disconnect();
      mq.removeEventListener("change", onMq);
    };
  }, [themeProp]);

  // Build the map once (StrictMode-safe — see removalTimer above).
  useEffect(() => {
    // A pending deferred removal means this is a StrictMode re-setup: cancel it
    // and reuse the existing map rather than rebuilding.
    if (removalTimer.current) {
      clearTimeout(removalTimer.current);
      removalTimer.current = null;
    }
    if (mapRef.current) return scheduleCleanup;

    registerPmtilesProtocol(maplibregl);
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: atlasStyle(themeProp ?? readTheme()),
      center: patch ? [patch.lng, patch.lat] : UK_CENTER,
      zoom: patch ? zoomForRadius(patch.radiusKm) : UK_ZOOM,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchZoomRotate: true,
      maxZoom: 16,
    });
    // Flat map only — no rotation gesture (never a satnav).
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    mapRef.current = map;

    const markerEls = markerElsRef.current;
    let onScreen = new Map<string, maplibregl.Marker>();

    function lookupByVenue(): Map<string, AtlasMarker> {
      const m = new Map<string, AtlasMarker>();
      for (const mk of markersRef.current) m.set(mk.venue.id, mk);
      return m;
    }

    function updateMarkers() {
      // The source is added on 'load'; 'move' can fire during the initial
      // camera set BEFORE that. querySourceFeatures on a missing source throws
      // inside maplibre's render loop and wedges the whole style load, so bail
      // until the source exists.
      let features: maplibregl.GeoJSONFeature[];
      try {
        if (!map.getSource(SOURCE_ID)) return;
        features = map.querySourceFeatures(SOURCE_ID);
      } catch {
        return;
      }
      const byVenue = lookupByVenue();
      const next = new Map<string, maplibregl.Marker>();
      for (const f of features) {
        const geom = f.geometry;
        if (geom.type !== "Point") continue;
        const coords = geom.coordinates as [number, number];
        const props = f.properties ?? {};
        let id: string;
        let marker = null as maplibregl.Marker | null;

        if (props.cluster) {
          id = `cluster-${props.cluster_id}`;
          marker = markerEls.get(id) ?? null;
          if (!marker) {
            const el = buildClusterMarker(Number(props.point_count));
            const clusterId = Number(props.cluster_id);
            el.addEventListener("click", (e) => {
              e.stopPropagation();
              const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
              if (onClusterTapRef.current) onClusterTapRef.current(clusterId, coords);
              void src?.getClusterExpansionZoom(clusterId).then((zoom) => {
                map.easeTo({ center: coords, zoom });
              });
            });
            marker = new maplibregl.Marker({ element: el }).setLngLat(coords);
            markerEls.set(id, marker);
          }
        } else {
          const venueId = String(props.venueId);
          id = `venue-${venueId}`;
          marker = markerEls.get(id) ?? null;
          if (!marker) {
            const data = byVenue.get(venueId);
            if (!data) continue;
            const el = buildVenueMarker(data);
            el.addEventListener("click", (e) => {
              e.stopPropagation();
              onMarkerTapRef.current(venueId);
            });
            marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(coords);
            markerEls.set(id, marker);
          }
        }

        next.set(id, marker);
        if (!onScreen.has(id)) marker.addTo(map);
      }
      // Remove markers that scrolled off / re-clustered.
      for (const [id, marker] of onScreen) {
        if (!next.has(id)) marker.remove();
      }
      onScreen = next;
    }

    map.on("load", () => {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: markersRef.current.map(markerFeature) },
        cluster: true,
        clusterRadius: 52,
        clusterMaxZoom: 13,
        clusterProperties: {
          openSeats: ["+", ["get", "openSeats"]],
          circles: ["+", ["get", "circles"]],
          hasInBandSeat: ["max", ["get", "inBandSeat"]],
        },
      });
      // Invisible circle layers over the source. Markers are DOM elements, but
      // maplibre only loads a GeoJSON source's tiles (and querySourceFeatures
      // only returns features) when at least one LAYER references it — hence
      // these transparent stand-ins that never paint but keep tiles flowing.
      map.addLayer({
        id: "clusters-hit",
        type: "circle",
        source: SOURCE_ID,
        filter: ["has", "point_count"],
        paint: { "circle-opacity": 0, "circle-radius": 1 },
      });
      map.addLayer({
        id: "unclustered-hit",
        type: "circle",
        source: SOURCE_ID,
        filter: ["!", ["has", "point_count"]],
        paint: { "circle-opacity": 0, "circle-radius": 1 },
      });
      setMapReady(true);
      updateMarkers();
      renderCountryClusters();
    });
    map.on("move", updateMarkers);
    map.on("moveend", updateMarkers);
    map.on("data", (e) => {
      if ((e as maplibregl.MapSourceDataEvent).sourceId === SOURCE_ID) updateMarkers();
    });

    return scheduleCleanup;

    // Defer teardown so a StrictMode re-setup (same tick) can cancel it; a real
    // unmount lets the timer fire and removes the map + its markers.
    function scheduleCleanup() {
      removalTimer.current = setTimeout(() => {
        for (const marker of markerElsRef.current.values()) marker.remove();
        markerElsRef.current.clear();
        for (const m of countryClusterEls.current) m.remove();
        countryClusterEls.current = [];
        mapRef.current?.remove();
        mapRef.current = null;
        removalTimer.current = null;
      }, 0);
    }
    // Built once; prop changes are handled by the effects below via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme swap: diff-apply so tiles/camera survive, and preserve the
  // imperatively-added venues source + hit layers (a plain diff would drop
  // anything not in the new token style). DOM markers + blob retheme via CSS.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.setStyle(atlasStyle(theme), {
      diff: true,
      transformStyle: (previous, next) => {
        if (!previous) return next;
        const sources = { ...next.sources };
        if (previous.sources[SOURCE_ID]) sources[SOURCE_ID] = previous.sources[SOURCE_ID];
        const keep = previous.layers.filter(
          (l) => l.id === "clusters-hit" || l.id === "unclustered-hit",
        );
        return { ...next, sources, layers: [...next.layers, ...keep] };
      },
    });
  }, [theme, mapReady]);

  // Marker data changed → refresh the GeoJSON source (re-clusters + re-syncs DOM).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: markers.map(markerFeature) });
  }, [markers, mapReady]);

  // Country-view clusters changed → re-render the pre-aggregated cards.
  useEffect(() => {
    if (!mapReady) return;
    renderCountryClusters();
  }, [clusters, mapReady, renderCountryClusters]);

  // Patch changed → ease the camera home (blob follows via its own projection);
  // patch cleared → pull back to the UK country view (where clusters live).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (patch) {
      map.easeTo({ center: [patch.lng, patch.lat], zoom: zoomForRadius(patch.radiusKm), duration: 700 });
    } else {
      map.easeTo({ center: UK_CENTER, zoom: UK_ZOOM, duration: 700 });
    }
  }, [patch?.lat, patch?.lng, patch?.radiusKm, mapReady]);

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={container} style={{ position: "absolute", inset: 0 }} />
      {patch && mapReady && (
        <PatchBlob map={mapRef.current} lat={patch.lat} lng={patch.lng} radiusKm={patch.radiusKm} />
      )}
      <div
        style={{
          position: "absolute",
          right: "8px",
          bottom: "6px",
          zIndex: 3,
          font: "400 10px var(--c4-font-mono)",
          color: "color-mix(in srgb, var(--color-ink) 45%, transparent)",
          textShadow: "0 1px 4px var(--color-ground)",
          pointerEvents: "none",
        }}
      >
        {ATLAS_ATTRIBUTION}
      </div>
    </div>
  );
}
