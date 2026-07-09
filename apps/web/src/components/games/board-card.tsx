"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, DashedSlot, Fact, Meta, Sheet } from "@/components/ui";
import { CircleEmblem, circleColour } from "./roster";
import { errorCopy } from "@/lib/error-copy";

/**
 * One "Near you" Board card + its ask-to-join surface. This lives on Home,
 * whose one coral action belongs to the NeedsAnswerCard / create-circle CTA —
 * so the ask button here is `strong`, never coral (see the "one coral action
 * per screen" rule in cuatro/CLAUDE.md). Tapping opens a bottom sheet with an
 * optional note; sending posts to /api/knocks/session and flips the card to
 * an "Asked" state with a quiet withdraw.
 */
export interface BoardCardProps {
  sessionId: string;
  /** Stable seed for the Circle's colour + emblem. Optional: callers without the id fall back to seeding off the name. */
  circleId?: string;
  circleName: string;
  venueName: string | null;
  whenLabel: string;
  distanceLabel: string;
  levelLine: string;
  slotsOpen: number;
  initialPending: boolean;
}

export function BoardCard(props: BoardCardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(props.initialPending);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendAsk() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/knocks/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: props.sessionId, message: message.trim() || undefined }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(errorCopy(data?.error));
        return;
      }
      setPending(true);
      setOpen(false);
      setMessage("");
      router.refresh();
    } catch {
      setError(errorCopy("network_error"));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/knocks/session?sessionId=${encodeURIComponent(props.sessionId)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(errorCopy(data?.error));
        return;
      }
      setPending(false);
      router.refresh();
    } catch {
      setError(errorCopy("network_error"));
    } finally {
      setBusy(false);
    }
  }

  const slotsLabel = `${props.slotsOpen} ${props.slotsOpen === 1 ? "spot" : "spots"} open`;
  const colourSeed = props.circleId ?? props.circleName;

  return (
    <>
      <Card padded={false} className="overflow-hidden flex items-stretch">
        <span aria-hidden className="w-1.5 shrink-0" style={{ background: circleColour(colourSeed) }} />
        <div className="flex flex-col gap-2 flex-1 min-w-0 px-3.5 py-3">
        <div className="flex items-start gap-3">
          <CircleEmblem seed={colourSeed} name={props.circleName} px={20} />
          <div className="flex-1 min-w-0">
            <p className="text-cu-card-title text-[15px] truncate">{props.circleName}</p>
            <p className="text-cu-secondary text-ink-muted mt-0.5 truncate">
              {props.whenLabel}
              {props.venueName ? ` · ${props.venueName}` : ""}
            </p>
          </div>
          <Fact size="meta" tone="muted" className="shrink-0 whitespace-nowrap">
            {props.distanceLabel}
          </Fact>
        </div>
        {/* One dashed-coral circle per open spot — the canonical "space waiting for a person". */}
        <div className="flex items-center gap-1.5">
          {Array.from({ length: Math.min(props.slotsOpen, 4) }, (_, i) => (
            <DashedSlot key={`open-${i}`} size="xs" label="" />
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <Meta as="p" className="min-w-0 truncate">
            {props.levelLine} · {slotsLabel}
          </Meta>
          {pending ? (
            <button
              type="button"
              onClick={withdraw}
              disabled={busy}
              className="text-cu-secondary font-bold text-ink-muted whitespace-nowrap disabled:opacity-50"
            >
              Asked · withdraw
            </button>
          ) : (
            <Button variant="strong" onClick={() => setOpen(true)} className="shrink-0">
              Ask to join
            </Button>
          )}
        </div>
        {error && <p className="text-cu-secondary text-loss">{error}</p>}
        </div>
      </Card>

      <Sheet open={open} onClose={() => (busy ? undefined : setOpen(false))} title="Ask to join">
        <div className="flex flex-col gap-3">
          <p className="text-cu-body text-ink">
            {props.circleName} · {props.whenLabel}
            {props.venueName ? ` · ${props.venueName}` : ""}
          </p>
          <p className="text-cu-secondary text-ink-muted">
            The organiser decides. Nothing about you is shared until they say yes.
          </p>
          <label htmlFor={`knock-msg-${props.sessionId}`} className="text-cu-secondary font-semibold text-ink-muted">
            Add a note (optional)
          </label>
          <textarea
            id={`knock-msg-${props.sessionId}`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={280}
            rows={3}
            placeholder="Say hello, or when you're free"
            className="w-full rounded-button px-4 py-3 text-cu-body outline-none bg-ground border border-ink-hairline-2 text-ink resize-none"
          />
          {error && <p className="text-cu-secondary text-loss">{error}</p>}
          <Button variant="strong" size="lg" fullWidth onClick={sendAsk} disabled={busy}>
            {busy ? "Sending…" : "Send ask"}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
