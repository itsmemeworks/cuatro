"use client";

import { useRef, useState } from "react";
import { Avatar, Button, Card, Chip, DashedSlot, Fact, Meta, Sheet } from "@/components/ui";
import { formatGlass } from "@/lib/design";
import { ResultEntryForm, type ResultEntryPlayer } from "@/components/matches/result-entry-form";

/** A player already on court, or in the pool that can be added. Mirrors matches-db's RosterPlayer. */
export interface RosterCandidate {
  id: string;
  displayName: string;
  rating: number | null;
  avatarUrl: string | null;
  isGuest: boolean;
}

type Slot = ResultEntryPlayer & { isGuest: boolean };

/**
 * The result-entry roster editor. A played game's four aren't always the four
 * who RSVP'd — someone drops out and a mate fills in at the last minute. This
 * lets the reporter set who was actually on court (swap in another Circle
 * member, or add a named guest) before the score form appears. Once exactly
 * four are set, the existing ResultEntryForm takes over unchanged.
 *
 * The reporter has to be one of the four: they're recording it, and their
 * team's confirmation is sealed in at record time (see matches-db.recordMatch).
 */
export function RosterEntry({
  sessionId,
  viewerId,
  confirmed,
  candidates,
}: {
  sessionId: string;
  viewerId: string;
  confirmed: RosterCandidate[];
  candidates: RosterCandidate[];
}) {
  const [roster, setRoster] = useState<Slot[]>(() => confirmed.map(toSlot));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [guestName, setGuestName] = useState("");
  const guestTokenSeq = useRef(0);

  const rosterIds = new Set(roster.map((p) => p.id));
  const addable = candidates.filter((c) => !rosterIds.has(c.id));
  const viewerInRoster = roster.some((p) => p.id === viewerId);
  const full = roster.length === 4;
  const ready = full && viewerInRoster;

  function addExisting(c: RosterCandidate) {
    if (roster.length >= 4) return;
    setRoster((prev) => [...prev, toSlot(c)]);
    setPickerOpen(false);
  }

  function addGuest() {
    const name = guestName.trim();
    if (!name || roster.length >= 4) return;
    const token = `g${guestTokenSeq.current++}`;
    setRoster((prev) => [...prev, { id: token, displayName: name, rating: null, avatarUrl: null, isGuest: true, pending: true }]);
    setGuestName("");
    setPickerOpen(false);
  }

  function remove(id: string) {
    setRoster((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3">
        <div>
          <h2 className="text-cu-card-title text-ink">Who played?</h2>
          <Meta className="mt-1 block">The four who were on court — swap anyone who didn&apos;t make it.</Meta>
        </div>

        <ul className="flex flex-col gap-2.5">
          {roster.map((p) => {
            const isViewer = p.id === viewerId;
            return (
              <li key={p.id} className="flex items-center gap-2.5">
                <Avatar src={p.avatarUrl} name={isViewer ? "You" : p.displayName} size="sm" ring="surface" />
                <span className="flex-1 min-w-0 flex items-center gap-2 text-cu-body font-bold text-ink truncate">
                  {isViewer ? "You" : p.displayName}
                  {isViewer && (
                    <Chip tint={{ bg: "rgba(255,92,61,0.16)", text: "var(--color-action-strong)" }} className="text-[9px] tracking-[0.06em]">
                      YOU
                    </Chip>
                  )}
                </span>
                <RosterRating slot={p} />
                {!isViewer && (
                  <button
                    type="button"
                    onClick={() => remove(p.id)}
                    aria-label={`Remove ${p.displayName}`}
                    className="text-ink-muted text-[18px] leading-none w-7 h-7 flex items-center justify-center rounded-full active:opacity-60"
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}

          {!full && (
            <li>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="w-full flex items-center gap-2.5 text-left active:opacity-70"
              >
                <DashedSlot label="+" size="sm" />
                <span className="text-cu-body font-bold text-action">Add someone</span>
              </button>
            </li>
          )}
        </ul>

        {full && !viewerInRoster && (
          <p className="text-cu-meta text-ink-muted">
            You&apos;re logging this, so you need to be one of the four. Take someone out and add yourself.
          </p>
        )}
      </Card>

      {ready ? (
        // Re-key on the exact four so the score form's team/pairing state
        // re-initialises cleanly whenever the roster changes underneath it.
        <ResultEntryForm
          key={roster.map((p) => p.id).join("|")}
          sessionId={sessionId}
          players={roster}
          viewerId={viewerId}
        />
      ) : (
        <p className="text-cu-meta text-ink-muted text-center px-6">
          {full ? "Add yourself to the four to log the score." : `Set all four players to log the score — ${4 - roster.length} to go.`}
        </p>
      )}

      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Add a player">
        <div className="flex flex-col gap-4">
          {addable.length > 0 && (
            <ul className="flex flex-col">
              {addable.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => addExisting(c)}
                    className="w-full flex items-center gap-2.5 py-2.5 text-left active:opacity-70"
                  >
                    <Avatar src={c.avatarUrl} name={c.id === viewerId ? "You" : c.displayName} size="sm" ring="surface" />
                    <span className="flex-1 min-w-0 flex items-center gap-2 text-cu-body font-bold text-ink truncate">
                      {c.id === viewerId ? "You" : c.displayName}
                    </span>
                    <RosterRating slot={toSlot(c)} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-2">
            <label htmlFor="roster-guest-name" className="text-cu-secondary font-bold text-ink">
              Someone not in the Circle?
            </label>
            <div className="flex items-center gap-2">
              <input
                id="roster-guest-name"
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addGuest();
                  }
                }}
                placeholder="Their first name"
                maxLength={40}
                className="flex-1 min-w-0 rounded-button bg-ground border border-ink-hairline-2 px-3 min-h-11 text-cu-body text-ink placeholder:text-ink-muted"
              />
              <Button type="button" variant="primary" onClick={addGuest} disabled={guestName.trim() === ""}>
                Add
              </Button>
            </div>
            <Meta>They&apos;ll play as a guest — a rating starts building for them, no account needed.</Meta>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function toSlot(c: RosterCandidate): Slot {
  return { id: c.id, displayName: c.displayName, rating: c.rating, avatarUrl: c.avatarUrl, isGuest: c.isGuest };
}

/** Right-aligned rating tag for a roster row: the Glass number if rated, else a plain "New"/"Unrated" state. */
function RosterRating({ slot }: { slot: Slot }) {
  if (slot.rating != null) {
    return (
      <Fact size="sm" tone="muted">
        {formatGlass(slot.rating)}
      </Fact>
    );
  }
  return <Meta>{slot.pending ? "New" : slot.isGuest ? "Guest" : "Unrated"}</Meta>;
}
