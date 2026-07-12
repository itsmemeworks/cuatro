"use client";

/**
 * The match page's liveness (replaces a bare LiveRefresh there): the
 * realtime fast path — the same pooled session-topic subscription — PLUS a
 * bounded poll while the match is still awaiting confirmation.
 *
 * Why the poll exists (QA5 finding 4, the intermittent post-seal stale
 * "Confirm result" page): the seal signal is best-effort twice over.
 * (1) The server-side broadcast is fire-and-forget by design —
 * lib/realtime/broadcast.ts swallows failures, whose documented worst case
 * is "a client staying stale until its next visit/poll"; this page had no
 * poll. (2) A broadcast that lands while this client's channel is still
 * JOINING (cold Realtime tenant — seconds on a just-woken project) is
 * silently lost: the shared-channel pool only synthesizes catch-up events
 * on RE-subscribes after a drop, never on the first join. Either gap left a
 * live "Confirm result" button on screen long after the server had sealed.
 *
 * The poll only runs while `pending` is true and the tab is visible, so a
 * sealed/disputed/void match costs nothing: the refresh that reveals the
 * seal re-renders this component with pending=false and the interval is
 * torn down. Focus/visibilitychange refreshes cover a backgrounded tab the
 * moment it returns, without burning polls while hidden.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSessionLive } from "@/lib/realtime/hooks";

const PENDING_POLL_MS = 4000;

export function MatchLive({ sessionId, pending }: { sessionId: string; pending: boolean }) {
  const router = useRouter();
  useSessionLive(sessionId, () => router.refresh());

  useEffect(() => {
    if (!pending) return;
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const interval = setInterval(refreshIfVisible, PENDING_POLL_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("focus", refreshIfVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("focus", refreshIfVisible);
    };
    // `router` is stable across renders (Next's useRouter identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  return null;
}
