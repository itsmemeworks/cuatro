"use client";

import { useState } from "react";

/**
 * Submit button for the join-a-Circle form (design/HANDOFF.md screen 2:
 * "success with avatar joining the four-stack"). The actual membership
 * write + redirect happens in the server action this button submits
 * (app/join/[code]/actions.ts, untouched) — this is a purely optimistic
 * arrival animation shown the instant the tap registers, since a real
 * `redirect()` inside a server action navigates away before any response
 * could be read back on the client to gate the animation on success.
 *
 * Deliberately `aria-disabled` + `pointer-events-none`, never the real
 * `disabled` attribute: setting `disabled` from this same onClick handler
 * raced the browser's native form submission triggered by that click (a
 * `<button disabled>` cannot submit its form), so the button could flip
 * itself off before the submission it just triggered actually went out —
 * the tap would show "Joining…" forever with no request ever sent. The
 * button still reads as visually/semantically disabled; it just can't
 * cancel its own click.
 */
export function JoinButton({ label }: { label: string }) {
  const [joining, setJoining] = useState(false);

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        type="submit"
        onClick={() => setJoining(true)}
        aria-disabled={joining}
        className="rounded-button inline-flex items-center justify-center w-full min-h-12 px-5 text-[15px] font-extrabold bg-action text-action-contrast transition-cu-state active:opacity-80 aria-disabled:opacity-70 aria-disabled:pointer-events-none"
      >
        {joining ? "Joining…" : label}
      </button>
      {joining && (
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
