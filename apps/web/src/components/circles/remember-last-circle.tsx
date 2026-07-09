"use client";

import { useEffect } from "react";

export const LAST_CIRCLE_STORAGE_KEY = "cuatro:lastCircleId";

/**
 * Records the Circle currently being viewed so the Circle and Tab nav tabs
 * (see (app)/feed/page.tsx, (app)/tab/page.tsx, circle-tab-redirect.tsx) can
 * resolve back to "the Circle you were just looking at" instead of always
 * defaulting to the first one. Fire-and-forget, renders nothing.
 */
export function RememberLastCircle({ circleId }: { circleId: string }) {
  useEffect(() => {
    try {
      window.localStorage.setItem(LAST_CIRCLE_STORAGE_KEY, circleId);
    } catch {
      // Storage can throw in locked-down browser contexts (private-mode
      // quota, etc.) — losing "remember my last Circle" is harmless.
    }
  }, [circleId]);
  return null;
}
