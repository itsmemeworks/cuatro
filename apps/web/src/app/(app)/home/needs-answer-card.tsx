"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar, Button, Card, DashedSlot, Meta } from "@/components/ui";
import { CircleEmblem } from "@/components/games/roster";
import { errorCopy } from "@/lib/error-copy";
import { DEFAULT_TZ, formatDayTime } from "@/lib/time";
import { needsAnswerMode } from "./rotation-affordance";

export type NeedsAnswerSession = {
  sessionId: string;
  circleId: string;
  circleName: string;
  /** The Circle's explicitly-chosen colour (palette hex) / emblem; null falls back to the deterministic seed colour + name initials. */
  circleColour: string | null;
  circleEmblem: string | null;
  venueName: string | null;
  startsAt: Date;
  /** The session's effective IANA timezone (venue's, else the Circle's) for rendering its start time. Optional so older builders fall back to DEFAULT_TZ. */
  timezone?: string;
  slots: number;
  /** Who's committed — or, on a gathering rotation game, who's AVAILABLE (the page passes the availability list; the card's copy follows `rotation`). */
  confirmed: { userId: string; displayName: string; avatarUrl: string | null }[];
  /**
   * Present iff this is a rotation game still gathering availability (THE
   * ROTATION): the card collects "I'm available" (never a slot-grab "I'm in")
   * and renders no spots-to-fill chrome — the fairness pick owns the four.
   */
  rotation?: { availableCount: number } | null;
};

type Viewer = { userId: string; displayName: string; avatarUrl: string | null };

/** "Kav & Mags are in" / "Kav is available" / "Kav, Mags & Tom are in" — the prototype's naming convention (design/CUATRO-Prototype-LATEST.dc.html's Home screen), first names only; the verb follows the game's answer mode (rotation collects availability). */
function namesLine(confirmed: { displayName: string }[], verb: "in" | "available"): string {
  const firstNames = confirmed.map((p) => p.displayName.split(" ")[0]);
  if (firstNames.length === 1) return `${firstNames[0]} is ${verb}`;
  const [last, ...rest] = [...firstNames].reverse();
  return `${rest.reverse().join(", ")} & ${last} are ${verb}`;
}

/**
 * The single surface-feature card on Home (design/HANDOFF.md screen 3):
 * "needs-your-answer card on surface-feature (single coral 'I'm in' +
 * quiet 'Can't')". Bespoke to Home rather than reusing
 * components/games/SessionCard — that component is a fuller game-detail
 * card (slot grid, countdown, reserves) meant for the games list; this is
 * the terser "answer this now" hero moment the prototype's Home screen
 * leads with. Both call the same RSVP endpoint.
 *
 * Tapping "I'm in" mirrors SessionCard's signature arrival treatment
 * (audit-design #6): the viewer's avatar springs into the confirmed stack
 * (animate-cu-arrive) with one pulse ring (animate-cu-pulse-once) and the
 * button flips to "You're in ✓ · game on" — optimistically, before the
 * server round-trip and router.refresh() reconcile it.
 */
