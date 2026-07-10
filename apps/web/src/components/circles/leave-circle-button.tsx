"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Meta, Sheet } from "@/components/ui";
import { leaveCircleAction } from "@/app/(app)/circles/[id]/lifecycle-actions";

// Page-local copy for this surface's error codes (per the repo's error-copy
// rule — a context-specific map rather than the shared errorCopy()).
const LEAVE_ERROR_COPY: Record<string, string> = {
  last_organiser: "You're the only organiser. Hand the Circle to someone else first, then you can leave.",
  not_a_member: "You're not in this Circle any more.",
  unauthorized: "You've been signed out. Sign in and try again.",
  something_went_wrong: "That didn't go through. Give it another go.",
};

/**
 * "Leave this Circle" — a calm, non-coral affordance any member sees at the
 * foot of the Members tab. Confirm-first: the Sheet spells out that history is
 * kept before anything happens. The only-organiser case is pre-empted here
 * (points the caller at handing over first) and re-enforced server-side.
 */
export function LeaveCircleButton({
  circleId,
  circleName,
  mustTransferFirst,
  isLastMember,
}: {
  circleId: string;
  circleName: string;
  /** True when the caller is the sole organiser with members behind them — leaving is blocked until they transfer. */
  mustTransferFirst: boolean;
  /** True when the caller is the only member left — leaving empties the Circle. */
  isLastMember: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setError(null);
  }

  function confirmLeave() {
    setError(null);
    startTransition(async () => {
      const res = await leaveCircleAction(circleId);
      if (res.ok) {
        setOpen(false);
        router.push("/circles");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-center py-2 text-cu-meta text-ink-muted underline underline-offset-4 transition-cu-state active:opacity-70"
      >
        Leave this Circle
      </button>

      <Sheet open={open} onClose={close} title="Leave this Circle">
        {mustTransferFirst ? (
          <div className="flex flex-col gap-4">
            <Meta as="p">
              You&apos;re the only organiser of {circleName}. Hand the Circle to another member first, then you can
              leave. Your history stays with you either way.
            </Meta>
            <Button variant="quiet" fullWidth onClick={close}>
              Got it
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Meta as="p">
              {isLastMember
                ? `You're the last one in ${circleName}. It stays put, empty, with the door shut. Your matches, Ledger and Tab history stay with you.`
                : `You'll drop off ${circleName}'s roster and any upcoming games. Your matches, Ledger and Tab history stay with you.`}
            </Meta>
            <Button variant="destructiveQuiet" fullWidth onClick={confirmLeave} disabled={pending}>
              {pending ? "Leaving…" : "Leave Circle"}
            </Button>
            <Button variant="quiet" fullWidth onClick={close} disabled={pending}>
              Stay
            </Button>
            {error && <Meta tone="loss">{LEAVE_ERROR_COPY[error] ?? LEAVE_ERROR_COPY.something_went_wrong}</Meta>}
          </div>
        )}
      </Sheet>
    </>
  );
}
