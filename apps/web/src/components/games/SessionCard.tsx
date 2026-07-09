"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSessionLive } from "@/lib/realtime/hooks";
import { Avatar, Button, Card, Chip, DashedSlot, Fact, Meta } from "@/components/ui";
import { CircleEmblem } from "./roster";
import { errorCopy } from "@/lib/error-copy";

export type SessionCardPlayer = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

export type SessionCardData = {
  sessionId: string;
  circleId: string;
  circleName: string;
  venueName: string | null;
  /** UTC instant. */
  startsAt: Date;
  slots: number;
  confirmed: SessionCardPlayer[];
  reserves: SessionCardPlayer[];
  viewerStatus: "in" | "reserve" | "out" | null;
  /** UTC instant the RSVP window opens. */
  rsvpWindowOpensAt: Date;
  fourthCallActive: boolean;
};

function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "now";
  const totalMinutes = Math.floor(msRemaining / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * The signature RSVP moment (Directions turn 8a): the tapped slot's avatar
 * springs in (`animate-cu-arrive`, 380ms overshoot) with one pulse ring,
 * then settles — no continuous pulse once it has landed. Fires for the
 * viewer's own tap *and* for anyone else's slot filling via realtime (the
 * brief calls this out explicitly), by diffing `confirmed` against the
 * previous render rather than only reacting to the local button press.
 */
function useArrivals(confirmed: SessionCardPlayer[]) {
  const [arriving, setArriving] = useState<Set<string>>(new Set());
  const prevIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    const currentIds = new Set(confirmed.map((p) => p.userId));
    if (prevIds.current) {
      const fresh = [...currentIds].filter((id) => !prevIds.current!.has(id));
      if (fresh.length > 0) {
        setArriving(new Set(fresh));
        const timer = setTimeout(() => setArriving(new Set()), 700);
        prevIds.current = currentIds;
        return () => clearTimeout(timer);
      }
    }
    prevIds.current = currentIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed.map((p) => p.userId).join(",")]);

  return arriving;
}

function SlotTile({
  player,
  fourthCallOpen,
  arriving,
}: {
  player: SessionCardPlayer | null;
  fourthCallOpen: boolean;
  arriving: boolean;
}) {
  return (
    <div
      className={`flex-1 min-w-0 rounded-button border border-ink-hairline-2 bg-surface px-1 py-2.5 flex flex-col items-center gap-1.5 transition-cu-state ${arriving ? "animate-cu-pulse-once" : ""}`}
    >
      {player ? (
        <Avatar
          src={player.avatarUrl}
          name={player.displayName}
          size="md"
          className={arriving ? "animate-cu-arrive" : ""}
        />
      ) : (
        <DashedSlot pulse={fourthCallOpen} />
      )}
      <span className="text-[10px] font-semibold text-ink truncate max-w-full">
        {player ? player.displayName.split(" ")[0] : "open"}
      </span>
    </div>
  );
}

