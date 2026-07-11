"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Meta, Sheet } from "@/components/ui";
import { saveCircleSettings } from "@/app/(app)/circles/[id]/door-actions";
import { isHeaderKey, headerFor, type HeaderKey } from "@/lib/circle-headers";
import { errorCopy } from "@/lib/error-copy";
import { COLOUR_PRESETS } from "./presets";
import { EmblemPicker, isEmblemTooLong } from "./emblem-picker";
import { HeaderPicker, CircleCardArt } from "./circle-header";

// Mirrors MAX_CIRCLE_NAME_LENGTH in server/circles.ts — kept local so this
// client component never imports the better-sqlite3-backed server module.
const MAX_CIRCLE_NAME_LENGTH = 40;
// Mirrors MIN_MAX_MEMBERS / MAX_MAX_MEMBERS in server/circles.ts.
const MIN_MAX_MEMBERS = 4;
const MAX_MAX_MEMBERS = 64;

// Circle-edit error codes → human copy. A page-local map (per the repo's
// error-copy rule) since these codes are specific to this surface; the three
// Circle v2 field codes live in the shared errorCopy() so they read the same
// wherever a create/edit write surfaces them.
const EDIT_ERROR_COPY: Record<string, string> = {
  invalid_circle_name: "Give your Circle a name, up to 40 characters.",
  invalid_emblem: "One emoji is plenty.",
  invalid_colour: "Pick one of the colours.",
  invalid_header_image: errorCopy("invalid_header_image"),
  invalid_home_venue: errorCopy("invalid_home_venue"),
  invalid_max_members: errorCopy("invalid_max_members"),
  not_an_organiser: "Only the Circle's organiser can do that.",
  not_a_member: "You're not in this Circle, so that action isn't available.",
  unauthorized: "You've been signed out. Sign in and try again.",
  something_went_wrong: "That didn't save. Give it another go.",
};

/** The anchor venue shown to everyone, with its full address for the organiser. */
export interface EditAnchor {
  venueName: string;
  address: string | null;
}

export interface EditVenueOption {
  id: string;
  name: string;
}

/**
 * Organiser-only "Edit Circle": header image, name, colour, emblem, home
 * court, and an optional roster cap, with a live card-art preview. Renders its
 * own labelled trigger so the affordance is findable, not a hidden icon. The
 * Save inside the sheet is the one coral action in its own surface; the trigger
 * stays calm.
 */
