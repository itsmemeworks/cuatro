"use client";

import { useEffect, useState } from "react";
import { Card, Fact, InfoTerm, Meta } from "@/components/ui";
import { RatingReveal, hasSeenRatingReveal } from "@/components/glass-screens/rating-reveal";
import type { ProfileGlassView } from "@/server/matches-db";
import { Sparkline } from "./sparkline";
import { PlacementTrioProgress } from "./placement-trio-progress";

/**
 * The Glass hero (design/HANDOFF.md screen 8): 56px 2dp number, confidence
 * bar, season sparkline, "sharpens every time you play". Also owns the
 * Unrated placement-progress state, and the one-time Rating Reveal
 * choreography (Directions turn 8c) the moment a player's Placement Trio
 * verifies — see components/glass-screens/rating-reveal.tsx.
 */
export function GlassHero({
  glass,
  userId,
  sparklineValues,
  deltaSinceFirst,
  enableReveal = true,
}: {
  glass: ProfileGlassView;
  userId: string;
  /** ratingAfter across every Ledger entry, oldest -> newest — the season sparkline. */
  sparklineValues: number[];
  /** Sum of every Ledger delta — "how far Glass has moved since it was poured." Null when there's nothing to compare yet. */
  deltaSinceFirst: number | null;
  /** The one-time Rating Reveal choreography is the OWNER's first-look moment — suppress it when someone else is viewing this player's public profile. */
  enableReveal?: boolean;
}) {
  const [revealDismissed, setRevealDismissed] = useState(false);
  const [showReveal, setShowReveal] = useState(false);

  useEffect(() => {
    if (enableReveal && glass.status === "rated" && !hasSeenRatingReveal(userId)) setShowReveal(true);
  }, [enableReveal, glass.status, userId]);

  if (glass.status === "unrated") {
    const played = glass.verifiedMatchCount;
    const remaining = glass.matchesUntilPlacement;
    return (
      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <PlacementTrioProgress verifiedMatchCount={played} size="lg" />
          <div>
            <p className="text-cu-card-title text-ink">Glass: Unrated</p>
            <p className="text-cu-secondary text-ink-muted mt-0.5">
              {remaining === 0
                ? "Your Placement Trio is complete. Your number appears the moment this match verifies."
                : remaining === 1
                  ? "One more verified match and your Glass number appears. No rush, no rounding."
                  : `${remaining} of 3 placement matches to go. Nobody's a number yet.`}
            </p>
          </div>
        </div>
        <div className="w-full h-1.5 rounded-chip bg-ink-hairline-2 overflow-hidden">
          <div className="h-full rounded-chip bg-action" style={{ width: `${(played / 3) * 100}%` }} />
        </div>
        <Meta>No questionnaire. No guessing. Your number only shows once real matches have earned it.</Meta>
      </Card>
    );
  }

  if (showReveal && !revealDismissed) {
    return (
      <RatingReveal
        userId={userId}
        displayName={glass.displayName.split(" ")[0] ?? glass.displayName}
        rating={glass.rating!}
        confidencePct={glass.confidencePct}
        onDone={() => setRevealDismissed(true)}
      />
    );
  }

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <p className="text-cu-secondary font-extrabold tracking-[0.12em] text-ink-muted">
          <InfoTerm term="glass" label="GLASS" />
        </p>
        {deltaSinceFirst != null && (
          <Fact size="sm" weight="semibold" tone={deltaSinceFirst >= 0 ? "win" : "loss"}>
            {deltaSinceFirst >= 0 ? "▲" : "▼"} {deltaSinceFirst >= 0 ? "+" : ""}
            {deltaSinceFirst.toFixed(2)} this season
          </Fact>
        )}
      </div>
      <div className="flex items-baseline gap-3 mt-1">
        <span className="text-cu-hero text-ink tabular-nums">{glass.rating!.toFixed(2)}</span>
        <div className="flex-1 h-[34px]">
          <Sparkline values={sparklineValues} />
        </div>
      </div>
      <Meta className="block">on the 1.00–7.00 Glass scale</Meta>
      <div className="mt-1.5">
        <div className="flex justify-between text-cu-meta text-ink-muted">
          <InfoTerm term="confidence" label="conf" />
          <Fact size="meta" weight="semibold">{glass.confidencePct}%</Fact>
        </div>
        <div className="h-1.5 rounded-chip bg-ink-hairline-2 mt-1 overflow-hidden">
          <div className="h-full rounded-chip bg-action" style={{ width: `${glass.confidencePct}%` }} />
        </div>
        <Meta className="mt-1.5 block">
          based on {glass.verifiedMatchCount} verified {glass.verifiedMatchCount === 1 ? "game" : "games"} · sharpens every time you play
        </Meta>
      </div>
    </Card>
  );
}