export function SessionCard({
  data,
  viewerUserId,
  onPromoted,
}: {
  data: SessionCardData;
  viewerUserId: string;
  /** Called when this RSVP action auto-promoted a reserve — a toast is the caller's business, not this component's (SessionCard also renders on pages with no `<ToastProvider>` ancestor, e.g. Home). */
  onPromoted?: () => void;
}) {
  const router = useRouter();
  const [now, setNow] = useState<number>(() => Date.now());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // No handler — the default is router.refresh(), which re-renders this
  // card (and everything else on the page) with fresh RSVP/fourth-call
  // data whenever this session changes, wherever this card is mounted
  // (home, /games, a circle's feed, the session detail page).
  useSessionLive(data.sessionId);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const arriving = useArrivals(data.confirmed);

  const startsAtMs = data.startsAt.getTime();
  const windowOpensMs = data.rsvpWindowOpensAt.getTime();
  const windowOpen = now >= windowOpensMs && now < startsAtMs;
  const sessionStarted = now >= startsAtMs;

  const countdownLabel = useMemo(() => {
    if (sessionStarted) return null;
    if (!windowOpen) return `RSVP opens in ${formatCountdown(windowOpensMs - now)}`;
    return `Kicks off in ${formatCountdown(startsAtMs - now)}`;
  }, [now, windowOpen, sessionStarted, windowOpensMs, startsAtMs]);

  const slots = Array.from({ length: data.slots }, (_, i) => data.confirmed[i] ?? null);
  const viewerHoldsSlot = data.viewerStatus === "in";
  const viewerReserved = data.viewerStatus === "reserve";

  async function sendRsvp(event: React.MouseEvent, action: "in" | "out") {
    // SessionCard is also used inline inside a Link (the /games list links
    // each card through to its detail page) — stop the tap from bubbling
    // into a navigation.
    event.preventDefault();
    event.stopPropagation();
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/sessions/${data.sessionId}/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error ?? "something_went_wrong");
        return;
      }
      if (body.promotedUserId) onPromoted?.();
      router.refresh();
    } catch {
      setError("network_error");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      {data.fourthCallActive && (
        <Chip tone="streak" className="self-start">
          🔔 Fourth Call, slots still open
        </Chip>
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CircleEmblem seed={data.circleId} name={data.circleName} px={18} />
            <Meta as="p">{data.circleName}</Meta>
          </div>
          <p className="text-cu-card-title text-ink mt-0.5">
            {data.startsAt.toLocaleString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          {data.venueName && <Meta as="p">{data.venueName}</Meta>}
        </div>
        {countdownLabel && (
          <Meta as="p" className="text-right whitespace-nowrap">
            {countdownLabel}
          </Meta>
        )}
      </div>

      <div className="flex gap-2">
        {slots.map((player, i) => (
          <SlotTile
            key={player?.userId ?? `empty-${i}`}
            player={player}
            fourthCallOpen={data.fourthCallActive}
            arriving={!!player && arriving.has(player.userId)}
          />
        ))}
      </div>

      {data.reserves.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Meta as="p" className="uppercase tracking-[0.12em]">
            Reserve queue
          </Meta>
          <div className="flex flex-col gap-1">
            {data.reserves.map((r, i) => (
              <p key={r.userId} className="text-cu-body text-ink">
                <Fact as="span" size="sm" tone="muted">
                  #{i + 1}
                </Fact>{" "}
                {r.displayName}
                {r.userId === viewerUserId && <Fact as="span" size="sm" tone="action"> (you)</Fact>}
              </p>
            ))}
          </div>
          <Meta as="p">if anyone drops, they&apos;re in automatically, everyone gets told</Meta>
        </div>
      )}

      {error && <Meta tone="action">{errorCopy(error)}</Meta>}

      {!sessionStarted && windowOpen && (
        <div className="flex gap-2">
          <Button
            size="lg"
            className="flex-[2]"
            variant={viewerHoldsSlot || viewerReserved ? "strong" : "primary"}
            style={viewerHoldsSlot ? { background: "var(--color-win)", color: "var(--color-action-contrast)" } : undefined}
            disabled={pending}
            onClick={(event) => sendRsvp(event, viewerHoldsSlot || viewerReserved ? "out" : "in")}
          >
            {viewerHoldsSlot ? "You're in ✓" : viewerReserved ? "Reserved ✓" : "I'm in"}
          </Button>
          {(viewerHoldsSlot || viewerReserved) && (
            <Button
              size="lg"
              variant="destructiveQuiet"
              className="flex-1"
              disabled={pending}
              onClick={(event) => sendRsvp(event, "out")}
            >
              Can&apos;t
            </Button>
          )}
        </div>
      )}

      {!sessionStarted && !windowOpen && (
        <Meta as="p" className="text-center">
          RSVPs open {formatCountdown(windowOpensMs - now)} from now
        </Meta>
      )}
    </Card>
  );
}
