"use client";

/**
 * Discover's MAP mode (design/HANDOFF-DELTA-ATLAS.md screens 1, 2, 7, 8). The
 * map is a PROJECTION OF DISCOVER, not a new surface: it renders the same
 * AtlasView the list reads (server/atlas.ts), so List and Map can never
 * disagree about who is near you.
 *
 * Two things this module owns that the map engine (T2) deliberately does not:
 *
 *  1. The single coral moment. "One coral moment per panel — the map IS a
 *     panel" (the laws). Across every marker, exactly ONE may be dashed coral:
 *     the best open seat for the viewer (in band, soonest). `pickCoralVenueId`
 *     decides it; every other open-seat venue renders dashed-bone. When the
 *     patch is sparse (courts but no queue) the coral moment is the invitation
 *     card's "Start the first Circle here" instead — and there is never a coral
 *     marker then, because a sparse patch has no open seats at all.
 *  2. The state cards. Never-GPS reassurance on a live patch (first contact),
 *     the sparse-town invitation, and the no-patch country view — each is the
 *     one meaningful overlay for its state.
 *
 * DiscoverModeLayout is the List/Map shell the page mounts; DiscoverMapMode is
 * the map panel itself (also usable stand-alone).
 */
import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AtlasMap, type AtlasMarker as RenderMarker } from "@/components/atlas/atlas-map";
import { VenueSheet } from "@/components/atlas/venue-sheet";
import { PatchChip } from "@/components/atlas/patch-chip";
import { SegmentedControl, type SegmentedOption } from "@/components/ui";
import type { AtlasMarker as ServerMarker, AtlasView } from "@/server/atlas";
import type { DiscoverPatchControl } from "@/server/discover-page";
import { NeverGpsBanner } from "./never-gps-banner";

/** Fallback zone if a venue somehow carries no IANA timezone (world-ready law: format in the venue's own zone). */
const FALLBACK_TZ = "Europe/London";

/**
 * The single dashed-coral marker: the best open seat for the viewer — in the
 * viewer's Glass band, soonest first. Returns the venueId to tag coral, or null
 * when no open seat sits in the band (then no marker is coral). PURE: the panel
 * invariant is decided here, the renderer only obeys the `coral` flag.
 *
 * Ties (same soonest ms) resolve to the marker that sorts first — the server
 * already orders markers open-seats-first then busiest then nearest, so a tie
 * lands on the nearer/busier venue, which is the better default.
 */
export function pickCoralVenueId(markers: ServerMarker[]): string | null {
  let best: { venueId: string; startsAtMs: number } | null = null;
  for (const m of markers) {
    const seat = m.soonestOpenSeat;
    if (!seat || !seat.inBand || m.openSeatCount <= 0) continue;
    if (!best || seat.startsAtMs < best.startsAtMs) {
      best = { venueId: m.venueId, startsAtMs: seat.startsAtMs };
    }
  }
  return best?.venueId ?? null;
}

/**
 * A patch is "sparse" when it has courts but no queue: markers exist, yet none
 * carries an open seat or a discoverable Circle. This is exactly the state the
 * sparse-town invitation answers — and it guarantees no coral marker (no open
 * seats to be in band).
 */
export function isSparsePatch(markers: ServerMarker[]): boolean {
  return markers.length > 0 && markers.every((m) => m.openSeatCount === 0 && m.circleCount === 0);
}

/** "Sun 10:00" — weekday + 24h time in the VENUE's timezone, split so the locale never wedges a comma in. */
function seatLabel(startsAtMs: number, timezone: string): string {
  const tz = timezone || FALLBACK_TZ;
  const d = new Date(startsAtMs);
  const weekday = d.toLocaleString("en-GB", { timeZone: tz, weekday: "short" });
  const time = d.toLocaleString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  return `${weekday} ${time}`;
}

/** Map the server's marker shape onto the renderer's, tagging exactly the one coral venue. */
function toRenderMarkers(markers: ServerMarker[], coralVenueId: string | null): RenderMarker[] {
  return markers.map((m) => ({
    venue: {
      id: m.venueId,
      slug: m.slug,
      name: m.name,
      lat: m.lat,
      lng: m.lng,
      indoorOutdoor: m.facts.indoorOutdoor,
      courtCount: m.facts.courtCount,
    },
    openSeatCount: m.openSeatCount,
    soonestOpenSeat: m.soonestOpenSeat
      ? {
          sessionId: m.soonestOpenSeat.sessionId,
          startsAt: m.soonestOpenSeat.startsAtMs,
          label: seatLabel(m.soonestOpenSeat.startsAtMs, m.timezone),
          inBand: m.soonestOpenSeat.inBand,
        }
      : null,
    circleCount: m.circleCount,
    homeToCount: m.homeToCount,
    isViewerHome: m.isViewerHome,
    quiet: m.quiet,
    coral: m.venueId === coralVenueId,
  }));
}

