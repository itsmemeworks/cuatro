"use client";

import { useState } from "react";

/**
 * Optimistic 👏 Respect toggle against POST /api/matches/[id]/respect.
 * Shared by ResultPost and PlacementRevealPost — both key off the same
 * match_reactions row (a placement reveal's `matchId` is the match that
 * triggered it, see server/feed.ts's PlacementRevealView), so this is the
 * one place the optimistic-update-then-reconcile dance lives.
 */
export function useRespectToggle(matchId: string, initialRespected: boolean, initialCount: number) {
  const [respected, setRespected] = useState(initialRespected);
  const [count, setCount] = useState(initialCount);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (pending) return;
    setPending(true);
    const prevRespected = respected;
    const prevCount = count;
    setRespected(!prevRespected);
    setCount(prevCount + (prevRespected ? -1 : 1));
    try {
      const res = await fetch(`/api/matches/${matchId}/respect`, { method: "POST" });
      const body = await res.json();
      if (res.ok && body.ok) {
        setRespected(body.respected);
        setCount(body.count);
      } else {
        setRespected(prevRespected);
        setCount(prevCount);
      }
    } catch {
      setRespected(prevRespected);
      setCount(prevCount);
    } finally {
      setPending(false);
    }
  }

  return { respected, count, pending, toggle };
}
