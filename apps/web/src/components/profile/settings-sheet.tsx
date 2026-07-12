"use client";

import { useState } from "react";
import { Button, Card, InfoTerm, Meta, Sheet, SubmitButton } from "@/components/ui";
import { updateDisplayNameAction } from "@/lib/actions";
import { updateDiscoverySettingsAction } from "@/app/(app)/profile/discovery-actions";
import { updatePlayerAttrsAction } from "@/app/(app)/profile/player-attrs-actions";
import { HomeCourtPicker, homeCourtErrorCopy } from "@/components/profile/home-court-picker";
import { COURT_SIDES, DOMINANT_HANDS } from "@/lib/player-attrs";
import type { PatchSize } from "@/lib/geo";

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
  patchSize,
  dominantHand,
  courtSide,
}: {
  displayName: string | null;
  email: string;
  findable: boolean;
  homeVenueId: string | null;
  venueOptions: VenueOption[];
  /** Stored coarse patch size (users.patchSize). Threaded into the home-court picker's size segment. */
  patchSize: PatchSize;
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
  // The discovery form is fully controlled too, because it can FAIL and stay
  // open: an add-a-new-court save with a bad postcode resolves with an error,
  // and React 19's form-reset-on-resolve would wipe uncontrolled fields (the
  // typed name and postcode included) the instant the action returned.
  const [findableOn, setFindableOn] = useState(findable);
  const [addingCourt, setAddingCourt] = useState(false);
  const [homeVenue, setHomeVenue] = useState(homeVenueId ?? "");
  // Controlled like the rest of the discovery form (survives the failed-save
  // remount, and rides the same form via the picker's hidden patchSize input).
  const [patchSizeSel, setPatchSizeSel] = useState<PatchSize>(patchSize);
  const [courtName, setCourtName] = useState("");
  const [courtAddress, setCourtAddress] = useState("");
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  // Bumped on every FAILED discovery save to remount the form. React 19's
  // form-reset-on-resolve rewrites the DOM under React, and a controlled
  // <select> whose value prop didn't change skips its DOM write — so after a
  // failed save the select would DISPLAY the first option while state still
  // says "add a new court" (verified live). Remounting re-asserts every
  // controlled value from the state above, which the reset can't touch.
  const [discoveryFormEpoch, setDiscoveryFormEpoch] = useState(0);
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

  // The discovery save can FAIL (add-a-new-court with a postcode that doesn't
  // resolve), in which case the sheet stays open showing the friendly line —
  // its fields are controlled, so nothing snaps back. On success it follows
  // save-then-close like the other forms.
  async function saveDiscovery(formData: FormData) {
    const result = await updateDiscoverySettingsAction(formData);
    if (!result.ok) {
      setDiscoveryError(homeCourtErrorCopy(result.error));
      setDiscoveryFormEpoch((n) => n + 1); // remount past the form reset (see above)
      return;
    }
    setHomeVenue(result.homeVenueId ?? "");
    setAddingCourt(false);
    setCourtName("");
    setCourtAddress("");
    setDiscoveryError(null);
    setOpen(false);
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
            <form key={discoveryFormEpoch} action={saveDiscovery} className="flex flex-col gap-3">
              <p className="text-cu-secondary font-semibold text-ink-muted">
                Games <InfoTerm term="board" label="near you" />
              </p>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  name="findable"
                  checked={findableOn}
                  onChange={(e) => setFindableOn(e.target.checked)}
                  className="size-5 accent-[var(--color-action)]"
                />
                <span className="text-cu-body text-ink flex-1">Let nearby games find me</span>
              </label>
              <Meta as="p">
                Only Circles you don&apos;t belong to see you, and only as a rough distance, never your exact location.
              </Meta>

              <p className="text-cu-secondary font-semibold text-ink-muted mt-1">
                <InfoTerm term="homeCourt" label="Home court" />
              </p>
              <HomeCourtPicker
                venues={venueOptions}
                adding={addingCourt}
                onAddingChange={(next) => {
                  setAddingCourt(next);
                  setDiscoveryError(null);
                }}
                venueId={homeVenue}
                onVenueIdChange={setHomeVenue}
                courtName={courtName}
                onCourtNameChange={setCourtName}
                courtAddress={courtAddress}
                onCourtAddressChange={setCourtAddress}
                error={discoveryError}
                selectId="homeVenueId"
                patchSize={patchSizeSel}
                onPatchSizeChange={setPatchSizeSel}
                fieldClassName="w-full rounded-button px-4 py-3 text-cu-body outline-none bg-ground border border-ink-hairline-2 text-ink min-h-[var(--touch-target)]"
              />

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
