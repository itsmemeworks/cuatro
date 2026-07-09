"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar, Button, Card, Meta } from "@/components/ui";
import { errorCopy } from "@/lib/error-copy";

export type NeedsAnswerSession = {
  sessionId: string;
  circleName: string;
  venueName: string | null;
  startsAt: Date;
  slots: number;
  confirmed: { userId: string; displayName: string; avatarUrl: string | null }[];
};

type Viewer = { userId: string; displayName: string; avatarUrl: string | null };

/** "Kav & Mags are in" / "Kav is in" / "Kav, Mags & Tom are in" — the prototype's naming convention (design/CUATRO-Prototype-LATEST.dc.html's Home screen), first names only. */
function namesLine(confirmed: { displayName: string }[]): string {
  const firstNames = confirmed.map((p) => p.displayName.split(" ")[0]);
  if (firstNames.length === 1) return `${firstNames[0]} is in`;
  const [last, ...rest] = [...firstNames].reverse();
  return `${rest.reverse().join(", ")} & ${last} are in`;
}

/**
 * The single surface-feature card on Home (design/HANDOFF.md screen 3):
 * "needs-your-answer card on surface-feature (single coral 'I'm in' +
 * quiet 'Can't')". Bespoke to Home rather than reusing
 * components/games/SessionCard — that component is a fuller game-detail
 * card (slot grid, countdown, reserves) meant for the games list; this is
 * the terser "answer this now" hero moment the prototype's Home screen
 * leads with. Both call the same RSVP endpoint.
 *
 * Tapping "I'm in" mirrors SessionCard's signature arrival treatment
 * (audit-design #6): the viewer's avatar springs into the confirmed stack
 * (animate-cu-arrive) with one pulse ring (animate-cu-pulse-once) and the
 * button flips to "You're in ✓ · game on" — optimistically, before the
 * server round-trip and router.refresh() reconcile it.
 */
export function NeedsAnswerCard({ session, viewer }: { session: NeedsAnswerSession; viewer: Viewer }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [optimisticIn, setOptimisticIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function respond(action: "in" | "out") {
    setPending(true);
    setError(null);
    setOptimisticIn(action === "in");
    try {
      const res = await fetch(`/api/games/sessions/${session.sessionId}/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setOptimisticIn(false);
        setError(body.error ?? "something_went_wrong");
        return;
      }
      router.refresh();
    } catch {
      setOptimisticIn(false);
      setError("network_error");
    } finally {
      setPending(false);
    }
  }

  const when = session.startsAt.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const place = session.venueName ? ` · ${session.venueName}` : "";

  // The card only renders when the viewer hasn't answered yet, so they're
  // never already in `confirmed` — appending them is a safe optimistic fill.
  const displayConfirmed = optimisticIn ? [...session.confirmed, viewer] : session.confirmed;
  const shown = displayConfirmed.slice(0, 3);
  const overflow = Math.max(0, displayConfirmed.length - 3);
  const spotsToFill = Math.max(session.slots - displayConfirmed.length, 0);

  return (
    <Card variant="feature">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-action" aria-hidden />
        <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-action-on-feature-label">NEEDS YOUR ANSWER</p>
        <span className="flex-1" />
        <Link href={`/games/${session.sessionId}`} className="text-[11px] font-bold text-action-on-feature-link">
          View game →
        </Link>
      </div>
      <p className="text-cu-title text-[19px] leading-[1.2] mt-2.5 text-ink-on-feature">
        {session.circleName}
        <br />
        {when}
        {place}
      </p>
      {displayConfirmed.length > 0 && (
        <div className={`flex items-center gap-2.5 mt-3 ${optimisticIn ? "animate-cu-pulse-once" : ""}`}>
          <div className="flex items-center">
            {shown.map((p, i) => (
              <Avatar
                key={p.userId}
                src={p.avatarUrl}
                name={p.displayName}
                size="sm"
                ring="surface-feature"
                overlap={i > 0}
                className={optimisticIn && p.userId === viewer.userId ? "animate-cu-arrive" : ""}
              />
            ))}
            {overflow > 0 && (
              <div
                className="rounded-full flex-none flex items-center justify-center bg-ink-hairline-2 text-ink font-bold ring-2 ring-[var(--color-surface-feature)]"
                style={{ width: 26, height: 26, marginLeft: -10, fontSize: 8 }}
              >
                +{overflow}
              </div>
            )}
          </div>
          <span className="text-[11.5px] font-medium text-ink-on-feature-muted">
            {optimisticIn
              ? "You're in ✓ · game on"
              : `${namesLine(session.confirmed)} — ${spotsToFill} spot${spotsToFill === 1 ? "" : "s"} to fill`}
          </span>
        </div>
      )}
      {error && (
        <Meta as="p" tone="loss" onFeature className="mt-2">
          {errorCopy(error)}
        </Meta>
      )}
      {/*
        Card variant="feature" is a deliberately dark card in BOTH themes
        (see globals.css's comment on --color-surface-feature), so Button
        needs its `onFeature` prop here — plain "quiet" would use the
        theme-reactive `text-ink`/`border-ink-hairline-4` tokens, which
        would render dark-on-dark under a light OS theme. `primary` is fine
        either way (bg-action/text-action-contrast are theme-independent),
        `onFeature` is a no-op for it.
      */}
      <div className="flex gap-2 mt-3.5">
        {optimisticIn ? (
          <Button
            variant="strong"
            size="lg"
            onFeature
            disabled={pending}
            onClick={() => respond("out")}
            style={{ background: "var(--color-win)", color: "var(--color-action-contrast)" }}
            className="flex-1"
          >
            You&apos;re in ✓ · game on
          </Button>
        ) : (
          <>
            <Button variant="primary" size="lg" onFeature disabled={pending} onClick={() => respond("in")} className="flex-[2]">
              I&apos;m in
            </Button>
            <Button variant="destructiveQuiet" size="lg" onFeature disabled={pending} onClick={() => respond("out")} className="flex-1">
              Can&apos;t
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
