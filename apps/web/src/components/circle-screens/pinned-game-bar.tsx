"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast, Meta, PendingSpinner } from "@/components/ui";
import { useSessionLive } from "@/lib/realtime/hooks";
import { formatCountdown } from "@/components/games/SessionCard";
import { rsvpWindowPhase } from "./pinned-game-view";
import { errorCopy } from "@/lib/error-copy";
import { BookingChip } from "@/components/games/booking-chip";
import type { BookingSignpost } from "@/lib/booking";

/**
 * The "📌 Tue 8pm · Powerleague" bar that rides above both the Feed and the
 * Chat thread (prototype screens 4a/4b) — same session data as SessionCard,
 * compacted to one row with an inline RSVP pill. Uses the Circle's own
 * colour for the tint/border per Directions turn 10b ("one decision, every
 * touchpoint"), not the fixed blue the base prototype hardcodes.
 *
 * Mirrors SessionCard's RSVP-window semantics exactly: an "I'm in" pill only
 * when the window is actually open; before it opens, the honest "RSVPs open …"
 * line (mono Meta) rather than a dead coral button that no-ops on a
 * `window_not_open` 400. Any RSVP error still surfaces through errorCopy as
 * defence-in-depth.
 */
export function PinnedGameBar({
  sessionId,
  circleColour,
  venueLabel,
  whenLabel,
  slots,
  confirmedCount,
  viewerStatus,
  rsvpWindowOpensAt,
  startsAt,
  booking = null,
}: {
  sessionId: string;
  circleColour: string;
  venueLabel: string;
  whenLabel: string;
  slots: number;
  confirmedCount: number;
  viewerStatus: "in" | "reserve" | "out" | null;
  /** UTC instant the RSVP window opens. */
  rsvpWindowOpensAt: Date;
  /** UTC instant the session starts (the window's far edge). */
  startsAt: Date;
  /** Issue #21: the game's "Booked on" signpost, when its money opt-in resolves to a booking. Null (the default, and the default state of money on a game) renders nothing. */
  booking?: BookingSignpost | null;
}) {
  const router = useRouter();
  const { show } = useToast();
  const [now, setNow] = useState<number>(() => Date.now());
  const [pending, setPending] = useState(false);
  const [localStatus, setLocalStatus] = useState(viewerStatus);
  const [justArrived, setJustArrived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useSessionLive(sessionId);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const opensMs = rsvpWindowOpensAt.getTime();
  const startsMs = startsAt.getTime();
  const phase = rsvpWindowPhase(now, opensMs, startsMs);
  const rsvpOpen = phase === "open";
  const sessionStarted = phase === "started";

  const viewerIn = localStatus === "in";
  const openSpots = Math.max(0, slots - confirmedCount);
  const statusLabel =
    openSpots === 0
      ? `${slots} of ${slots}, game on`
      : `${confirmedCount} of ${slots} in · ${openSpots} spot${openSpots === 1 ? "" : "s"} left`;

  // Far out (a brand-new organiser's first game can open up to 6 days away):
  // name the weekday. Close in: the live countdown, matching the session
  // page's "RSVPs open in 12h 40m".
  const msUntilOpen = opensMs - now;
  const opensLabel =
    msUntilOpen > 24 * 60 * 60 * 1000
      ? `RSVPs open ${rsvpWindowOpensAt.toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short" })}`
      : `RSVPs open in ${formatCountdown(msUntilOpen)}`;

  async function toggleRsvp() {
    if (pending || !rsvpOpen) return;
    setPending(true);
    setError(null);
    const action = viewerIn ? "out" : "in";
    try {
      const res = await fetch(`/api/games/sessions/${sessionId}/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error ?? "something_went_wrong");
        return;
      }
      setLocalStatus(body.status);
      if (action === "in") {
        setJustArrived(true);
        setTimeout(() => setJustArrived(false), 500);
      }
      if (body.promotedUserId) show("A reserve just got promoted, the four's back to full.");
      router.refresh();
    } catch {
      setError("network_error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="rounded-button px-3.5 py-2.5 flex items-center gap-3 transition-cu-state"
        style={{ background: `${circleColour}22`, border: `1px solid ${circleColour}` }}
      >
        <div className="flex-1 min-w-0">
          {/* The pinned game is a real session — the text is its way in (every
              rendered game is actionable); the RSVP pill stays its own control. */}
          <Link href={`/games/${sessionId}`} className="block transition-cu-state hover:opacity-80">
            <p className="text-cu-body font-bold text-ink truncate">
              📌 {whenLabel} · {venueLabel}
            </p>
            <p className="text-cu-meta text-ink-muted mt-0.5">{justArrived ? `${slots} of ${slots}, game on` : statusLabel}</p>
          </Link>
          {booking && (
            <div className="mt-1">
              <BookingChip booking={booking} size={18} />
            </div>
          )}
        </div>
        {rsvpOpen ? (
          <button
            type="button"
            onClick={toggleRsvp}
            disabled={pending}
            aria-busy={pending || undefined}
            className={`rounded-button px-4 py-2.5 text-[12px] font-extrabold shrink-0 min-h-11 inline-flex items-center justify-center gap-2 transition-cu-state hover:opacity-90 active:opacity-80 disabled:opacity-50 ${
              viewerIn ? "bg-win text-action-contrast" : "bg-action text-action-contrast"
            }`}
          >
            {pending && <PendingSpinner />}
            {viewerIn ? "You're in ✓" : localStatus === "reserve" ? "Reserved" : "I'm in"}
          </button>
        ) : !sessionStarted ? (
          // No active coral before the window opens — the honest "opens …" line
          // instead, matching the session page (design/HANDOFF.md screen 4).
          <Meta as="p" className="shrink-0 text-right whitespace-nowrap">
            {opensLabel}
          </Meta>
        ) : null}
      </div>
      {error && (
        <Meta as="p" tone="action" className="px-1">
          {errorCopy(error)}
        </Meta>
      )}
    </div>
  );
}
