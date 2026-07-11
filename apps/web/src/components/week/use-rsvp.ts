"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The one RSVP call the wide "Your week" action panels share — the SAME
 * endpoint the phone home's NeedsAnswerCard / FourthCallCard already POST to
 * (this read-surface wave adds no new mutations). "I'm in" / "I can play" send
 * `in`; "Can't" / "Pass" send `out`. On success we refresh the server tree so
 * the grid, panels and shell status lines re-derive from one source.
 */
export function useRsvp(sessionId: string) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answered, setAnswered] = useState<"in" | "out" | null>(null);

  async function respond(action: "in" | "out") {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/sessions/${sessionId}/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error ?? "something_went_wrong");
        return;
      }
      setAnswered(action);
      router.refresh();
    } catch {
      setError("network_error");
    } finally {
      setPending(false);
    }
  }

  return { respond, pending, error, answered };
}
