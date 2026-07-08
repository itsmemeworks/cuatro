"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Meta } from "@/components/ui";

export type RingState = "pending" | "sent" | "done";

/**
 * Fourth Call — send (organiser view, prototype screen 6). Ring 1 + ring 2
 * status come from the server (they're driven by real `fourth_call`
 * notifications — see the page component). Ring 3 ("anyone with the link")
 * has no backend in v0: `server/fourth-call.ts`'s header explicitly scopes
 * an open/public claim link as "v1, out of scope" — claiming always
 * requires holding a `fourth_call` notification. It renders inert here
 * rather than pretending to work.
 */
export function FourthCallSend({
  sessionId,
  ring1Label,
  ring2State,
  ring2Label,
  canEscalate,
}: {
  sessionId: string;
  ring1Label: string;
  ring2State: RingState;
  ring2Label: string;
  canEscalate: boolean;
}) {
  const router = useRouter();
  const [escalating, setEscalating] = useState(false);

  async function escalate() {
    setEscalating(true);
    try {
      await fetch(`/api/fourth-call/${sessionId}/escalate`, { method: "POST" });
      router.refresh();
    } finally {
      setEscalating(false);
    }
  }

  return (
    <div className="rounded-card bg-surface border border-ink-hairline-1 px-4 divide-y divide-ink-hairline-1">
      <div className="flex items-center gap-3 py-3.5">
        <span className="w-6 h-6 rounded-full bg-win flex items-center justify-center text-action-contrast font-bold text-[11px] shrink-0">
          ✓
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-cu-body font-bold text-ink">The Circle first</p>
          <Meta as="p" className="mt-0.5">
            {ring1Label}
          </Meta>
        </div>
      </div>

      <div className="flex items-center gap-3 py-3.5">
        <span
          className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 ${
            ring2State === "pending" ? "border border-ink-hairline-4 text-ink-muted" : "bg-win text-action-contrast"
          }`}
        >
          {ring2State === "pending" ? "2" : "✓"}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-cu-body font-bold text-ink">
            Extended network{" "}
            {ring2State === "sent" && <span className="text-action-strong font-extrabold">· live</span>}
          </p>
          <Meta as="p" className="mt-0.5">
            {ring2Label}
          </Meta>
        </div>
        {canEscalate && (
          <Button variant="quiet" size="default" disabled={escalating} onClick={escalate}>
            {escalating ? "…" : "Escalate now"}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3 py-3.5">
        <span className="w-6 h-6 rounded-full border border-ink-hairline-4 text-ink-muted flex items-center justify-center font-bold text-[11px] shrink-0">
          3
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-cu-body font-bold text-ink-muted">Anyone with the link</p>
          <Meta as="p" className="mt-0.5">
            not available yet — v0 has no public claim link
          </Meta>
        </div>
        <span className="rounded-chip border border-ink-hairline-3 text-ink-muted font-bold text-[10.5px] px-3 py-1.5 opacity-50">
          Copy ↗
        </span>
      </div>
    </div>
  );
}