export function NeedsAnswerCard({ session, viewer }: { session: NeedsAnswerSession; viewer: Viewer }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [optimisticIn, setOptimisticIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rotation games collect availability, everything else a slot RSVP — one
  // decision (rotation-affordance.ts), used by the actions AND the copy so
  // the card can never say "I'm in" about a game where nobody holds a slot.
  const mode = needsAnswerMode(session.rotation);

  async function respond(action: "in" | "out" | "available" | "unavailable") {
    setPending(true);
    setError(null);
    setOptimisticIn(action === mode.yesAction);
    try {
      const res = await fetch(`/api/games/sessions/${session.sessionId}/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setOptimisticIn(false);
        setError(body.error ?? "something_went_wrong");
        return;
      }
      router.refresh();
    } catch {
      setOptimisticIn(false);
      setError("network_error");
    } finally {
      setPending(false);
    }
  }

  // Timezone-explicit (lib/time): the session's own venue/circle timezone, never the runtime's.
  const when = formatDayTime(session.startsAt, session.timezone ?? DEFAULT_TZ);
  const place = session.venueName ? ` · ${session.venueName}` : "";

  // The card only renders when the viewer hasn't answered yet, so they're
  // never already in `confirmed` — appending them is a safe optimistic fill.
  const displayConfirmed = optimisticIn ? [...session.confirmed, viewer] : session.confirmed;
  const shown = displayConfirmed.slice(0, 3);
  const overflow = Math.max(0, displayConfirmed.length - 3);
  // A gathering rotation game has no literal spots — the fairness pick owns
  // the four, so no dashed to-fill slots and no "N spots to fill" copy.
  const spotsToFill = session.rotation ? 0 : Math.max(session.slots - displayConfirmed.length, 0);

  return (
    <Card variant="feature">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-action" aria-hidden />
        <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-action-on-feature-label">NEEDS YOUR ANSWER</p>
        <span className="flex-1" />
        <Link href={`/games/${session.sessionId}`} className="text-[11px] font-bold text-action-on-feature-link">
          View game →
        </Link>
      </div>
      <div className="flex items-center gap-2 mt-2.5">
        <CircleEmblem seed={session.circleId} name={session.circleName} emblem={session.circleEmblem} colour={session.circleColour} px={22} />
        <p className="text-[11.5px] font-extrabold uppercase tracking-[0.08em] text-ink-on-feature-muted truncate">
          {session.circleName}
        </p>
      </div>
      <p className="text-cu-title text-[19px] leading-[1.2] mt-1.5 text-ink-on-feature">
        {when}
        {place}
      </p>
      {displayConfirmed.length > 0 && (
        <div className={`flex items-center gap-2.5 mt-3 ${optimisticIn ? "animate-cu-pulse-once" : ""}`}>
          <div className="flex items-center">
            {shown.map((p, i) => (
              <Avatar
                key={p.userId}
                src={p.avatarUrl}
                name={p.displayName}
                size="sm"
                ring="surface-feature"
                overlap={i > 0}
                className={optimisticIn && p.userId === viewer.userId ? "animate-cu-arrive" : ""}
              />
            ))}
            {overflow > 0 && (
              <div
                className="rounded-full flex-none flex items-center justify-center bg-ink-hairline-2 text-ink font-bold ring-2 ring-[var(--color-surface-feature)]"
                style={{ width: 26, height: 26, marginLeft: -10, fontSize: 8 }}
              >
                +{overflow}
              </div>
            )}
            {/* One dashed-coral slot per spot still to fill — the fourth's empty chair, honest at a glance. */}
            {Array.from({ length: spotsToFill }, (_, i) => (
              <DashedSlot key={`open-${i}`} size="sm" label="" overlap={shown.length > 0 || overflow > 0 || i > 0} />
            ))}
          </div>
          <span className="text-[11.5px] font-medium text-ink-on-feature-muted">
            {optimisticIn
              ? mode.confirmedLabel
              : session.rotation
                ? `${namesLine(session.confirmed, mode.verb)}, the rotation picks the four`
                : `${namesLine(session.confirmed, mode.verb)}, ${spotsToFill} spot${spotsToFill === 1 ? "" : "s"} to fill`}
          </span>
        </div>
      )}
      {error && (
        <Meta as="p" tone="loss" onFeature className="mt-2">
          {errorCopy(error)}
        </Meta>
      )}
      {/*
        Card variant="feature" is a deliberately dark card in BOTH themes
        (see globals.css's comment on --color-surface-feature), so Button
        needs its `onFeature` prop here — plain "quiet" would use the
        theme-reactive `text-ink`/`border-ink-hairline-4` tokens, which
        would render dark-on-dark under a light OS theme. `primary` is fine
        either way (bg-action/text-action-contrast are theme-independent),
        `onFeature` is a no-op for it.
      */}
      <div className="flex gap-2 mt-3.5">
        {optimisticIn ? (
          <Button
            variant="strong"
            size="lg"
            onFeature
            disabled={pending}
            onClick={() => respond(mode.noAction)}
            style={{ background: "var(--color-win)", color: "var(--color-action-contrast)" }}
            className="flex-1"
          >
            {mode.confirmedLabel}
          </Button>
        ) : (
          <>
            <Button variant="primary" size="lg" onFeature disabled={pending} onClick={() => respond(mode.yesAction)} className="flex-[2]">
              {mode.yesLabel}
            </Button>
            <Button variant="destructiveQuiet" size="lg" onFeature disabled={pending} onClick={() => respond(mode.noAction)} className="flex-1">
              Can&apos;t
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
