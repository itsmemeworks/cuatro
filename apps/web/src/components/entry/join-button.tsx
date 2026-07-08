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
 */
export function JoinButton({ label }: { label: string }) {
  const [joining, setJoining] = useState(false);

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        type="submit"
        onClick={() => setJoining(true)}
        disabled={joining}
        className="rounded-button inline-flex items-center justify-center w-full min-h-12 px-5 text-[15px] font-extrabold bg-action text-action-contrast transition-cu-state active:opacity-80 disabled:opacity-70"
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
