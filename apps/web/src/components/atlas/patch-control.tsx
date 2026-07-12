"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Meta, Sheet, SegmentedControl, useToast } from "@/components/ui";
import { updateDiscoverySettingsAction } from "@/app/(app)/profile/discovery-actions";
import { patchRadiusKm, type PatchSize } from "@/lib/geo";
import { PatchMiniMap } from "@/components/atlas/patch-mini-map";

/**
 * Patch control — "Your patch" (design screen 6). A soft area around the home
 * court: it is where the map opens and what "near you" means. Never GPS, never
 * a crosshair, never a km number.
 *
 * The home court is THE ONLY anchor. Picking one saves immediately (through the
 * shared discovery action) and moves the patch with it; the coarse size segment
 * (tight/local/wide) resizes the blob. There is no free-text add here — a court
 * you don't see yet is added on the Atlas (add-a-court), then chosen here.
 *
 * Save-on-change, not save-then-close: the sheet stays mounted, so every write
 * submits findable + homeVenueId + patchSize TOGETHER (the discovery action
 * reads an absent homeVenueId as "clear my home court" — never submit one
 * without the others), and router.refresh() re-reads the moved patch onto the
 * mini-map.
 */

export interface PatchVenueOption {
  id: string;
  name: string;
  areaHint?: string | null;
}

const SIZE_OPTIONS: { value: PatchSize; label: string }[] = [
  { value: "tight", label: "Tight" },
  { value: "local", label: "Local" },
  { value: "wide", label: "Wide" },
];

const SIZE_HINT: Record<PatchSize, string> = {
  tight: "your corner of town",
  local: "a sensible cycle",
  wide: "worth the trip for a good four",
};

const SEARCH_THRESHOLD = 12;
const LIST_LIMIT = 30;

