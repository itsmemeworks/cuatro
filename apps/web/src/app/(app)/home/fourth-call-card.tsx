"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar, Button, Meta } from "@/components/ui";

export type FourthCallHomeSession = {
  sessionId: string;
  circleName: string;
  venueName: string | null;
  startsAt: Date;
  askerAvatarUrl: string | null;
  askerName: string;
  /** "their level 4.2–4.9", or null when nobody confirmed yet has a rated Glass number. */
  levelRangeLabel: string | null;
  /** The viewer's own Glass rating, or null if unrated. */
  viewerRating: number | null;
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
  const [pending, setPending] = useState(false);

  if (dismissed) return null;

  async function respond(action: "in" | "out") {
    setPending(true);
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
      setPending(false);
    }
  }

  const whenLabel = session.startsAt.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
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
        <Button variant={demote ? "strong" : "primary"} size="default" disabled={pending} onClick={() => respond("in")} className="flex-1">
          I can play
        </Button>
        <button
          type="button"
          disabled={pending}
          onClick={() => respond("out")}
          className="text-[12px] font-semibold text-ink-muted px-2 disabled:opacity-40"
        >
          Pass
        </button>
      </div>
      <Meta as="p" className="mt-2">
        {session.levelRangeLabel ? `${session.levelRangeLabel} · ` : ""}
        {session.viewerRating != null ? `yours ${session.viewerRating.toFixed(2)} · ` : ""}
        expires in {expiresHours}h
      </Meta>
    </div>
  );
}
