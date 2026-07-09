"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AvatarStack, Button, DashedSlot, Meta } from "@/components/ui";
import type { GuestPerson } from "@/components/entry/guest-claim-flow";

/** The next game the guest lands on, shaped server-side (games-service SessionSummary) so this stays a dumb renderer. */
export type NextGameView = {
  sessionId: string;
  whenLabel: string;
  venueName: string | null;
  confirmedPeople: GuestPerson[];
  /** The guest's own RSVP status on this session. */
  status: "in" | "reserve" | "out" | null;
  /** True when the RSVP window is open right now (between it opening and kickoff). */
  rsvpOpen: boolean;
  /** Human label for when the window opens, shown only while it hasn't yet. */
  opensAtLabel: string | null;
};

export type GuestCircleJoinInitial =
  | { step: "join" }
  | { step: "done"; displayName: string; nextGame: NextGameView | null };

// The convert CTA must be a same-tap <Link> (a route change, not a fetch),
// but wear the Button `strong` recipe — mirrors guest-claim-flow.tsx's done
// step exactly. `strong`, never coral: the one coral action on the done step
// is the RSVP button, per the design system's one-primary-per-screen rule.
const STRONG_LG_LINK_CLASS =
  "rounded-button inline-flex items-center justify-center gap-2 select-none transition-cu-state active:opacity-80 w-full min-h-12 px-5 text-[15px] font-extrabold bg-strong-bg text-strong-fg";

const JOIN_ERROR_COPY: Record<string, string> = {
  invalid_name: "give us at least one letter",
  circle_not_found: "this invite link isn't valid any more",
};

const RSVP_ERROR_COPY: Record<string, string> = {
  window_not_open: "RSVPs for this one aren't open yet",
  session_started: "this game's already kicked off",
  not_a_circle_member: "something went wrong — try re-opening the link",
};

/**
 * The logged-out circle-join flow (F1 / DESIGN.md §Growth loop): open a circle
 * invite, join as a guest with just a name, land visibly IN the circle, and
 * RSVP its next game — all with no account, conversion offered afterwards.
 * Mirrors guest-claim-flow.tsx's shape but for a Circle rather than a single
 * Fourth Call spot: two steps, `join` -> `done`. On a successful join the
 * server re-renders this page (router.refresh) into the `done` step with the
 * guest recognised as a member via their device cookie — the same "resume a
 * returning guest" trick the /fc page uses, just server-driven.
 */
