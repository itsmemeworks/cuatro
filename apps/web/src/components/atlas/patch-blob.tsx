"use client";

/**
 * THE ATLAS patch blob (design/HANDOFF-DELTA-ATLAS.md "The patch blob"). A
 * soft, irregular, breathing wash over the map marking "your patch" — the
 * camera's home. Deliberately vague: never a circle-with-radius, never a
 * crosshair, and its coral is sub-threshold (≤14% alpha) so it does NOT count
 * as the panel's one coral moment.
 *
 * It positions itself off the map's projection of the patch centre and keeps
 * up on every move/zoom via an imperative ref (not React state) so panning
 * stays smooth. Size is a fixed px at default zoom (three coarse buckets), an
 * ambient area, not a scaled radius — which is why it takes `radiusKm` only to
 * pick a bucket. Reused by both the live map and the non-interactive mini-map.
 */
import { useEffect, useRef } from "react";

/** The subset of maplibre's Map this needs — keeps the component decoupled. */
export interface BlobProjector {
  project(lnglat: [number, number]): { x: number; y: number };
  on(type: string, listener: () => void): unknown;
  off(type: string, listener: () => void): unknown;
}

/** Fixed blob diameter (px) at default zoom for a patch radius — tight/local/wide. */
export function blobSizePx(radiusKm: number): number {
  if (radiusKm <= 1.5) return 110; // tight — your corner of town
  if (radiusKm <= 3.5) return 170; // local — a sensible cycle
  return 240; // wide — worth the trip for a good four
}

export function PatchBlob({
  map,
  lat,
  lng,
  radiusKm,
  showLabel = true,
}: {
  map: BlobProjector | null;
  lat: number;
  lng: number;
  radiusKm: number;
  showLabel?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const size = blobSizePx(radiusKm);

  useEffect(() => {
    if (!map) return;
    const el = ref.current;
    if (!el) return;
    const reposition = () => {
      const p = map.project([lng, lat]);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
    };
    reposition();
    map.on("move", reposition);
    map.on("zoom", reposition);
    map.on("render", reposition);
    return () => {
      map.off("move", reposition);
      map.off("zoom", reposition);
      map.off("render", reposition);
    };
  }, [map, lat, lng]);

  return (
    <div
      ref={ref}
      aria-hidden
      className="animate-cu-breathe"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: `${size}px`,
        height: `${size}px`,
        transform: "translate(-50%, -50%)",
        // Deliberately irregular soft edge, never a clean circle.
        borderRadius: "46% 54% 52% 48% / 52% 46% 54% 48%",
        background:
          "radial-gradient(circle at 50% 50%, var(--color-patch-blob-a), var(--color-patch-blob-b) 55%, transparent 78%)",
        pointerEvents: "none",
        // Blob eases to its new home when the patch (home court) changes.
        transition: "left 700ms ease, top 700ms ease, width 400ms ease, height 400ms ease",
        zIndex: 2,
      }}
    >
      {showLabel && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: "-4px",
            transform: "translateX(-50%)",
            font: "600 10px var(--c4-font-mono)",
            color: "var(--color-action-strong)",
            opacity: 0.75,
            whiteSpace: "nowrap",
          }}
        >
          your patch
        </div>
      )}
    </div>
  );
}
