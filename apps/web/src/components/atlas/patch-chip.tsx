"use client";

import { useState } from "react";
import { Meta } from "@/components/ui";
import { PatchControl, type PatchVenueOption } from "@/components/atlas/patch-control";
import type { PatchSize } from "@/lib/geo";

/**
 * The compact patch entry-point chip for shell surfaces (the phone Discover
 * header, the desktop rail foot). Tapping it opens the full PatchControl. It is
 * a self-contained island — the shell chrome only drops it in and passes the
 * current patch data, the way the phone profile mounts SettingsSheet.
 *
 * Two looks:
 *  - "compact" — the phone header pill: "◆ patch · local".
 *  - "full"    — the rail foot: the home court name over "your patch · local".
 */
export function PatchChip({
  variant = "compact",
  className = "",
  patch,
  size,
  homeVenueId,
  homeVenueName,
  findable,
  venueOptions,
}: {
  variant?: "compact" | "full";
  className?: string;
  patch: { lat: number; lng: number; radiusKm: number } | null;
  size: PatchSize;
  homeVenueId: string | null;
  homeVenueName: string | null;
  findable: boolean;
  venueOptions: PatchVenueOption[];
}) {
  const [open, setOpen] = useState(false);

  const chip =
    variant === "full" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex w-full items-center gap-2.5 rounded-[13px] border border-ink-hairline-2 px-3 py-2.5 text-left hover:bg-ink-hairline-1 transition-cu-state ${className}`}
      >
        <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-strong-bg text-[11px] font-extrabold text-strong-fg">
          ◆
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-bold text-ink">{homeVenueName ?? "Set your patch"}</span>
          <Meta as="span">{patch ? `your patch · ${size}` : "the map opens on it, not on you"}</Meta>
        </span>
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink-hairline-3 px-3 py-1.5 text-[11px] font-bold text-ink hover:bg-ink-hairline-1 transition-cu-state ${className}`}
      >
        <span aria-hidden>◆</span>
        <span>{patch ? `patch · ${size}` : "set your patch"}</span>
      </button>
    );

  return (
    <>
      {chip}
      <PatchControl
        open={open}
        onClose={() => setOpen(false)}
        patch={patch}
        size={size}
        homeVenueId={homeVenueId}
        findable={findable}
        venueOptions={venueOptions}
      />
    </>
  );
}
