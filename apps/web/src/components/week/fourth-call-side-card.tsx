"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui";
import { useRsvp } from "./use-rsvp";
import { expiresInLabel, levelBandLabel, whenLabel } from "./format";
import { sideHintShort, type FourthCallSideHint } from "@/components/circle-screens/fourth-call-side-hint";

export interface WeekFourthCallCard {
  sessionId: string;
  circleName: string;
  venueName: string | null;
  startsAt: number;
  timezone: string;
  askerName: string;
  askerAvatarUrl: string | null;
  confirmedRatings: number[];
  viewerRating: number | null;
  /** Organiser's optional court-side hint (issue #21) — display copy only, "I can play" is never gated on it. Optional so server/week.ts keeps compiling until it reads the column. */
  sideHint?: FourthCallSideHint | null;
}

/**
 * The incoming Fourth Call side card (design "Desktop · Your week"): a
 * coral-hairline card with the asking player's face, an outline "I can play"
 * and a quiet "Pass". Coral stays with the needs-answer panel, so this card's
 * accept is an outline, not a filled coral (one solid-coral action per panel).
 * Same RSVP endpoint as everywhere (useRsvp) — accepting fills the slot.
 */
export function FourthCallSideCard({ card }: { card: WeekFourthCallCard }) {
  const { respond, pending, answered } = useRsvp(card.sessionId);
  // Which button was tapped, so only IT shows the pending spinner (useRsvp's
  // pending is a single flag shared by both actions).
  const [tapped, setTapped] = useState<"in" | "out" | null>(null);
  if (answered === "out") return null;

  const band = levelBandLabel(card.confirmedRatings);
  const meta = [
    band,
    card.viewerRating != null ? `yours ${card.viewerRating.toFixed(2)}` : null,
    card.sideHint ? sideHintShort(card.sideHint) : null,
    expiresInLabel(card.startsAt, Date.now()),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-card bg-surface border-[1.5px] border-action p-4">
      <div className="flex items-center gap-2.5">
        <Avatar src={card.askerAvatarUrl} name={card.askerName} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-extrabold tracking-[0.1em] text-action-on-feature-link">FOURTH CALL</p>
          <p className="text-[12.5px] leading-[1.3] font-bold text-ink mt-0.5">
            {card.circleName} need a 4th, {whenLabel(card.startsAt, card.timezone)}
            {card.venueName ? `, ${card.venueName}` : ""}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2.5 mt-3">
        <button
          type="button"
          disabled={pending}
          aria-busy={(pending && tapped === "in") || undefined}
          onClick={() => {
            setTapped("in");
            respond("in");
          }}
          className="flex-1 rounded-button border border-ink-hairline-4 text-ink text-[12.5px] font-semibold text-center py-2.5 disabled:opacity-40 transition-cu-state hover:bg-ink-hairline-1 inline-flex items-center justify-center gap-2"
        >
          {pending && tapped === "in" && (
            <span aria-hidden className="inline-block h-[1em] w-[1em] flex-none animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
          )}
          I can play
        </button>
        <button
          type="button"
          disabled={pending}
          aria-busy={(pending && tapped === "out") || undefined}
          onClick={() => {
            setTapped("out");
            respond("out");
          }}
          className="text-[12px] font-semibold text-ink-muted px-2 disabled:opacity-40 transition-cu-state hover:text-ink"
        >
          {pending && tapped === "out" ? "…" : "Pass"}
        </button>
      </div>
      {meta && <p className="text-[10px] font-mono text-ink-muted mt-2.5 tabular-nums">{meta}</p>}
    </div>
  );
}