export function EditCircleSheet({
  idPrefix = "",
  circleId,
  initialName,
  initialColour,
  initialEmblem,
  initialHeaderImage,
  initialHomeVenueId,
  initialMaxMembers,
  memberCount,
  venueOptions,
  anchor,
}: {
  /** Uniquifies field ids when two instances are mounted (the responsive phone/wide settings trees each carry one). */
  idPrefix?: string;
  circleId: string;
  initialName: string;
  initialColour: string;
  initialEmblem: string | null;
  initialHeaderImage: string | null;
  initialHomeVenueId: string | null;
  initialMaxMembers: number | null;
  memberCount: number;
  venueOptions: EditVenueOption[];
  anchor: EditAnchor | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [colour, setColour] = useState(initialColour);
  const [emblem, setEmblem] = useState(initialEmblem ?? "");
  // The picker always shows one thumbnail ringed: the explicit choice if set,
  // otherwise the deterministic default this Circle already displays.
  const [header, setHeader] = useState<HeaderKey>(
    isHeaderKey(initialHeaderImage) ? initialHeaderImage : headerFor(circleId),
  );
  const [homeVenueId, setHomeVenueId] = useState<string>(initialHomeVenueId ?? "");
  const [maxMembers, setMaxMembers] = useState<string>(initialMaxMembers != null ? String(initialMaxMembers) : "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initials = name.trim().slice(0, 2).toUpperCase() || "TN";
  const trimmedName = name.trim();

  function reset() {
    setName(initialName);
    setColour(initialColour);
    setEmblem(initialEmblem ?? "");
    setHeader(isHeaderKey(initialHeaderImage) ? initialHeaderImage : headerFor(circleId));
    setHomeVenueId(initialHomeVenueId ?? "");
    setMaxMembers(initialMaxMembers != null ? String(initialMaxMembers) : "");
    setError(null);
  }

  function close() {
    reset();
    setOpen(false);
  }

  function save() {
    if (!trimmedName) {
      setError("invalid_circle_name");
      return;
    }
    if (isEmblemTooLong(emblem)) {
      setError("invalid_emblem");
      return;
    }
    let parsedMax: number | null = null;
    if (maxMembers.trim() !== "") {
      const n = Number(maxMembers);
      if (!Number.isInteger(n) || n < MIN_MAX_MEMBERS || n > MAX_MAX_MEMBERS || n < memberCount) {
        setError("invalid_max_members");
        return;
      }
      parsedMax = n;
    }
    setError(null);
    startTransition(async () => {
      const res = await saveCircleSettings(circleId, {
        name,
        colour,
        emblem: emblem.trim() === "" ? null : emblem.trim(),
        headerImage: header,
        homeVenueId: homeVenueId === "" ? null : homeVenueId,
        maxMembers: parsedMax,
      });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <>
      <Button variant="quiet" onClick={() => setOpen(true)} fullWidth>
        Edit Circle
      </Button>

      <Sheet open={open} onClose={close} title="Edit Circle">
        {/* The full settings form is taller than a phone viewport; the Sheet
            itself is bottom-anchored and doesn't scroll, so cap the body and
            let it scroll internally, keeping the top (preview + header picker)
            reachable. -mr keeps the scrollbar off the content's right edge. */}
        <div className="flex flex-col gap-5 max-h-[74vh] overflow-y-auto pr-1 -mr-1">
          {/* Live preview — the card art repaints as header/colour/mark/name change. */}
          <div className="rounded-card overflow-hidden border border-ink-hairline-2">
            <CircleCardArt
              circleId={circleId}
              headerImage={header}
              colour={colour}
              emblem={emblem.trim() || initials}
              name={trimmedName || "Your Circle"}
            />
          </div>

          <HeaderPicker selected={header} onChange={setHeader} />

          <div className="flex flex-col gap-2">
            <label htmlFor={`${idPrefix}edit-circle-name`} className="text-cu-body font-semibold text-ink">
              Circle name
            </label>
            <input
              id={`${idPrefix}edit-circle-name`}
              value={name}
              maxLength={MAX_CIRCLE_NAME_LENGTH}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tuesday Night Lot"
              className="w-full rounded-button px-4 py-3 text-[14px] outline-none bg-surface border border-ink-hairline-3 text-ink placeholder:text-ink-muted"
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-cu-meta uppercase tracking-[0.14em] text-ink-muted">Colour</span>
            <div className="flex flex-wrap gap-2.5">
              {COLOUR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColour(c)}
                  aria-pressed={colour === c}
                  aria-label={c}
                  className="w-9 h-9 rounded-full transition-cu-state"
                  style={{
                    background: c,
                    boxShadow: colour === c ? "0 0 0 3px var(--color-surface), 0 0 0 5px currentColor" : "none",
                    color: c,
                  }}
                />
              ))}
            </div>
          </div>

          <EmblemPicker emblem={emblem} onChange={setEmblem} />

          {/* Home court: pick a venue explicitly, or leave it automatic and let it
              derive from where the Circle plays. The helper states which it is. */}
          <div className="flex flex-col gap-2">
            <label htmlFor={`${idPrefix}edit-home-venue`} className="text-cu-body font-semibold text-ink">
              Home court
            </label>
            <select
              id={`${idPrefix}edit-home-venue`}
              value={homeVenueId}
              onChange={(e) => setHomeVenueId(e.target.value)}
              className="w-full rounded-button px-4 py-3 text-[14px] outline-none bg-surface border border-ink-hairline-3 text-ink"
            >
              <option value="">Automatic (where you play)</option>
              {venueOptions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            {homeVenueId ? (
              <Meta as="p">This is set by you, everyone sees it as the Circle&apos;s home court.</Meta>
            ) : anchor ? (
              <Meta as="p">Automatic, based on where you play: {anchor.venueName}.</Meta>
            ) : (
              <Meta as="p">Automatic. Once you play a venue with an address, it pins itself here.</Meta>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor={`${idPrefix}edit-max-members`} className="text-cu-body font-semibold text-ink">
              Max players (optional)
            </label>
            <input
              id={`${idPrefix}edit-max-members`}
              type="number"
              inputMode="numeric"
              min={MIN_MAX_MEMBERS}
              max={MAX_MAX_MEMBERS}
              value={maxMembers}
              onChange={(e) => setMaxMembers(e.target.value)}
              placeholder="No limit"
              className="w-full rounded-button px-4 py-3 text-[14px] outline-none bg-surface border border-ink-hairline-3 text-ink placeholder:text-ink-muted"
            />
            <Meta as="p">Most circles run 4 to 12. Leave it blank to keep joining open.</Meta>
          </div>

          <Button onClick={save} size="lg" fullWidth pending={pending} disabled={!trimmedName}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
          {error && <Meta tone="loss">{EDIT_ERROR_COPY[error] ?? EDIT_ERROR_COPY.something_went_wrong}</Meta>}
        </div>
      </Sheet>
    </>
  );
}
