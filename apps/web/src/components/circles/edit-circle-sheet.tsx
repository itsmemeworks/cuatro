"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Card, Meta, Sheet } from "@/components/ui";
import { saveCircleSettings } from "@/app/(app)/circles/[id]/door-actions";
import { COLOUR_PRESETS } from "./presets";
import { EmblemPicker, isEmblemTooLong } from "./emblem-picker";

// Mirrors MAX_CIRCLE_NAME_LENGTH in server/circles.ts — kept local so this
// client component never imports the better-sqlite3-backed server module.
const MAX_CIRCLE_NAME_LENGTH = 40;

// Circle-edit error codes → human copy. A page-local map (per the repo's
// error-copy rule) since these codes are specific to this surface.
const EDIT_ERROR_COPY: Record<string, string> = {
  invalid_circle_name: "Give your Circle a name, up to 40 characters.",
  invalid_emblem: "One emoji is plenty.",
  invalid_colour: "Pick one of the colours.",
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

/**
 * Organiser-only "Edit Circle": name, colour, emblem, with the create form's
 * live preview badge and colour swatches. Renders its own labelled trigger so
 * the affordance is findable, not a hidden icon. The Save inside the sheet is
 * the one coral action in its own surface; the trigger stays calm.
 */
export function EditCircleSheet({
  circleId,
  initialName,
  initialColour,
  initialEmblem,
  anchor,
}: {
  circleId: string;
  initialName: string;
  initialColour: string;
  initialEmblem: string | null;
  anchor: EditAnchor | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [colour, setColour] = useState(initialColour);
  const [emblem, setEmblem] = useState(initialEmblem ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initials = name.trim().slice(0, 2).toUpperCase() || "TN";
  const trimmedName = name.trim();

  function reset() {
    setName(initialName);
    setColour(initialColour);
    setEmblem(initialEmblem ?? "");
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
    setError(null);
    startTransition(async () => {
      const res = await saveCircleSettings(circleId, {
        name,
        colour,
        emblem: emblem.trim() === "" ? null : emblem.trim(),
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
        <div className="flex flex-col gap-5">
          {/* Live preview badge — repaints as colour/mark change. */}
          <Card className="flex items-center gap-4">
            <div
              className="w-[60px] h-[60px] rounded-card flex items-center justify-center shrink-0 transition-cu-state"
              style={{ background: colour }}
              aria-hidden
            >
              <span className="font-extrabold text-2xl text-white">{emblem.trim() || initials}</span>
            </div>
            <div className="min-w-0">
              <p className="text-cu-card-title text-ink truncate">{trimmedName || "Your Circle"}</p>
              <Meta as="p" className="mt-1">
                how your Circle shows up everywhere
              </Meta>
            </div>
          </Card>

          <div className="flex flex-col gap-2">
            <label htmlFor="edit-circle-name" className="text-cu-body font-semibold text-ink">
              Circle name
            </label>
            <input
              id="edit-circle-name"
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

          {/* Home court: the anchor venue everyone sees, with the full address here. */}
          <div className="flex flex-col gap-1 rounded-button border border-ink-hairline-4 px-3.5 py-3">
            <span className="text-cu-meta uppercase tracking-[0.14em] text-ink-muted">Home court</span>
            {anchor ? (
              <>
                <p className="text-cu-body text-ink">{anchor.venueName}</p>
                {anchor.address && <Meta as="p">{anchor.address}</Meta>}
              </>
            ) : (
              <Meta as="p">
                No home court yet. Set a venue with an address on your Standing Game and it pins itself.
              </Meta>
            )}
          </div>

          <Button onClick={save} size="lg" fullWidth disabled={pending || !trimmedName}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
          {error && <Meta tone="loss">{EDIT_ERROR_COPY[error] ?? EDIT_ERROR_COPY.something_went_wrong}</Meta>}
        </div>
      </Sheet>
    </>
  );
}