export function PatchControl({
  open,
  onClose,
  patch,
  size,
  homeVenueId,
  findable,
  venueOptions,
}: {
  open: boolean;
  onClose: () => void;
  /** The current resolved patch centre + reach (server/patch.ts); null when no home court pins yet. */
  patch: { lat: number; lng: number; radiusKm: number } | null;
  size: PatchSize;
  homeVenueId: string | null;
  findable: boolean;
  venueOptions: PatchVenueOption[];
}) {
  const router = useRouter();
  const { show } = useToast();
  const [pending, startTransition] = useTransition();
  // Local, optimistic: the tick and the blob react on tap; the moved centre
  // arrives on the next server read (router.refresh) since only the server
  // knows each venue's pin.
  const [selected, setSelected] = useState<string | null>(homeVenueId);
  const [sizeSel, setSizeSel] = useState<PatchSize>(size);
  const [query, setQuery] = useState("");

  // With the UK Atlas seeded there are hundreds of venues — a flat list is
  // unusable at that scale. Past this threshold the list is search-gated:
  // no query shows only the current home court; typing filters by name/area.
  const searchable = venueOptions.length > SEARCH_THRESHOLD;
  const q = query.trim().toLowerCase();
  const visibleOptions = !searchable
    ? venueOptions
    : q
      ? venueOptions.filter(
          (v) => v.name.toLowerCase().includes(q) || (v.areaHint ?? "").toLowerCase().includes(q),
        )
      : venueOptions.filter((v) => v.id === selected);
  const shownOptions = visibleOptions.slice(0, LIST_LIMIT);
  const hiddenCount = visibleOptions.length - shownOptions.length;

  function save(nextHome: string | null, nextSize: PatchSize) {
    const fd = new FormData();
    if (findable) fd.set("findable", "on");
    if (nextHome) fd.set("homeVenueId", nextHome);
    fd.set("patchSize", nextSize);
    startTransition(async () => {
      await updateDiscoverySettingsAction(fd);
      router.refresh();
    });
  }

  function pickHome(id: string) {
    if (id === selected) return;
    const hadHome = selected != null && selected !== "";
    setSelected(id);
    save(id, sizeSel);
    show(hadHome ? "home court changed · your patch moved with it" : "patch set · the map opens here now");
  }

  function pickSize(next: PatchSize) {
    if (next === sizeSel) return;
    setSizeSel(next);
    save(selected, next);
  }

  // The blob reacts to the size tap instantly (radiusKm from local size); the
  // centre is whatever the server last resolved (moves in on refresh after a
  // home-court change).
  const miniRadiusKm = patchRadiusKm(sizeSel);

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="flex flex-col gap-0">
        <div className="flex items-start gap-2.5">
          <div className="flex-1">
            <h2 className="text-[20px] font-extrabold text-ink">Your patch</h2>
            <Meta as="p" className="mt-[5px] leading-[1.6]">
              a soft area around your home court. It&apos;s where the map opens and what &ldquo;near you&rdquo; means.
              Never GPS, never a crosshair.
            </Meta>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-[30px] place-items-center rounded-full bg-ink-hairline-1 text-ink-muted hover:bg-ink-hairline-2 transition-cu-state"
          >
            ×
          </button>
        </div>

        {patch ? (
          <PatchMiniMap
            lat={patch.lat}
            lng={patch.lng}
            radiusKm={miniRadiusKm}
            className="mt-3.5 h-[130px] w-full overflow-hidden rounded-[14px]"
          />
        ) : (
          <div className="mt-3.5 grid h-[130px] w-full place-items-center rounded-[14px] border border-ink-hairline-1 bg-map-land">
            <Meta as="p" className="text-center">
              pick a home court and the map opens here
            </Meta>
          </div>
        )}

        <p className="mt-4 text-[10px] font-extrabold tracking-[0.13em] text-ink-muted">HOME COURT · THE ONLY ANCHOR</p>
        {searchable && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`find your court · ${venueOptions.length} on the Atlas`}
            aria-label="Find your court"
            className="mt-2 w-full rounded-[13px] border border-ink-hairline-2 bg-transparent px-3.5 py-2.5 text-[12.5px] text-ink placeholder:text-ink-muted focus:border-ink-hairline-4 focus:outline-none"
          />
        )}
        {venueOptions.length > 0 ? (
          <div className="mt-2 flex flex-col gap-1.5">
            {searchable && shownOptions.length === 0 && (
              <Meta as="p" className="py-1">
                {q ? "no court by that name yet. Add it on the Atlas and it becomes your anchor." : "type to find your court"}
              </Meta>
            )}
            {shownOptions.map((v) => {
              const active = v.id === selected;
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={active}
                  disabled={pending}
                  onClick={() => pickHome(v.id)}
                  className={`flex items-center gap-3 rounded-[13px] border px-3.5 py-2.5 text-left transition-cu-state ${
                    active ? "border-ink-hairline-3 bg-ink-hairline-1" : "border-ink-hairline-2 hover:bg-ink-hairline-1"
                  } disabled:opacity-60`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-bold text-ink">{v.name}</span>
                    {v.areaHint && <Meta as="span">{v.areaHint}</Meta>}
                  </span>
                  {active && (
                    <span aria-hidden className="text-[12px] font-bold text-win">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
            {hiddenCount > 0 && (
              <Meta as="p" className="py-1">
                {hiddenCount} more · keep typing to narrow it down
              </Meta>
            )}
          </div>
        ) : (
          <Meta as="p" className="mt-2">
            No courts on the Atlas near you yet. Add one and it becomes your anchor.
          </Meta>
        )}
        <Meta as="p" className="mt-[7px]">
          change it any time and your patch moves with it
        </Meta>

        <p className="mt-4 text-[10px] font-extrabold tracking-[0.13em] text-ink-muted">PATCH SIZE</p>
        <SegmentedControl
          className="mt-2"
          options={SIZE_OPTIONS}
          value={sizeSel}
          onChange={(v) => pickSize(v)}
        />
        <Meta as="p" className="mt-[7px] text-center">
          {SIZE_HINT[sizeSel]}
        </Meta>

        <div className="mt-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-[13px] border border-ink-hairline-4 py-3 text-center text-[12.5px] font-bold text-ink hover:bg-ink-hairline-1 transition-cu-state"
          >
            Done
          </button>
        </div>
        <Meta as="p" className="mt-2.5 text-center">
          others only ever see rough distances · no locate-me button exists, anywhere
        </Meta>
      </div>
    </Sheet>
  );
}
