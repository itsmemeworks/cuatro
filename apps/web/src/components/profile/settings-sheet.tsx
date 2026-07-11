"use client";

import { useState } from "react";
import { Button, Card, InfoTerm, Meta, Sheet, SubmitButton } from "@/components/ui";
import { updateDisplayNameAction } from "@/lib/actions";
import { updateDiscoverySettingsAction } from "@/app/(app)/profile/discovery-actions";
import { updatePlayerAttrsAction } from "@/app/(app)/profile/player-attrs-actions";
import { COURT_SIDES, DOMINANT_HANDS } from "@/lib/player-attrs";

export interface VenueOption {
  id: string;
  name: string;
}

/** The design's Side segment labels: "Drive · right" / "Backhand · left" / "Both" — lingo first, real side second (design ON COURT card). */
export function courtSideSegmentLabel(side: (typeof COURT_SIDES)[number]): string {
  return side.id === "both" ? side.short : `${side.short} · ${side.id}`;
}

/**
 * The ON COURT pill segments (issue #21, design "Home · Settings" ON COURT
 * card): a rounded group where the active segment gets the strong bone-on-ink
 * inversion. Skippable by design — tapping the active segment clears it back
 * to unset, so "none of these" is always one tap away. Shared by the phone
 * settings sheet and the wide Settings page (both A1 files).
 */
