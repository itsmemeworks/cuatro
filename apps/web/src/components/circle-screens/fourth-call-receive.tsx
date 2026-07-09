"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AvatarStack, Button, Fact, Meta } from "@/components/ui";
import { PresenceTracker } from "@/components/realtime/PresenceTracker";
import type { SessionCardPlayer } from "@/components/games/SessionCard";

function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "now";
  const totalMinutes = Math.floor(msRemaining / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Fourth Call — receive (prototype screen 6, receive variant): full-screen
 * invite with faces, a level-match line, one coral "I can play" and a quiet
 * "Pass". Restyles the old plain ClaimFourthCallButton with the fuller
 * treatment the brief calls for, reusing the same claim endpoint.
 *
 * "Expires in" uses the session's kick-off time — claimFourthCallSlot()
 * already rejects a claim once the session has started, so that's the real
 * expiry, not a fabricated countdown.
 */
export function FourthCallReceive({
  sessionId,
  circleName,
  whenLabel,
  venueLabel,
  confirmed,
  levelMatchLabel,
  expiresAt,
  passNotificationId,
  viewerId,
}: {
  sessionId: string;
  circleName: string;
  whenLabel: string;
  venueLabel: string | null;
  confirmed: SessionCardPlayer[];
  /** e.g. "their level 4.20–4.91 · yours 4.62" — null if there's not enough rating data to say. */
  levelMatchLabel: string | null;
  expiresAt: Date;
  /** The fourth_call notification backing this invite, for "Pass" — null if it couldn't be found (still lets the viewer claim). */
  passNotificationId: string | null;
  /** The signed-in viewer's user id, so the organiser's live "N viewing…" count (fourth-call-send.tsx) can exclude a specific id — see lib/realtime/presence.ts. */
  viewerId?: string | null;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState<"claim" | "pass" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passed, setPassed] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  async function claim() {
    setPending("claim");
    setError(null);
    try {
      const res = await fetch(`/api/fourth-call/${sessionId}/claim`, { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error ?? "something_went_wrong");
        return;
      }
      router.refresh();
    } catch {
      setError("network_error");
    } finally {
      setPending(null);
    }
  }

  async function pass() {
    if (!passNotificationId) {
      setPassed(true);
      return;
    }
    setPending("pass");
    try {
      await fetch(`/api/notifications/${passNotificationId}/read`, { method: "POST" });
      setPassed(true);
    } finally {
      setPending(null);
    }
  }

  const expired = now >= expiresAt.getTime();

  if (passed) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <p className="text-cu-card-title text-ink">Passed</p>
        <Meta as="p">No hard feelings — you&apos;ll hear about the next one.</Meta>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5 py-6 text-center">
      <PresenceTracker sessionId={sessionId} viewerId={viewerId} />
      <Meta className="uppercase tracking-[0.12em] text-action-strong font-extrabold">Fourth Call</Meta>
      <AvatarStack people={confirmed.map((p) => ({ src: p.avatarUrl, name: p.displayName }))} size="lg" ring="ground" />
      <div>
        <p className="text-cu-title text-ink">{circleName} need a fourth</p>
        <p className="text-cu-body text-ink-muted mt-1">
          {whenLabel}
          {venueLabel ? ` · ${venueLabel}` : ""}
        </p>
      </div>
      {levelMatchLabel && <Fact tone="muted">{levelMatchLabel}</Fact>}

      {error && <Meta tone="action">Couldn&apos;t claim the slot ({error}). Try again.</Meta>}

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Button size="lg" fullWidth disabled={pending !== null || expired} onClick={claim}>
          {expired ? "Expired" : "I can play"}
        </Button>
        <Button variant="quiet" fullWidth disabled={pending !== null} onClick={pass}>
          Pass
        </Button>
      </div>

      <Meta>{expired ? "this invite has expired" : `expires in ${formatCountdown(expiresAt.getTime() - now)}`}</Meta>
    </div>
  );
}
