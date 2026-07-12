"use client";

/**
 * THE ATLAS patch mini-map (design: Patch control's "mini map preview with
 * blob + ◆ home dot"). A small, NON-INTERACTIVE maplibre instance — no pan,
 * no zoom, no controls — showing the patch blob over the tokenised tiles with
 * a bone ◆ at the home court.
 *
 * "At most one live GL map per screen" (stack decision doc): this is a real GL
 * context. The patch control that mounts it (T5) opens as a sheet OVER the
 * Atlas, so the underlying AtlasMap is not visible at the same time — do not
 * render a PatchMiniMap and an AtlasMap visible simultaneously.
 *
 * maplibre-gl + pmtiles are dynamically imported inside the effect so this
 * single file is safe to import from anywhere (no window touch during SSR),
 * without needing its own ssr:false wrapper.
 */
import { useEffect, useRef, useState } from "react";
import type MapLibre from "maplibre-gl";
import { atlasStyle, type AtlasTheme } from "@/lib/atlas/style";
import { PatchBlob } from "./patch-blob";

function readTheme(): AtlasTheme {
  if (typeof document === "undefined") return "dark";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

function zoomForRadius(radiusKm: number): number {
  if (radiusKm <= 1.5) return 13.4;
  if (radiusKm <= 3.5) return 12.5;
  return 11.7;
}

export function PatchMiniMap({
  lat,
  lng,
  radiusKm,
  theme: themeProp,
  className,
}: {
  lat: number;
  lng: number;
  radiusKm: number;
  theme?: AtlasTheme;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre.Map | null>(null);
  const homeMarkerRef = useRef<MapLibre.Marker | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let map: MapLibre.Map | null = null;
    let homeMarker: MapLibre.Marker | null = null;

    (async () => {
      const [{ default: maplibregl }, { registerPmtilesProtocol }] = await Promise.all([
        import("maplibre-gl"),
        import("@/lib/atlas/pmtiles-protocol"),
      ]);
      await import("maplibre-gl/dist/maplibre-gl.css");
      if (cancelled || !container.current) return;
      registerPmtilesProtocol(maplibregl);

      map = new maplibregl.Map({
        container: container.current,
        style: atlasStyle(themeProp ?? readTheme()),
        center: [lng, lat],
        zoom: zoomForRadius(radiusKm),
        attributionControl: false,
        interactive: false,
        dragRotate: false,
        pitchWithRotate: false,
      });
      mapRef.current = map;

      // Bone ◆ home dot at the patch anchor (the only anchor there ever is).
      const dot = document.createElement("div");
      Object.assign(dot.style, {
        width: "26px",
        height: "26px",
        borderRadius: "50%",
        background: "var(--color-ink)",
        color: "var(--color-ground)",
        font: "800 11px var(--c4-font-sans)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 0 0 5px var(--color-ink-hairline-2)",
      });
      dot.textContent = "◆";
      homeMarker = new maplibregl.Marker({ element: dot, anchor: "center" }).setLngLat([lng, lat]).addTo(map);
      homeMarkerRef.current = homeMarker;

      map.on("load", () => {
        if (!cancelled) setReady(true);
      });
    })();

    return () => {
      cancelled = true;
      homeMarker?.remove();
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move the home dot + camera when the picked home court / size changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    homeMarkerRef.current?.setLngLat([lng, lat]);
    map.easeTo({ center: [lng, lat], zoom: zoomForRadius(radiusKm), duration: 700 });
  }, [lat, lng, radiusKm, ready]);

  return (
    // Height comes from the CALLER's className (e.g. h-[130px]) — an inline
    // height:100% here beats the class and collapses to 0px inside flex/auto
    // parents (the inner map fills via absolute inset anyway).
    <div className={className} style={{ position: "relative", width: "100%" }}>
      <div ref={container} style={{ position: "absolute", inset: 0 }} />
      {ready && <PatchBlob map={mapRef.current} lat={lat} lng={lng} radiusKm={radiusKm} />}
    </div>
  );
}
