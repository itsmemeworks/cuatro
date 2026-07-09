"use client";

import { useState, useTransition } from "react";
import { Meta, Button } from "@/components/ui";
import { InfoTerm } from "@/components/ui/info-term";
import { saveDoorSettings } from "@/app/(app)/circles/[id]/door-actions";

const MAX_VIBE_LINE_LENGTH = 120;

/**
 * Organiser-only Open Door controls: the door toggle + the one-line vibe
 * editor. Calm, not coral (the screen's coral action is elsewhere). Writes
 * through the saveDoorSettings server action.
 */
export function DoorControls({
  circleId,
  initialOpenDoor,
  initialVibeLine,
}: {
  circleId: string;
  initialOpenDoor: boolean;
  initialVibeLine: string | null;
}) {
  const [openDoor, setOpenDoor] = useState(initialOpenDoor);
  const [vibeLine, setVibeLine] = useState(initialVibeLine ?? "");
  const [savedVibe, setSavedVibe] = useState(initialVibeLine ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  function toggleDoor() {
    const next = !openDoor;
    setOpenDoor(next);
    setError(false);
    startTransition(async () => {
      const res = await saveDoorSettings(circleId, { openDoor: next });
      if (!res.ok) {
        setOpenDoor(!next); // revert
        setError(true);
      }
    });
  }

  function saveVibe() {
    setError(false);
    startTransition(async () => {
      const res = await saveDoorSettings(circleId, { vibeLine });
      if (res.ok) {
        setSavedVibe(vibeLine.trim());
      } else {
        setError(true);
      }
    });
  }

  const vibeDirty = vibeLine.trim() !== savedVibe.trim();

  return (
    <div className="rounded-button border border-ink-hairline-4 px-3.5 py-3 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-cu-body font-bold text-ink">
            <InfoTerm term="openDoor" label="Open Door" />
          </p>
          <Meta as="p" className="mt-0.5">
            {openDoor ? "players near your patch can knock to join" : "closed, your Circle won't show in the directory"}
          </Meta>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={openDoor}
          aria-label="Open Door"
          onClick={toggleDoor}
          disabled={pending}
          className={`relative w-11 h-6 rounded-full shrink-0 transition-cu-state ${openDoor ? "bg-action" : "bg-ink-hairline-3"} disabled:opacity-50`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${openDoor ? "translate-x-5" : ""}`}
            aria-hidden
          />
        </button>
      </div>

      {openDoor && (
        <div className="flex flex-col gap-2">
          <label htmlFor="vibe-line" className="text-cu-meta text-ink-muted">
            Vibe line, one warm sentence on your directory card
          </label>
          <input
            id="vibe-line"
            type="text"
            value={vibeLine}
            maxLength={MAX_VIBE_LINE_LENGTH}
            onChange={(e) => setVibeLine(e.target.value)}
            placeholder="friendly 3.5–4.5 four, Tuesdays"
            className="rounded-button border border-ink-hairline-4 bg-surface px-3 py-2.5 text-cu-body text-ink placeholder:text-ink-muted"
          />
          <div className="flex items-center justify-between gap-3">
            <Meta>{vibeLine.length}/{MAX_VIBE_LINE_LENGTH}</Meta>
            <Button variant="quiet" onClick={saveVibe} disabled={pending || !vibeDirty}>
              Save
            </Button>
          </div>
        </div>
      )}

      {error && <Meta tone="loss">Couldn&apos;t save that just now. Give it another tap.</Meta>}
    </div>
  );
}