/** The bottom-left band line: a patched map is a projection of Discover; the country view carries only venues. */
function bandLine(atlas: AtlasView): string {
  if (!atlas.patch) return "venues only · people are never on this map";
  if (atlas.band) {
    return `your band ${atlas.band.min.toFixed(1)}–${atlas.band.max.toFixed(1)} · the map is a projection of Discover`;
  }
  return "the map is a projection of Discover";
}

/** Live >=1200 viewport gate. SSR/hydration snapshot is false, so the map+list side-by-side only turns on client-side (no hydration mismatch). */
let wideMql: MediaQueryList | null = null;
function getWideMql(): MediaQueryList {
  if (!wideMql) wideMql = window.matchMedia("(min-width: 1200px)");
  return wideMql;
}
function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = getWideMql();
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => getWideMql().matches,
    () => false,
  );
}

/** A card floated over the map (no-patch / sparse). Its lone coral link is the panel's coral moment. */
function OverlayCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
      <div
        className="pointer-events-auto w-full max-w-[360px] rounded-card border border-ink-hairline-2 bg-surface p-5 text-center animate-cu-arrive"
        style={{ boxShadow: "0 12px 34px rgba(0,0,0,.35)" }}
      >
        {children}
      </div>
    </div>
  );
}

interface DiscoverMapModeProps {
  atlas: AtlasView;
  /** A real area label for the sparse-town invitation (the home venue's name); null falls back to "Your patch". */
  patchAreaLabel: string | null;
  className?: string;
}

/**
 * The map panel: the live Atlas map plus the one overlay its state calls for.
 * Marker taps open the shared VenueSheet (T4); markers with no slug can't be
 * routed to a court page, so they simply don't open a sheet.
 */
export function DiscoverMapMode({ atlas, patchAreaLabel, className = "" }: DiscoverMapModeProps) {
  const wide = useWide();
  const [selected, setSelected] = useState<{ slug: string; name: string } | null>(null);

  const coralVenueId = useMemo(() => pickCoralVenueId(atlas.markers), [atlas.markers]);
  const renderMarkers = useMemo(() => toRenderMarkers(atlas.markers, coralVenueId), [atlas.markers, coralVenueId]);
  const byVenue = useMemo(() => {
    const m = new Map<string, { slug: string | null; name: string }>();
    for (const mk of atlas.markers) m.set(mk.venueId, { slug: mk.slug, name: mk.name });
    return m;
  }, [atlas.markers]);

  const sparse = atlas.patch != null && isSparsePatch(atlas.markers);
  const area = patchAreaLabel ?? "Your patch";
  const courtCount = atlas.markers.length;
  const ukVenueCount = useMemo(() => atlas.clusters.reduce((n, c) => n + c.venueCount, 0), [atlas.clusters]);

  function onMarkerTap(venueId: string) {
    const v = byVenue.get(venueId);
    if (!v || !v.slug) return; // no court page without a slug — skip gracefully
    setSelected({ slug: v.slug, name: v.name });
  }

  return (
    <div className={`relative overflow-hidden rounded-card border border-ink-hairline-2 ${className}`}>
      <AtlasMap
        markers={renderMarkers}
        // Country view only: the pre-aggregated area cards. With a patch the map
        // self-clusters `markers` instead, so passing clusters would double up.
        clusters={atlas.patch ? undefined : atlas.clusters}
        patch={atlas.patch ? { lat: atlas.patch.lat, lng: atlas.patch.lng, radiusKm: atlas.patch.radiusKm } : null}
        onMarkerTap={onMarkerTap}
        className="absolute inset-0"
      />

      {/* No patch → the country view: UK camera, the set-your-patch prompt, no people. */}
      {!atlas.patch && (
        <>
          <div
            className="pointer-events-none absolute left-3 top-3 z-10 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-muted"
            style={{ textShadow: "0 1px 4px var(--color-ground)" }}
          >
            THE UK, ROUGHLY
          </div>
          <OverlayCard>
            <span
              aria-hidden
              className="mx-auto flex items-center justify-center bg-action text-action-contrast font-extrabold"
              style={{ width: 46, height: 46, borderRadius: "50% 50% 50% 4px", transform: "rotate(-45deg)", boxShadow: "0 6px 20px rgba(255,92,61,.35)" }}
            >
              <span style={{ transform: "rotate(45deg)" }} className="text-[17px]">
                ◆
              </span>
            </span>
            <p className="mt-3 text-[19px] font-extrabold text-ink">Set your patch</p>
            <p className="mt-1.5 text-cu-body leading-relaxed text-ink-muted">
              The Atlas opens on your home court, not on you. Pick where you play and the map is yours. Never GPS.
            </p>
            <Link
              href="/profile"
              className="mt-3 block rounded-button bg-action py-3 text-[14px] font-extrabold text-action-contrast transition-cu-state hover:opacity-90 active:opacity-80"
            >
              Set my patch
            </Link>
            {ukVenueCount > 0 && (
              <p className="mt-2 font-mono text-[10px] text-ink-muted">{ukVenueCount} UK venues seeded and waiting</p>
            )}
          </OverlayCard>
        </>
      )}

      {/* Patch, but courts with no queue → the sparse-town invitation (its coral is the panel's coral moment). */}
      {sparse && (
        <OverlayCard>
          <p className="text-[18px] font-extrabold leading-tight text-ink">{area} has courts. And, for once, no queue</p>
          <p className="mt-2 text-cu-body leading-relaxed text-ink-muted">
            {courtCount} court{courtCount === 1 ? "" : "s"} on the Atlas, no Circles running them yet. Someone gets to be
            first, and gets first pick of the good slots.
          </p>
          <Link
            href="/circles/new"
            className="mt-3 block rounded-button bg-action py-3 text-[14px] font-extrabold text-action-contrast transition-cu-state hover:opacity-90 active:opacity-80"
          >
            Start the first Circle here
          </Link>
          <p className="mt-2 font-mono text-[10px] text-ink-muted">every Circle you start seeds the town for the next player</p>
        </OverlayCard>
      )}

      {/* Live patch with activity → first-contact never-GPS reassurance (once, dismissible). */}
      {atlas.patch && !sparse && <NeverGpsBanner />}

      {/* Bottom-left band line (the map is a projection of Discover / country footer).
          Sits one line ABOVE the bottom-right attribution below 900px — at phone width
          the two lines otherwise overprint mid-map. */}
      <div
        className="pointer-events-none absolute bottom-[26px] left-2 z-[3] max-w-[70%] font-mono text-[10px] leading-tight text-ink-muted min-[900px]:bottom-1.5"
        style={{ textShadow: "0 1px 4px var(--color-ground)" }}
      >
        {bandLine(atlas)}
      </div>

      <VenueSheet
        slug={selected?.slug ?? ""}
        venueName={selected?.name ?? ""}
        open={selected != null}
        onClose={() => setSelected(null)}
        showCourtPageLink={wide}
      />
    </div>
  );
}

