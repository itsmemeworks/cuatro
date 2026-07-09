"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Meta } from "@/components/ui";
import { errorCopy } from "@/lib/error-copy";

// Context-specific overrides for the ring-3 claim path; anything not listed
// here falls through to the shared errorCopy() map so no raw code can leak.
const ERROR_COPY: Record<string, string> = {
  already_full: "someone beat you to it, the four's already set",
  session_started: "this game's already kicked off",
  no_fourth_call_invite: "this link isn't valid for this game",
};

/**
 * Ring 3's "I can play" button (app/fc/[token]/page.tsx) — the public,
 * no-notification-required counterpart to FourthCallReceive's claim
 * button. Posts the ring-3 token instead of relying on a fourth_call
 * notification (see /api/fourth-call/[sessionId]/claim's `{ token }`
 * body and claimFourthCallSlot's ring3Token option).
 */
export function FourthCallLinkClaim({ sessionId, token }: { sessionId: string; token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/fourth-call/${sessionId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
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
    <div className="flex flex-col gap-2.5">
      {error && <Meta tone="action">{ERROR_COPY[error] ?? errorCopy(error)}</Meta>}
      <Button size="lg" fullWidth disabled={pending} onClick={claim}>
        {pending ? "…" : "I can play"}
      </Button>
    </div>
  );
}