export function AttrSegments({
  options,
  value,
  onSelect,
  disabled,
  label,
}: {
  options: { id: string; label: string }[];
  value: string;
  onSelect: (next: string) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-busy={disabled || undefined}
      className={[
        "inline-flex gap-[3px] bg-ground border border-ink-hairline-2 rounded-full p-[3px] self-start transition-cu-state",
        // The save-in-flight pending state (mid-wave addendum: no silent
        // clicks) — the tapped segment has already flipped optimistically,
        // the dimmed group says "writing".
        disabled ? "opacity-60" : "",
      ].join(" ")}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onSelect(active ? "" : opt.id)}
            className={[
              "rounded-full px-[11px] py-[5px] text-[10.5px] font-bold whitespace-nowrap transition-cu-state",
              active ? "bg-strong-bg text-strong-fg" : "text-ink-muted hover:text-ink",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Display-name edit + discovery settings + logout, behind a quiet "Settings"
 * row + sheet (design/DESIGN-AUDIT.md P4). The discovery block powers The
 * Board / Local Ring / Open Door: a `findable` consent toggle and a home-venue
 * picker — the anchor whose pin places the player on the map (server/patch.ts).
 * No coral here: Save is `strong`.
 */
export function SettingsSheet({
  displayName,
  email,
  findable,
  homeVenueId,
  venueOptions,
  dominantHand,
  courtSide,
}: {
  displayName: string | null;
  email: string;
  findable: boolean;
  homeVenueId: string | null;
  venueOptions: VenueOption[];
  /** ON COURT attributes (issue #21): pass the STORED values (null = unset). Leaving both undefined hides the whole ON COURT card — a picker that can't see the stored value must not render, or a reopened sheet would show "unset" over a real value and a re-save would null it (the CLAUDE.md #14 stale-default data-loss shape, sans React). */
  dominantHand?: string | null;
  courtSide?: string | null;
}) {
  const [open, setOpen] = useState(false);
  // Controlled on purpose (unlike the uncontrolled fields above, which rely on
  // save-then-close): a controlled value never falls victim to React 19's
  // form-reset-on-resolve, and the segments need local state anyway.
  const [hand, setHand] = useState(dominantHand ?? "");
  const [side, setSide] = useState(courtSide ?? "");
  const showOnCourt = dominantHand !== undefined || courtSide !== undefined;

  // Close the sheet once a save lands. This is load-bearing, not cosmetic:
  // React 19 auto-resets a `<form action={fn}>` as soon as the action resolves,
  // and this sheet stays mounted across a save, so an uncontrolled field would
  // snap straight back to its mount-time default the instant the write
  // succeeds — the home venue you just picked reverts to "No home venue" and
  // reads as "the save didn't take". Hit Save again on that reverted control
  // and the stale default is what gets persisted, genuinely undoing the change.
  // Closing unmounts the fields before the reset can fire; revalidatePath() in
  // the actions means the next open remounts them from the freshly-saved server
  // props, so the sheet always reflects what's actually stored.
  function saveThenClose(action: (formData: FormData) => Promise<void>) {
    return async (formData: FormData) => {
      await action(formData);
      setOpen(false);
    };
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-cu-secondary font-semibold text-ink-muted text-center py-2"
      >
        Settings
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Settings">
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <form action={saveThenClose(updateDisplayNameAction)} className="flex flex-col gap-3">
              <label htmlFor="displayName" className="text-cu-secondary font-semibold text-ink-muted">
                Display name
              </label>
              <input
                id="displayName"
                name="displayName"
                defaultValue={displayName ?? ""}
                placeholder="What should your Circles call you?"
                className="w-full rounded-button px-4 py-3 text-cu-body outline-none bg-ground border border-ink-hairline-2 text-ink"
                style={{ minHeight: "var(--touch-target)" }}
              />
              <SubmitButton variant="strong" size="lg" fullWidth>
                Save
              </SubmitButton>
            </form>
            <Meta>{email}</Meta>
          </Card>

          <Card className="flex flex-col gap-3">
            <form action={saveThenClose(updateDiscoverySettingsAction)} className="flex flex-col gap-3">
              <p className="text-cu-secondary font-semibold text-ink-muted">
                Games <InfoTerm term="board" label="near you" />
              </p>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  name="findable"
                  defaultChecked={findable}
                  className="size-5 accent-[var(--color-action)]"
                />
                <span className="text-cu-body text-ink flex-1">Let nearby games find me</span>
              </label>
              <Meta as="p">
                Only Circles you don&apos;t belong to see you, and only as a rough distance, never your exact location.
              </Meta>

              <label htmlFor="homeVenueId" className="text-cu-secondary font-semibold text-ink-muted mt-1">
                Home venue
              </label>
              <select
                id="homeVenueId"
                name="homeVenueId"
                defaultValue={homeVenueId ?? ""}
                className="w-full rounded-button px-4 py-3 text-cu-body outline-none bg-ground border border-ink-hairline-2 text-ink"
                style={{ minHeight: "var(--touch-target)" }}
              >
                <option value="">No home venue</option>
                {venueOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <Meta as="p">This is what places you on The Board, pick where you usually play.</Meta>

              <SubmitButton variant="strong" size="lg" fullWidth>
                Save
              </SubmitButton>
            </form>
          </Card>

          {showOnCourt && (
          <Card className="flex flex-col gap-3">
            <form action={saveThenClose(updatePlayerAttrsAction)} className="flex flex-col gap-3">
              <p className="text-cu-secondary font-semibold text-ink-muted">On court</p>
              <input type="hidden" name="dominantHand" value={hand} />
              <input type="hidden" name="courtSide" value={side} />

              <span className="text-cu-body text-ink">Hand</span>
              <AttrSegments
                options={DOMINANT_HANDS.map((h) => ({ id: h.id, label: h.label }))}
                value={hand}
                onSelect={setHand}
                label="Dominant hand"
              />
              <Meta as="p">Which hand holds the racket. Optional, skip freely.</Meta>

              <span className="text-cu-body text-ink mt-1">Side</span>
              <AttrSegments
                options={COURT_SIDES.map((s) => ({ id: s.id, label: courtSideSegmentLabel(s) }))}
                value={side}
                onSelect={setSide}
                label="Court side"
              />
              <Meta as="p">Where you set up in the pair. Never touches Glass, the Rotation, or who can join.</Meta>

              <SubmitButton variant="strong" size="lg" fullWidth>
                Save
              </SubmitButton>
            </form>
          </Card>
          )}

          <form action="/api/auth/logout" method="POST">
            <Button type="submit" variant="quiet" size="lg" fullWidth>
              Log out
            </Button>
          </form>
        </div>
      </Sheet>
    </>
  );
}
