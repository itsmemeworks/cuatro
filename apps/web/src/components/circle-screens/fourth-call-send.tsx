"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Meta } from "@/components/ui";

export type RingState = "pending" | "sent" | "done";

/**
 * Fourth Call — send (organiser view, prototype screen 6). Ring 1 + ring 2
 * status come from the server (they're driven by real `fourth_call`
 * notifications — see the page component). Ring 3 ("anyone with the link")
 * mints a signed public claim link on tap (see server/fourth-call.ts's
 * getRing3ClaimLink) and copies/shares its full URL — no account or circle
 * membership needed to view it, signing in only gates actually claiming
 * the slot (app/fc/[token]/page.tsx).
 */
export function FourthCallSend({
  sessionId,
  ring1State,
  ring1Label,
  ring2State,
  ring2Label,
  canEscalate,
  ring3Available,
}: {
  sessionId: string;
  ring1State: RingState;
  ring1Label: string;
  ring2State: RingState;
  ring2Label: string;
  canEscalate: boolean;
  /** Whether ring 3's link can be generated right now (the session hasn't started and the four isn't already full). */
  ring3Available: boolean;
}) {
  const router = useRouter();
  const [escalating, setEscalating] = useState(false);
  const [ring3Pending, setRing3Pending] = useState(false);
  const [ring3Copied, setRing3Copied] = useState(false);
  const [ring3Error, setRing3Error] = useState(false);

  async function escalate() {
    setEscalating(true);
    try {
      await fetch(`/api/fourth-call/${sessionId}/escalate`, { method: "POST" });
      router.refresh();
    } finally {
      setEscalating(false);
    }
  }

  async function copyRing3Link() {
    setRing3Pending(true);
    setRing3Error(false);
    try {
      const res = await fetch(`/api/fourth-call/${sessionId}/escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: 3 }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setRing3Error(true);
        return;
      }
      const url = `${window.location.origin}${body.path}`;

      if (navigator.share) {
        try {
          await navigator.share({ title: "Fourth Call — anyone free?", url });
          return;
        } catch {
          // Cancelled share sheet — fall through to copy.
        }
      }
      await navigator.clipboard.writeText(url);
      setRing3Copied(true);
      setTimeout(() => setRing3Copied(false), 2000);
    } catch {
      setRing3Error(true);
    } finally {
      setRing3Pending(false);
    }
  }

  return (
    <div className="rounded-card bg-surface border border-ink-hairline-1 px-4 divide-y divide-ink-hairline-1">
      <div className="flex items-center gap-3 py-3.5">
        <span
          className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 ${
            ring1State === "pending" ? "border border-ink-hairline-4 text-ink-muted" : "bg-win text-action-contrast"
          }`}
        >
          {ring1State === "pending" ? "1" : "✓"}
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
        <span
          className={`w-6 h-6 rounded-full border flex items-center justify-center font-bold text-[11px] shrink-0 ${
            ring3Available ? "border-ink-hairline-4 text-ink" : "border-ink-hairline-4 text-ink-muted"
          }`}
        >
          3
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-cu-body font-bold ${ring3Available ? "text-ink" : "text-ink-muted"}`}>Anyone with the link</p>
          <Meta as="p" className="mt-0.5">
            {ring3Available
              ? "share it anywhere — no account needed to see it, signing in is only for claiming"
              : "not needed — the four's full, or this game's already started"}
          </Meta>
          {ring3Error && (
            <Meta tone="action" as="p" className="mt-0.5">
              couldn&apos;t generate the link — try again
            </Meta>
          )}
        </div>
        <button
          type="button"
          onClick={copyRing3Link}
          disabled={!ring3Available || ring3Pending}
          className="rounded-chip border border-ink-hairline-3 text-ink font-bold text-[10.5px] px-3 py-1.5 shrink-0 transition-cu-state active:opacity-80 disabled:opacity-50"
        >
          {ring3Copied ? "Copied ✓" : ring3Pending ? "…" : "Copy ↗"}
        </button>
      </div>
    </div>
  );
}
