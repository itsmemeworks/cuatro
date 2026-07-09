"use client";

import { useEffect, useState } from "react";
import { Card, Meta } from "@/components/ui";

/**
 * Layer-B progressive disclosure (see the UX-writing audit §2): the one-time
 * first-encounter explainer for Glass, shown the first time a player lands on
 * the Members tab — the screen where the first Glass number they ever see is
 * somebody else's. A dismissible surface Card (never surface-feature, never
 * coral) with the one-liner and a quiet "Got it". Dismissal persists in
 * localStorage per user, exactly like the Rating Reveal's seenKey.
 */
function seenKey(userId: string): string {
  return `cuatro:glass-intro-seen:${userId}`;
}

export function GlassIntroCard({ userId }: { userId: string }) {
  // Start hidden so the server render and first client paint match; the effect
  // reveals it only when localStorage says it hasn't been dismissed yet.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (window.localStorage.getItem(seenKey(userId)) == null) setVisible(true);
  }, [userId]);

  if (!visible) return null;

  function dismiss() {
    window.localStorage.setItem(seenKey(userId), "1");
    setVisible(false);
  }

  return (
    <Card className="flex flex-col gap-2">
      <p className="text-cu-card-title text-ink">What's a Glass number?</p>
      <p className="text-cu-secondary text-ink-muted">
        It's everyone's padel rating, on a 1.00–7.00 scale — like a Playtomic level, but every point of it is explained
        and nothing's ever a guess. Yours appears once you've played your first three games.
      </p>
      <div className="flex items-center justify-between mt-1">
        <Meta>tap any underlined term to see what it means</Meta>
        <button type="button" onClick={dismiss} className="text-cu-secondary font-semibold text-ink-muted py-1 px-1">
          Got it
        </button>
      </div>
    </Card>
  );
}
