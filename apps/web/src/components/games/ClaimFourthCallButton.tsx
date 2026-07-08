"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** The one-tap "I can play" claim on /games/[sessionId], for a viewer holding an unactioned fourth_call notification for this session (see server/fourth-call.ts's hasFourthCallInvite). Posts to /api/fourth-call/[sessionId]/claim, which enforces the actual gating (still-open slot, still upcoming, real invite) server-side. */
export function ClaimFourthCallButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/fourth-call/${sessionId}/claim`, { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error ?? "something_went_wrong");
        return;
      }
      router.refresh();
    } catch {
      setError("network_error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={claim}
        className="rounded-xl py-3.5 text-center text-sm font-semibold"
        style={{
          minHeight: "var(--c4-touch-target)",
          background: "var(--c4-accent)",
          color: "var(--c4-accent-contrast)",
          opacity: pending ? 0.6 : 1,
        }}
      >
        I can play
      </button>
      {error && (
        <p className="text-xs text-center" style={{ color: "var(--c4-danger)" }}>
          Couldn&apos;t claim the slot ({error}). Try again.
        </p>
      )}
    </div>
  );
}