const MODE_OPTIONS: SegmentedOption<"list" | "map">[] = [
  { value: "list", label: "List" },
  { value: "map", label: "Map" },
];

interface DiscoverModeLayoutProps {
  /** The header eyebrow line under "Discover" (null in the no-patch state). */
  subtitle: React.ReactNode | null;
  /** Header filter chips (level, radius); null in the no-patch state. */
  chips: React.ReactNode | null;
  /** The shipped list content — rendered byte-for-byte in List mode and as the desktop rail. */
  listSlot: React.ReactNode;
  atlas: AtlasView;
  patchAreaLabel: string | null;
  /** Data for the on-surface PatchChip (the patch entry point lives on Discover). */
  patchControl: DiscoverPatchControl;
}

/**
 * The List/Map shell. Phone and tablet (<1200) show one panel at a time behind
 * a segmented toggle, list default. Desktop (>=1200) drops the toggle and shows
 * the map and the list side-by-side, the map earning the width. The map only
 * ever mounts when it is the visible panel, so there is never more than one live
 * GL map on screen.
 */
export function DiscoverModeLayout({ subtitle, chips, listSlot, atlas, patchAreaLabel, patchControl }: DiscoverModeLayoutProps) {
  const wide = useWide();
  const [mode, setMode] = useState<"list" | "map">("list");
  const showMap = wide || mode === "map";

  // The on-surface patch chip: compact next to the title on phone, and in the
  // header chip cluster from tablet up (design places it here, not the shell).
  const compactChipProps = {
    variant: "compact" as const,
    patch: atlas.patch ? { lat: atlas.patch.lat, lng: atlas.patch.lng, radiusKm: atlas.patch.radiusKm } : null,
    size: patchControl.size,
    homeVenueId: patchControl.homeVenueId,
    homeVenueName: patchControl.homeVenueName,
    findable: patchControl.findable,
    venueOptions: patchControl.venueOptions,
  };

  return (
    <main className="c4-wide mx-auto flex w-full max-w-[1000px] flex-col gap-6 px-5 pt-2 pb-8 min-[900px]:px-8 min-[1200px]:max-w-[1360px]">
      <div className="flex flex-col gap-4 min-[900px]:flex-row min-[900px]:items-end min-[900px]:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-[29px] font-extrabold tracking-tight text-ink">Discover</h1>
            <span className="min-[900px]:hidden">
              <PatchChip {...compactChipProps} />
            </span>
          </div>
          {subtitle}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={setMode} className="min-[1200px]:hidden" />
          <span className="hidden min-[900px]:inline-flex">
            <PatchChip {...compactChipProps} />
          </span>
          {chips}
        </div>
      </div>

      <div className="min-[1200px]:flex min-[1200px]:items-start min-[1200px]:gap-6">
        {showMap && (
          <DiscoverMapMode
            atlas={atlas}
            patchAreaLabel={patchAreaLabel}
            className="h-[600px] min-[1200px]:h-[700px] min-[1200px]:min-w-0 min-[1200px]:flex-1"
          />
        )}
        <div className={`${mode === "list" ? "block" : "hidden"} min-[1200px]:!block min-[1200px]:w-[420px] min-[1200px]:shrink-0`}>
          {listSlot}
        </div>
      </div>
    </main>
  );
}
