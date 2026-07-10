"use client";

import { Button } from "@/components/ui";
import { Sheet } from "@/components/ui/sheet";

/** Cancelling a held slot inside this window before kickoff counts as a late cancel (matches server/games-service.ts's LATE_CANCEL_WINDOW_MS). */
export const LATE_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;

/** True when dropping now would land inside the 24h late-cancel window (and the game hasn't started). */
export function isLateCancel(startsAtMs: number, now: number = Date.now()): boolean {
  const msToStart = startsAtMs - now;
  return msToStart >= 0 && msToStart < LATE_CANCEL_WINDOW_MS;
}

/**
 * The point-of-action version of the Reliability rule (the badge's InfoTerm
 * explains it in the abstract; this is shown the moment it would apply). Warm
 * and factual, no shame: it names the one real consequence (Reliability, not
 * Glass) and lets the player back out. Only rendered when the drop is actually
 * inside the 24h window — an early cancel is free and never sees this.
 */
export function LateCancelSheet({
  open,
  onConfirm,
  onCancel,
  pending,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
}) {
  return (
    <Sheet open={open} onClose={onCancel} title="Pulling out this close counts">
      <p className="text-cu-body text-ink">
        Inside 24 hours this goes on your record as a late cancel. It dents Reliability, never your Glass rating.
      </p>
      <div className="flex flex-col gap-2 mt-4">
        <Button variant="strong" fullWidth disabled={pending} onClick={onCancel}>
          Keep my spot
        </Button>
        <Button variant="destructiveQuiet" fullWidth disabled={pending} onClick={onConfirm}>
          Pull out anyway
        </Button>
      </div>
    </Sheet>
  );
}
