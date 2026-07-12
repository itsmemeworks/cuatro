"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Meta, Sheet } from "@/components/ui";
import { errorCopy } from "@/lib/error-copy";

/**
 * The outsider's ask affordance on a game detail page: a non-member who found
 * an open game (Discover, The Board, a shared link) asks their way in through
 * the SAME endpoint every Board card uses (/api/knocks/session) — optional
 * note, "Asked · withdraw" once pending. `strong` variant, matching the Board
 * card precedent (the ask is the outsider page's main act, but coral stays
 * reserved — the back-link already reads coral).
 */
export function AskToJoinCard({
  sessionId,
  gameLabel,
  slotsOpen,
  initialPending,
}: {
  sessionId: string;
  /** "Sunday Lot · Thu 20:00 · Padel Social Club" — the sheet's what-you're-asking-into line. */
  gameLabel: string;
  slotsOpen: number;
  initialPending: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(initialPending);
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
        body: JSON.stringify({ sessionId, message: message.trim() || undefined }),
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
      const res = await fetch(`/api/knocks/session?sessionId=${encodeURIComponent(sessionId)}`, { method: "DELETE" });
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

  const slotWord = slotsOpen === 1 ? "one spot open" : `${slotsOpen} spots open`;

  return (
    <>
      <div className="rounded-card bg-surface border border-ink-hairline-1 px-4 py-4 flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <Meta as="p">{slotWord}</Meta>
          {pending && <Meta as="p">asked, waiting on the organiser</Meta>}
        </div>
        {pending ? (
          <button
            type="button"
            onClick={withdraw}
            disabled={busy}
            className="cursor-pointer rounded-button border border-ink-hairline-4 text-ink-muted font-bold text-[13px] text-center py-3 transition-cu-state hover:bg-ink-hairline-1 hover:text-ink active:opacity-80 disabled:opacity-50"
          >
            Withdraw my ask
          </button>
        ) : (
          <Button variant="strong" size="lg" fullWidth onClick={() => setOpen(true)}>
            Ask to join
          </Button>
        )}
        {error && <Meta tone="loss">{error}</Meta>}
      </div>

      <Sheet open={open} onClose={() => (busy ? undefined : setOpen(false))} title="Ask to join">
        <div className="flex flex-col gap-3">
          <p className="text-cu-body text-ink">{gameLabel}</p>
          <p className="text-cu-secondary text-ink-muted">
            The organiser decides. Nothing about you is shared until they say yes.
          </p>
          <label htmlFor={`game-knock-${sessionId}`} className="text-cu-secondary font-semibold text-ink-muted">
            Add a note (optional)
          </label>
          <textarea
            id={`game-knock-${sessionId}`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={280}
            rows={3}
            placeholder="Say hello, or when you're free"
            className="w-full rounded-button px-4 py-3 text-cu-body outline-none bg-ground border border-ink-hairline-2 text-ink resize-none"
          />
          {error && <p className="text-cu-secondary text-loss">{error}</p>}
          <Button variant="strong" size="lg" fullWidth onClick={sendAsk} pending={busy}>
            Send ask
          </Button>
        </div>
      </Sheet>
    </>
  );
}
