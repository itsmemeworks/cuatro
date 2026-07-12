"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar, Button, Meta } from "@/components/ui";
import { sideHintShort, type FourthCallSideHint } from "@/components/circle-screens/fourth-call-side-hint";
import { DEFAULT_TZ, formatDayTime } from "@/lib/time";

export type FourthCallHomeSession = {
  sessionId: string;
  circleName: string;
  venueName: string | null;
  startsAt: Date;
  /** The session's effective IANA timezone (venue's, else the Circle's) for rendering its start time. Optional so older builders fall back to DEFAULT_TZ. */
  timezone?: string;
  askerAvatarUrl: string | null;
  askerName: string;
  /** "their level 4.2–4.9", or null when nobody confirmed yet has a rated Glass number. */
  levelRangeLabel: string | null;
  /** The viewer's own Glass rating, or null if unrated. */
  viewerRating: number | null;
  /** Organiser's optional court-side hint (issue #21) — display copy only, "I can play" is never gated on it. Optional so builders that don't read the column yet keep compiling. */
  sideHint?: FourthCallSideHint | null;
};

/**
 * The "incoming Fourth Call" card on Home (design/DESIGN-AUDIT.md H4):
 * coral-hairline card, an existing player's avatar, coral "I can play" /
 * quiet "Pass" — both just the ordinary RSVP endpoint (in/out), same one
 * SessionCard and NeedsAnswerCard already call, so accepting or passing
 * here is indistinguishable server-side from answering any other RSVP.
 */
export function FourthCallCard({
  session,
  demote = false,
}: {
  session: FourthCallHomeSession;
  /** When Home already has its one coral action elsewhere, the "I can play" button drops to `strong` so coral stays singular (audit-design #5). */
  demote?: boolean;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [pending, setPending] = useState<"in" | "out" | null>(null);

  if (dismissed) return null;

  async function respond(action: "in" | "out") {
    setPending(action);
    try {
      const res = await fetch(`/api/games/sessions/${session.sessionId}/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (res.ok && body.ok) {
        if (action === "out") setDismissed(true);
        router.refresh();
      }
    } catch {
      // Silent — the card just stays put and the tap can be retried.
    } finally {
      setPending(null);
    }
  }

  // Timezone-explicit (lib/time): the session's own venue/circle timezone, never the runtime's.
  const whenLabel = formatDayTime(session.startsAt, session.timezone ?? DEFAULT_TZ);
  const expiresHours = Math.max(1, Math.round((session.startsAt.getTime() - Date.now()) / (60 * 60 * 1000)));

  return (
    <div className="rounded-card border-[1.5px] border-action bg-surface p-3.5">
      <div className="flex items-center gap-2.5">
        <Avatar src={session.askerAvatarUrl} name={session.askerName} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-extrabold tracking-[0.1em] text-action">FOURTH CALL</p>
          <p className="text-cu-card-title text-[13px] leading-[1.3] mt-0.5">
            {session.circleName} need a 4th, {whenLabel}
            {session.venueName ? `, ${session.venueName}` : ""}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2.5 mt-2.5">
        <Button
          variant={demote ? "strong" : "primary"}
          size="default"
          pending={pending === "in"}
          disabled={pending !== null}
          onClick={() => respond("in")}
          className="flex-1"
        >
          I can play
        </Button>
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => respond("out")}
          className="text-[12px] font-semibold text-ink-muted px-2 disabled:opacity-40 transition-cu-state hover:text-ink"
        >
          Pass
        </button>
      </div>
      <Meta as="p" className="mt-2">
        {session.levelRangeLabel ? `${session.levelRangeLabel} · ` : ""}
        {session.viewerRating != null ? `yours ${session.viewerRating.toFixed(2)} · ` : ""}
        {session.sideHint ? `${sideHintShort(session.sideHint)} · ` : ""}
        expires in {expiresHours}h
      </Meta>
    </div>
  );
}