export function GuestCircleJoinFlow({
  code,
  circleName,
  circleEmblem,
  circleColour,
  initial,
}: {
  code: string;
  circleName: string;
  circleEmblem: string | null;
  circleColour: string | null;
  initial: GuestCircleJoinInitial;
}) {
  const router = useRouter();
  const [nameDraft, setNameDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rsvpStatus, setRsvpStatus] = useState<"in" | "reserve" | "out" | null>(
    initial.step === "done" ? (initial.nextGame?.status ?? null) : null,
  );

  async function join() {
    const name = nameDraft.trim();
    if (!name) {
      setError(JOIN_ERROR_COPY.invalid_name);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/guest/circle-join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(JOIN_ERROR_COPY[body.error] ?? "couldn't join — try again");
        return;
      }
      // The cookie is now set; the server will recognise this device as a
      // member and re-render into the done step with the circle's next game.
      router.refresh();
    } catch {
      setError("network error — try again");
    } finally {
      setPending(false);
    }
  }

  async function rsvp(sessionId: string) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/guest/circle-rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(RSVP_ERROR_COPY[body.error] ?? "couldn't RSVP — try again");
        return;
      }
      setRsvpStatus(body.status);
      router.refresh();
    } catch {
      setError("network error — try again");
    } finally {
      setPending(false);
    }
  }

  const emblem = (
    <div
      className="w-16 h-16 rounded-full flex items-center justify-center text-3xl text-white"
      style={{ background: circleColour ?? "var(--color-ink-hairline-3)" }}
      aria-hidden
    >
      {circleEmblem ?? "⭘"}
    </div>
  );

  if (initial.step === "join") {
    return (
      <div className="flex flex-col items-center gap-8 w-full">
        <div className="flex flex-col items-center gap-4">
          {emblem}
          <div>
            <p className="text-[10px] font-extrabold tracking-[0.14em] text-action">YOU&apos;RE INVITED</p>
            <h1 className="text-cu-title mt-1.5">{circleName}</h1>
          </div>
          <p className="text-cu-body text-ink-muted max-w-xs">
            Its chat, history and Standing Games — join to see what your mates have been up to.
          </p>
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <DashedSlot size="lg" pulse label="4" />
          <Meta>a spot&apos;s open for you</Meta>
        </div>

        <div className="w-full max-w-xs flex flex-col gap-3 text-left">
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") join();
            }}
            placeholder="First name — e.g. Alex"
            autoFocus
            className="w-full box-border bg-surface border border-ink-hairline-3 rounded-button px-4 py-3.5 text-[15px] font-semibold text-ink outline-none"
          />
          <Button size="lg" fullWidth disabled={pending} onClick={join}>
            {pending ? "…" : `Join ${circleName}`}
          </Button>
          <Meta as="p" className="text-center">
            no account · no app download · ~10 seconds
          </Meta>
          {error && (
            <Meta tone="action" as="p" className="text-center">
              {error}
            </Meta>
          )}
        </div>
      </div>
    );
  }

  // step === "done"
  const { displayName, nextGame } = initial;
  const initialLetter = displayName.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <div className="flex flex-col items-center gap-7 w-full text-center">
      <div className="flex flex-col items-center gap-3">
        {emblem}
        <div className="w-[64px] h-[64px] rounded-full bg-action flex items-center justify-center animate-cu-arrive -mt-8 ring-2 ring-[var(--color-ground)]">
          <span className="text-[26px] font-extrabold text-action-contrast">{initialLetter}</span>
        </div>
        <h1 className="text-cu-title">You&apos;re in, {displayName}.</h1>
        <Meta as="p">a member of {circleName}</Meta>
      </div>

      <div className="w-full max-w-xs">
        {nextGame ? (
          <div className="rounded-card bg-surface-feature border border-ink-hairline-2 overflow-hidden text-left">
            <div className="p-4 pb-3.5 border-b border-ink-hairline-1">
              <p className="text-[9.5px] font-extrabold tracking-[0.14em] text-action-strong">NEXT GAME</p>
              <p className="text-[21px] leading-[1.2] font-extrabold text-ink-on-feature mt-2">{nextGame.whenLabel}</p>
              {nextGame.venueName && (
                <p className="text-cu-meta text-ink-on-feature-muted mt-1.5">{nextGame.venueName}</p>
              )}
            </div>
            <div className="p-4">
              {nextGame.confirmedPeople.length > 0 && (
                <div className="flex items-center gap-2.5 mb-3.5">
                  <AvatarStack people={nextGame.confirmedPeople} size="sm" ring="surface-feature" max={3} />
                  <p className="text-[11px] leading-[1.4] text-ink-on-feature-muted flex-1">
                    {nextGame.confirmedPeople.length === 1 ? "1 player in" : `${nextGame.confirmedPeople.length} players in`}
                  </p>
                </div>
              )}

              {rsvpStatus === "in" ? (
                <p className="text-cu-body text-win font-bold">You&apos;re in — see you on court</p>
              ) : rsvpStatus === "reserve" ? (
                <p className="text-cu-body text-ink-on-feature font-bold">
                  You&apos;re on the reserve list — you&apos;ll hear the moment a slot opens
                </p>
              ) : nextGame.rsvpOpen ? (
                <Button size="lg" fullWidth disabled={pending} onClick={() => rsvp(nextGame.sessionId)}>
                  {pending ? "…" : "Count me in"}
                </Button>
              ) : (
                <Meta as="p" onFeature>
                  {nextGame.opensAtLabel ? `RSVPs open ${nextGame.opensAtLabel}` : "RSVPs for this one aren't open yet"}
                </Meta>
              )}

              {error && (
                <Meta tone="action" as="p" className="mt-2.5">
                  {error}
                </Meta>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-card bg-surface border border-ink-hairline-2 p-4 text-left">
            <p className="text-cu-body text-ink">No game scheduled yet.</p>
            <Meta as="p" className="mt-1.5">
              you&apos;ll see it here the moment your organiser sets one up
            </Meta>
          </div>
        )}
      </div>

      <div className="w-full max-w-xs flex flex-col gap-3.5">
        <Link href={`/login?next=${encodeURIComponent(`/join/${code}`)}`} className={STRONG_LG_LINK_CLASS}>
          Save your spot — send me a magic link
        </Link>
        <Meta as="p" className="leading-[1.7]">
          no password needed to play — the link just keeps your circle and games, so you can pick up where you left off
        </Meta>
      </div>
    </div>
  );
}
