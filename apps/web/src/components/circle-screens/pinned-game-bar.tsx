"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import { useSessionLive } from "@/lib/realtime/hooks";

/**
 * The "📌 Tue 8pm · Powerleague" bar that rides above both the Feed and the
 * Chat thread (prototype screens 4a/4b) — same session data as SessionCard,
 * compacted to one row with an inline RSVP pill. Uses the Circle's own
 * colour for the tint/border per Directions turn 10b ("one decision, every
 * touchpoint"), not the fixed blue the base prototype hardcodes.
 */
export function PinnedGameBar({
  sessionId,
  circleColour,
  venueLabel,
  whenLabel,
  slots,
  confirmedCount,
  viewerStatus,
  rsvpOpen,
}: {
  sessionId: string;
  circleColour: string;
  venueLabel: string;
  whenLabel: string;
  slots: number;
  confirmedCount: number;
  viewerStatus: "in" | "reserve" | "out" | null;
  rsvpOpen: boolean;
}) {
  const router = useRouter();
  const { show } = useToast();
  const [pending, setPending] = useState(false);
  const [localStatus, setLocalStatus] = useState(viewerStatus);
  const [justArrived, setJustArrived] = useState(false);

  useSessionLive(sessionId);

  const viewerIn = localStatus === "in";
  const openSpots = Math.max(0, slots - confirmedCount);
  const statusLabel =
    openSpots === 0
      ? `${slots} of ${slots} — game on`
      : `${confirmedCount} of ${slots} in · ${openSpots} spot${openSpots === 1 ? "" : "s"} left`;

  async function toggleRsvp() {
    if (pending || !rsvpOpen) return;
    setPending(true);
    const action = viewerIn ? "out" : "in";
    try {
      const res = await fetch(`/api/games/sessions/${sessionId}/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (res.ok && body.ok) {
        setLocalStatus(body.status);
        if (action === "in") {
          setJustArrived(true);
          setTimeout(() => setJustArrived(false), 500);
        }
        if (body.promotedUserId) show("A reserve just got promoted — the four's back to full.");
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="rounded-button px-3.5 py-2.5 flex items-center gap-3 transition-cu-state"
      style={{ background: `${circleColour}22`, border: `1px solid ${circleColour}` }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-cu-body font-bold text-ink truncate">
          📌 {whenLabel} · {venueLabel}
        </p>
        <p className="text-cu-meta text-ink-muted mt-0.5">{justArrived ? `${slots} of ${slots} — game on` : statusLabel}</p>
      </div>
      <button
        type="button"
        onClick={toggleRsvp}
        disabled={pending || !rsvpOpen}
        className={`rounded-button px-4 py-2.5 text-[12px] font-extrabold shrink-0 min-h-11 transition-cu-state active:opacity-80 disabled:opacity-50 ${
          viewerIn ? "bg-win text-action-contrast" : "bg-action text-action-contrast"
        }`}
      >
        {viewerIn ? "You're in ✓" : localStatus === "reserve" ? "Reserved" : "I'm in"}
      </button>
    </div>
  );
}
