"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-fetches the server render when the tab becomes visible or regains focus.
 * Public invite links (/fc/[token], /join/[code]) get opened from WhatsApp and
 * left sitting in a tab — by the time the visitor comes back, the game may
 * have filled (QA6's stale "I can play" CTA). This keeps the honest state
 * honest without a websocket: these pages are logged-out, so they can't join
 * the authed realtime channels.
 *
 * Renders nothing. Throttled so focus flapping can't hammer the server.
 */
export function RefreshOnFocus({ minIntervalMs = 5_000 }: { minIntervalMs?: number }) {
  const router = useRouter();
  const lastRefreshAt = useRef(0);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefreshAt.current < minIntervalMs) return;
      lastRefreshAt.current = now;
      router.refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, minIntervalMs]);

  return null;
}
