"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

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

function Avatar({ player, muted }: { player: SessionCardPlayer | null; muted?: boolean }) {
  return (
    <div
      className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold shrink-0"
      style={{
        background: player ? "var(--c4-bg-elevated-2)" : "transparent",
        border: `1px dashed ${muted ? "var(--c4-border)" : "var(--c4-accent)"}`,
        color: player ? "var(--c4-text)" : "var(--c4-text-muted)",
      }}
      title={player?.displayName}
    >
      {player ? initials(player.displayName) : "+"}
    </div>
  );
}

export function SessionCard({ data, viewerUserId }: { data: SessionCardData; viewerUserId: string }) {
  const router = useRouter();
  const [now, setNow] = useState<number>(() => Date.now());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

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
      router.refresh();
    } catch {
      setError("network_error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-4"
      style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
    >
      {data.fourthCallActive && (
        <div
          className="rounded-lg px-3 py-1.5 text-xs font-semibold self-start"
          style={{ background: "var(--c4-warning)", color: "var(--c4-accent-contrast)" }}
        >
          🔔 Fourth Call — slots still open
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--c4-text-muted)" }}>
            {data.circleName}
          </p>
          <p className="font-semibold">
            {data.startsAt.toLocaleString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          {data.venueName && (
            <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
              {data.venueName}
            </p>
          )}
        </div>
        {countdownLabel && (
          <p className="text-xs text-right whitespace-nowrap" style={{ color: "var(--c4-text-muted)" }}>
            {countdownLabel}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        {slots.map((player, i) => (
          <Avatar key={player?.userId ?? `empty-${i}`} player={player} />
        ))}
      </div>

      {data.reserves.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--c4-text-muted)" }}>
            Reserves
          </p>
          <div className="flex flex-col gap-1">
            {data.reserves.map((r, i) => (
              <p key={r.userId} className="text-sm">
                <span style={{ color: "var(--c4-text-muted)" }}>#{i + 1}</span> {r.displayName}
                {r.userId === viewerUserId && <span style={{ color: "var(--c4-accent)" }}> (you)</span>}
              </p>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs" style={{ color: "var(--c4-danger)" }}>
          Couldn&apos;t update your RSVP ({error}). Try again.
        </p>
      )}

      {!sessionStarted && windowOpen && (
        <button
          type="button"
          disabled={pending}
          onClick={(event) => sendRsvp(event, viewerHoldsSlot || viewerReserved ? "out" : "in")}
          className="rounded-xl py-3 text-sm font-semibold"
          style={{
            minHeight: "var(--c4-touch-target)",
            background: viewerHoldsSlot || viewerReserved ? "transparent" : "var(--c4-accent)",
            color: viewerHoldsSlot || viewerReserved ? "var(--c4-danger)" : "var(--c4-accent-contrast)",
            border: viewerHoldsSlot || viewerReserved ? "1px solid var(--c4-danger)" : "none",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {viewerHoldsSlot ? "I'm out" : viewerReserved ? "Leave reserve queue" : "I'm in"}
        </button>
      )}

      {!sessionStarted && !windowOpen && (
        <p className="text-xs text-center" style={{ color: "var(--c4-text-muted)" }}>
          RSVPs open {formatCountdown(windowOpensMs - now)} from now
        </p>
      )}
    </div>
  );
}
