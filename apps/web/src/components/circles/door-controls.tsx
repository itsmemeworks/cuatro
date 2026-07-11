"use client";

import { useState, useTransition } from "react";
import { Meta, Button } from "@/components/ui";
import { InfoTerm } from "@/components/ui/info-term";
import { Toggle } from "@/components/ui/toggle";
import { saveDoorSettings } from "@/app/(app)/circles/[id]/door-actions";

const MAX_VIBE_LINE_LENGTH = 120;

type Tier = "open" | "invite_only" | "private";

/**
 * The plain-words state of the two flags, shown live as the organiser toggles
 * (task copy is authoritative here). The door is the stronger signal: with it
 * open the Circle is Open regardless of the Board flag; only once the door is
 * shut does the Board flag decide between invite-only and fully private.
 */
const TIER_COPY: Record<Tier, { name: string; line: string }> = {
  open: { name: "Open", line: "nearby players can find you and knock" },
  invite_only: {
    name: "Invite only",
    line: "your Circle is visible near you and your open games take asks, but joining is by invite link",
  },
  private: { name: "Private", line: "invisible to discovery" },
};

function tierFor(openDoor: boolean, boardEnabled: boolean): Tier {
  if (openDoor) return "open";
  return boardEnabled ? "invite_only" : "private";
}



/**
 * Organiser visibility controls: the Open Door and Board toggles side by side
 * (so both flags that set the Circle's tier live in one place) plus the
 * one-line vibe editor. A live tier line spells out what the current flag
 * combination means in plain words. Calm, not coral (the screen's coral action
 * is elsewhere). Writes through the saveDoorSettings server action.
 */
export function DoorControls({
  circleId,
  initialOpenDoor,
  initialBoardEnabled,
  initialVibeLine,
  initialDefaultGameType,
}: {
  circleId: string;
  initialOpenDoor: boolean;
  initialBoardEnabled: boolean;
  initialVibeLine: string | null;
  initialDefaultGameType: "competitive" | "friendly";
}) {
  const [openDoor, setOpenDoor] = useState(initialOpenDoor);
  const [defaultGameType, setDefaultGameType] = useState(initialDefaultGameType);
  const [boardEnabled, setBoardEnabled] = useState(initialBoardEnabled);
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

  function toggleBoard() {
    const next = !boardEnabled;
    setBoardEnabled(next);
    setError(false);
    startTransition(async () => {
      const res = await saveDoorSettings(circleId, { boardEnabled: next });
      if (!res.ok) {
        setBoardEnabled(!next); // revert
        setError(true);
      }
    });
  }

  function changeDefaultGameType(next: "competitive" | "friendly") {
    const prev = defaultGameType;
    setDefaultGameType(next);
    setError(false);
    startTransition(async () => {
      const res = await saveDoorSettings(circleId, { defaultGameType: next });
      if (!res.ok) {
        setDefaultGameType(prev); // revert
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
  const tier = TIER_COPY[tierFor(openDoor, boardEnabled)];
  // The vibe line rides on the directory card, which shows in both discoverable
  // tiers, so keep the editor available whenever the Circle is visible at all.
  const visible = openDoor || boardEnabled;

  return (
    <div className="rounded-button border border-ink-hairline-4 px-3.5 py-3 flex flex-col gap-3">
      <div>
        <p className="text-cu-body font-bold text-ink">
          <InfoTerm term="openDoor" label="Discovery" />
        </p>
        <p className="text-cu-secondary text-ink mt-0.5">
          {tier.name}, <span className="text-ink-muted">{tier.line}</span>
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-cu-body text-ink">Open Door</p>
          <Meta as="p" className="mt-0.5">nearby players can knock to join</Meta>
        </div>
        <Toggle checked={openDoor} onToggle={toggleDoor} label="Open Door" disabled={pending} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-cu-body text-ink">Show on the Board</p>
          <Meta as="p" className="mt-0.5">your open games appear to players near you</Meta>
        </div>
        <Toggle checked={boardEnabled} onToggle={toggleBoard} label="Show on the Board" disabled={pending} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-cu-body text-ink">New games default to</p>
          <Meta as="p" className="mt-0.5">friendly games keep scores and Reliability but never move Glass</Meta>
        </div>
        <select
          value={defaultGameType}
          onChange={(e) => changeDefaultGameType(e.target.value === "friendly" ? "friendly" : "competitive")}
          disabled={pending}
          aria-label="Default game type"
          className="rounded-button border border-ink-hairline-4 bg-surface px-2.5 py-2 text-cu-body text-ink"
        >
          <option value="competitive">Competitive</option>
          <option value="friendly">Friendly</option>
        </select>
      </div>

      {visible && (
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
            <Button variant="quiet" onClick={saveVibe} pending={pending} disabled={!vibeDirty}>
              Save
            </Button>
          </div>
        </div>
      )}

      {error && <Meta tone="loss">Couldn&apos;t save that just now. Give it another tap.</Meta>}
    </div>
  );
}
