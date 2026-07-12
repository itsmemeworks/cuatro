"use client";

/**
 * THE ATLAS map — public entry point. This ssr:false dynamic wrapper keeps
 * maplibre-gl (and its ~250KB) out of the server bundle and every non-map
 * route; it lands in its own async chunk fetched only when a map surface
 * mounts. Import `AtlasMap` from here, never the client module directly.
 *
 * FROZEN props contract (other agents build against this):
 *   AtlasMap({
 *     theme?,              // omit → auto-follow the app's data-theme (+ OS scheme)
 *     markers,             // AtlasMarker[]
 *     clusters?,           // AtlasCluster[] — pre-aggregated country-view cards (no-patch)
 *     patch,               // { lat, lng, radiusKm } | null  (null = UK country view)
 *     onMarkerTap,         // (venueId: string) => void
 *     onClusterTap?,       // (clusterId: number, lngLat: [number, number]) => void
 *     className,
 *   })
 *
 * "At most one live GL map per screen" — do not mount two AtlasMaps (or an
 * AtlasMap and a PatchMiniMap) visible at once.
 */
import dynamic from "next/dynamic";
import type { AtlasMapProps } from "./atlas-map-client";

const AtlasMapClient = dynamic(() => import("./atlas-map-client"), {
  ssr: false,
  loading: () => (
    // tMap0 land colour placeholder so there's no flash before the GL canvas.
    <div style={{ width: "100%", height: "100%", background: "var(--color-map-land)" }} />
  ),
});

export function AtlasMap(props: AtlasMapProps) {
  return <AtlasMapClient {...props} />;
}

export type { AtlasMapProps, AtlasPatch } from "./atlas-map-client";
export type {
  AtlasMarker,
  AtlasCluster,
  AtlasVenue,
  AtlasSoonestSeat,
  IndoorOutdoor,
  MarkerKind,
} from "./venue-marker";
