"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, DashedSlot, Fact, InfoTerm, Meta, Sheet } from "@/components/ui";
import { CircleEmblem, RosterList, RosterNames, circleColour, type RosterPlayer } from "./roster";
import { CirclePreviewSheet } from "@/components/discover/circle-preview-sheet";
import { errorCopy } from "@/lib/error-copy";

/**
 * One "Near you" Board card + its ask-to-join surface. This lives on Home,
 * whose one coral action belongs to the NeedsAnswerCard / create-circle CTA —
 * so the ask button here is `strong`, never coral (see the "one coral action
 * per screen" rule in cuatro/CLAUDE.md). Tapping opens a bottom sheet with an
 * optional note; sending posts to /api/knocks/session and flips the card to
 * an "Asked" state with a quiet withdraw.
 *
 * Every Board game is from a Circle the viewer is NOT in (server/discovery.ts
 * scopes to non-member Circles), so the circle emblem + name open the Circle's
 * PUBLIC preview sheet (Pete, 2026-07-11: "I should be able to click circles
 * to view them before asking to join"), and the tile itself links to the game
 * detail (law 7b: every game tile links to its detail page — game reads are
 * ungated). The inline controls sit above the stretched link
 * (position:relative), so nothing loses its click.
 */
export interface BoardCardProps {
  sessionId: string;
  /** Stable seed for the Circle's colour + emblem. Optional: callers without the id fall back to seeding off the name. */
  circleId?: string;
  circleName: string;
  /** The Circle's explicitly-chosen colour (palette hex) / emblem; null falls back to the deterministic seed colour + name initials. */
  circleColour?: string | null;
  circleEmblem?: string | null;
  venueName: string | null;
  whenLabel: string;
  distanceLabel: string;
  levelLine: string;
  slotsOpen: number;
  /** Who's already confirmed — so the viewer can see who they'd be playing with before asking. */
  confirmed?: RosterPlayer[];
  initialPending: boolean;
}

export function BoardCard(props: BoardCardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
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
  const confirmed = props.confirmed ?? [];

  return (
    <>
      <Card padded={false} className="relative overflow-hidden flex items-stretch transition-cu-state hover:bg-ink-hairline-1">
        {/* The tile navigates to the game detail (law 7b) — reads are ungated,
            so an outsider can look before they ask. */}
        <Link
          href={`/games/${props.sessionId}`}
          aria-label={`${props.circleName}, ${props.whenLabel}`}
          className="absolute inset-0"
        />
        <span aria-hidden className="w-1.5 shrink-0" style={{ background: circleColour(colourSeed, props.circleColour) }} />
        <div className="flex flex-col gap-2 flex-1 min-w-0 px-3.5 py-3">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            {/* Circle flag + name open the Circle's public preview (non-member
                by construction). Falls back to plain text without a circleId. */}
            {props.circleId ? (
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                aria-label={`Have a look at ${props.circleName}`}
                className="relative flex items-center gap-3 max-w-full min-w-0 text-left cursor-pointer group"
              >
                <CircleEmblem seed={colourSeed} name={props.circleName} emblem={props.circleEmblem} colour={props.circleColour} px={20} />
                <span className="text-cu-card-title text-[15px] truncate transition-cu-state group-hover:underline">
                  {props.circleName}
                </span>
              </button>
            ) : (
              <span className="flex items-center gap-3 min-w-0">
                <CircleEmblem seed={colourSeed} name={props.circleName} emblem={props.circleEmblem} colour={props.circleColour} px={20} />
                <span className="text-cu-card-title text-[15px] truncate">{props.circleName}</span>
              </span>
            )}
            <p className="text-cu-secondary text-ink-muted mt-0.5 truncate pl-8">
              {props.whenLabel}
              {props.venueName ? ` · ${props.venueName}` : ""}
            </p>
          </div>
          <Fact size="meta" tone="muted" className="relative shrink-0 whitespace-nowrap">
            <InfoTerm term="patch" label={props.distanceLabel} />
          </Fact>
        </div>
        {/* One dashed-coral circle per open spot — the canonical "space waiting for a person". */}
        <div className="flex items-center gap-1.5">
          {Array.from({ length: Math.min(props.slotsOpen, 4) }, (_, i) => (
            <DashedSlot key={`open-${i}`} size="xs" label="" />
          ))}
        </div>
        {confirmed.length > 0 && (
          <p className="text-cu-secondary text-ink-muted truncate">
            <RosterNames players={confirmed} showGlass prefix="with " />
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <Meta as="p" className="min-w-0 truncate">
            {props.levelLine} · {slotsLabel}
          </Meta>
          {pending ? (
            <button
              type="button"
              onClick={withdraw}
              disabled={busy}
              className="relative text-cu-secondary cursor-pointer font-bold text-ink-muted whitespace-nowrap transition-cu-state hover:text-ink disabled:opacity-50"
            >
              Asked · withdraw
            </button>
          ) : (
            <Button variant="strong" onClick={() => setOpen(true)} className="relative shrink-0">
              Ask to join
            </Button>
          )}
        </div>
        {error && <p className="text-cu-secondary text-loss">{error}</p>}
        </div>
      </Card>

      {props.circleId && (
        <CirclePreviewSheet
          circleId={props.circleId}
          circleName={props.circleName}
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      <Sheet open={open} onClose={() => (busy ? undefined : setOpen(false))} title="Ask to join">
        <div className="flex flex-col gap-3">
          <p className="text-cu-body text-ink">
            {props.circleName} · {props.whenLabel}
            {props.venueName ? ` · ${props.venueName}` : ""}
          </p>
          {confirmed.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-button bg-ink-hairline-1 px-3.5 py-3">
              <Meta as="p" className="uppercase tracking-[0.12em]">
                Who&apos;s in
              </Meta>
              <RosterList players={confirmed} />
            </div>
          )}
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
