"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, Button, Card, DashedSlot, Fact, Meta, PendingSpinner, Sheet } from "@/components/ui";
import { errorCopy } from "@/lib/error-copy";
import type { DiscoverConfirmedPlayer, DiscoverGame } from "@/server/discover-page";

/**
 * One "public game this week" card on Discover. It is a public game with an
 * open slot near the viewer's patch — the same thing The Board shows on phone
 * Home — so the ask fires the SAME endpoint the phone Board card uses
 * (/api/knocks/session); this wave adds no new mutation. What is new is the
 * desktop treatment and the level-band colouring:
 *
 *  - in the viewer's Glass band  → the open slots are the canonical dashed
 *    CORAL circles ("a space waiting for a person"), the date reads coral, and
 *    the one coral action on this panel is "Claim the spot";
 *  - outside the band            → the open slots are dashed GREY with an
 *    "outside your band" caption, the date is muted, and the action drops to
 *    the quiet outline "I can play" (still a real ask, just not this panel's
 *    coral). See DESIGN-AUDIT + WEB-SHELL-SPEC design laws (one coral per panel).
 */

function whenLabel(startsAtMs: number): string {
  return new Date(startsAtMs).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The grey (out-of-band) counterpart to the coral DashedSlot — same shape, muted. A grey dashed circle is NOT the coral "space waiting" mark, so it does not collide with that convention. */
function GreyDashedSlot({ overlap = false }: { overlap?: boolean }) {
  return (
    <span
      aria-hidden
      className="rounded-full flex-none border-2 border-dashed border-ink-hairline-4 text-ink-muted font-extrabold flex items-center justify-center"
      style={{ width: 34, height: 34, marginLeft: overlap ? -11 : undefined, fontSize: 13 }}
    />
  );
}

function SlotRow({
  confirmed,
  slotsOpen,
  inBand,
}: {
  confirmed: DiscoverConfirmedPlayer[];
  slotsOpen: number;
  inBand: boolean;
}) {
  const shownFaces = confirmed.slice(0, 4);
  const openCount = Math.min(slotsOpen, 4);
  return (
    <div className="flex items-center">
      {shownFaces.map((p, i) => (
        <Avatar key={p.userId} src={p.avatarUrl} name={p.displayName} size="md" ring="surface" overlap={i > 0} />
      ))}
      {Array.from({ length: openCount }, (_, i) =>
        inBand ? (
          <DashedSlot key={`open-${i}`} size="md" label="" overlap={shownFaces.length > 0 || i > 0} />
        ) : (
          <GreyDashedSlot key={`open-${i}`} overlap={shownFaces.length > 0 || i > 0} />
        ),
      )}
    </div>
  );
}

export function DiscoverGameCard({ game }: { game: DiscoverGame }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(game.viewerHasPendingKnock);
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
        body: JSON.stringify({ sessionId: game.sessionId, message: message.trim() || undefined }),
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
      const res = await fetch(`/api/knocks/session?sessionId=${encodeURIComponent(game.sessionId)}`, {
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

  const title = game.venueName ?? game.circleName;
  const slotWord = game.slotsOpen === 1 ? "one dashed slot" : `${game.slotsOpen} dashed slots`;
  const caption = game.inBand
    ? `${game.confirmedCount} of ${game.slots} · ${slotWord}`
    : `${game.confirmedCount} of ${game.slots} · outside your band`;

  return (
    <>
      {/* The tile navigates (law 7b: every game tile links to its detail page,
          QA1): a stretched Link overlays the card, and the inline ask/withdraw
          buttons sit above it (position:relative), so both keep working. The
          session page has no membership gate on reads, so a Discover viewer
          can look before they ask. */}
      <Card className="relative flex flex-col gap-2 transition-cu-state hover:bg-ink-hairline-1">
        <Link
          href={`/games/${game.sessionId}`}
          aria-label={`${title}, ${whenLabel(game.startsAtMs)}`}
          className="absolute inset-0 rounded-card"
        />
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] font-extrabold uppercase tracking-[0.1em] ${game.inBand ? "text-action" : "text-ink-muted"}`}
          >
            {whenLabel(game.startsAtMs)}
          </span>
          <span className="flex-1" />
          <Fact size="meta" tone="muted" className="whitespace-nowrap">
            {game.distanceLabel}
          </Fact>
        </div>

        <p className="text-cu-card-title text-[17px] leading-tight text-ink truncate">{title}</p>
        <Fact as="p" size="meta" tone="muted" className="truncate">
          hosted by {game.circleName} · {game.levelLine}
        </Fact>

        <div className="flex items-center gap-3 mt-1">
          <SlotRow confirmed={game.confirmed} slotsOpen={game.slotsOpen} inBand={game.inBand} />
          {/* Wraps rather than truncates: at 430px the mono caption was
              clipping mid-word ("one d…", QA1). */}
          <Meta as="span" className="flex-1 min-w-0 break-words">
            {caption}
          </Meta>
          {pending ? (
            <button
              type="button"
              onClick={withdraw}
              disabled={busy}
              className="relative text-cu-secondary cursor-pointer font-bold text-ink-muted whitespace-nowrap transition-cu-state hover:text-ink disabled:opacity-50"
            >
              {busy ? <PendingSpinner /> : null} Asked · withdraw
            </button>
          ) : (
            <Button variant={game.inBand ? "primary" : "quiet"} onClick={() => setOpen(true)} className="relative shrink-0 whitespace-nowrap">
              {game.inBand ? "Claim the spot" : "I can play"}
            </Button>
          )}
        </div>
        {error && <Meta tone="loss">{error}</Meta>}
      </Card>

      <Sheet open={open} onClose={() => (busy ? undefined : setOpen(false))} title="Ask to join">
        <div className="flex flex-col gap-3">
          <p className="text-cu-body text-ink">
            {title} · {whenLabel(game.startsAtMs)}
          </p>
          <p className="text-cu-secondary text-ink-muted">
            The organiser decides. Nothing about you is shared until they say yes.
          </p>
          <label htmlFor={`discover-knock-${game.sessionId}`} className="text-cu-secondary font-semibold text-ink-muted">
            Add a note (optional)
          </label>
          <textarea
            id={`discover-knock-${game.sessionId}`}
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
