"use client";

import { useFormStatus } from "react-dom";
import { SubmitButton } from "@/components/ui";

/**
 * Submit button for the join-a-Circle form (design/HANDOFF.md screen 2:
 * "success with avatar joining the four-stack"). The actual membership
 * write + redirect happens in the server action this button submits
 * (app/join/[code]/actions.ts, untouched).
 *
 * Rebuilt on SubmitButton (mid-wave addendum: no silent clicks, no
 * hand-rolled spinners): useFormStatus flips `pending` only AFTER the
 * browser's native submission has fired, which also retires the old
 * aria-disabled/pointer-events-none race workaround — a SubmitButton can't
 * cancel its own click. The optimistic arrival ✓ (the four-stack animation)
 * keys off the same form status, so it appears the instant the join is in
 * flight, exactly like before. Must render INSIDE the form (useFormStatus
 * reads the nearest parent form).
 */
export function JoinButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <div className="flex flex-col items-center gap-4">
      <SubmitButton size="lg" fullWidth>
        {label}
      </SubmitButton>
      {pending && (
        <div
          className="w-11 h-11 rounded-full bg-action text-action-contrast flex items-center justify-center font-extrabold animate-cu-arrive"
          aria-hidden
        >
          ✓
        </div>
      )}
    </div>
  );
}
