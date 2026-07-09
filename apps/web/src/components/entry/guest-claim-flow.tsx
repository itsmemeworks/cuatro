"use client";

import { useState } from "react";
import Link from "next/link";
import { AvatarStack, Avatar, Button, Meta } from "@/components/ui";
import { venueDirectionsUrl } from "@/lib/directions";
import { SelfieCamera } from "@/components/entry/selfie-camera";

export type GuestPerson = { src?: string | null; name: string };

export type GuestFlowInitial =
  | { step: "claim" }
  | { step: "name"; status: "in" | "reserve" }
  | { step: "done"; status: "in" | "reserve"; displayName: string; avatarUrl?: string | null };

// Button always renders a real <button> (see components/ui/button.tsx), but
// "Enter CUATRO" needs to be a same-tap <Link> — this mirrors its
// variant="strong" size="lg" fullWidth class recipe exactly (same approach
// app/page.tsx's "Get started" link already uses).
const STRONG_LG_LINK_CLASS =
  "rounded-button inline-flex items-center justify-center gap-2 select-none transition-cu-state active:opacity-80 w-full min-h-12 px-5 text-[15px] font-extrabold bg-strong-bg text-strong-fg";

const CLAIM_ERROR_COPY: Record<string, string> = {
  session_started: "this game's already kicked off",
  invalid_link: "this link isn't valid for this game",
  session_not_found: "this game isn't there any more",
};

const NAME_ERROR_COPY: Record<string, string> = {
  invalid_name: "give us at least one letter",
  slot_lost: "your hold ran out and someone else took it",
  no_guest_session: "that took too long — try claiming again",
};

function namesLine(names: string[]): string {
  if (names.length === 0) return "the four's waiting on a player";
  const verb = names.length === 1 ? "is" : "are";
  const list =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} & ${names[1]}`
        : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
  return `${list} ${verb} waiting on a fourth`;
}

/**
 * The join-via-link "10-second promise" (design/HANDOFF.md screen 2;
 * Directions turn 11), rebuilt against real data on /fc/[token]. Four
 * client-side steps — claim -> (beaten ->) name -> done — with no full page
 * reload between them, matching the mock's "budget: tap card 0s -> in
 * ≤10s" note. `initial` lets the server resume a returning guest mid-flow
 * (already claimed but not yet named, or already locked in) instead of
 * always starting cold at "claim".
 */
export function GuestClaimFlow({
  sessionId,
  token,
  circleName,
  whenLabel,
  venue,
  confirmedPeople,
  initial,
}: {
  sessionId: string;
  token: string;
  circleName: string;
  whenLabel: string;
  venue?: { name: string; address?: string | null } | null;
  confirmedPeople: GuestPerson[];
  initial: GuestFlowInitial;
}) {
  const [step, setStep] = useState<"claim" | "beaten" | "name" | "done">(initial.step);
  const [status, setStatus] = useState<"in" | "reserve">(initial.step === "claim" ? "in" : initial.status);
  const [displayName, setDisplayName] = useState(initial.step === "done" ? initial.displayName : "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>((initial.step === "done" && initial.avatarUrl) || null);
  const [justArrived, setJustArrived] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);

  async function claim() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/guest/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, token }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        if (body.error === "already_full") {
          setStep("beaten");
        } else {
          setError(CLAIM_ERROR_COPY[body.error] ?? "couldn't claim the spot — try again");
        }
        return;
      }
      setStatus("in");
      setStep("name");
    } catch {
      setError("network error — try again");
    } finally {
      setPending(false);
    }
  }

  async function joinReserve() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/guest/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, token }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(CLAIM_ERROR_COPY[body.error] ?? "couldn't join the queue — try again");
        return;
      }
      setStatus("reserve");
      setStep("name");
    } catch {
      setError("network error — try again");
    } finally {
      setPending(false);
    }
  }

  async function lockName() {
    const name = nameDraft.trim();
    if (!name) {
      setError(NAME_ERROR_COPY.invalid_name);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/guest/name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, name }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        if (body.error === "slot_lost") {
          setStep("beaten");
        } else {
          setError(NAME_ERROR_COPY[body.error] ?? "couldn't lock that in — try again");
        }
        return;
      }
      setDisplayName(body.displayName);
      setJustArrived(true);
      setStep("done");
    } catch {
      setError("network error — try again");
    } finally {
      setPending(false);
    }
  }

  const directionsUrl = venue ? venueDirectionsUrl(venue) : null;

  if (step === "claim") {
    return (
      <div className="w-full">
        <div className="flex items-center gap-2 bg-surface rounded-chip px-3.5 py-2 mx-auto mb-3.5 w-fit">
          <Meta className="whitespace-nowrap">🔒 cuatro.app</Meta>
        </div>
        <div className="rounded-card bg-surface-feature border border-ink-hairline-2 overflow-hidden text-left">
          <div className="p-4 pb-3.5 border-b border-ink-hairline-1">
            <p className="text-[9.5px] font-extrabold tracking-[0.14em] text-action-strong">
              YOU&apos;RE INVITED · {circleName.toUpperCase()}
            </p>
            <p className="text-[21px] leading-[1.2] font-extrabold text-ink-on-feature mt-2">{whenLabel}</p>
            {venue?.name && <p className="text-cu-meta text-ink-on-feature-muted mt-1.5">{venue.name}</p>}
          </div>
          <div className="p-4">
            <div className="flex items-center gap-2.5">
              <AvatarStack people={confirmedPeople} size="sm" ring="surface-feature" max={3} />
              <p className="text-[11px] leading-[1.4] text-ink-on-feature-muted flex-1">
                {namesLine(confirmedPeople.map((p) => p.name))}
              </p>
            </div>
            <Button size="lg" fullWidth disabled={pending} onClick={claim} className="mt-3.5">
              {pending ? "…" : "I can play — claim it"}
            </Button>
            <Meta as="p" className="text-center mt-2.5">
              no account · no app download · ~10 seconds
            </Meta>
          </div>
        </div>
        {error && (
          <Meta tone="action" as="p" className="text-center mt-3">
            {error}
          </Meta>
        )}
      </div>
    );
  }

  if (step === "beaten") {
    return (
      <div className="w-full text-center">
        <h2 className="text-cu-title text-ink">Beaten to it</h2>
        <p className="text-cu-body text-ink-muted mt-1.5">
          Brutal. But there&apos;s a queue, and this circle plays every week.
        </p>
        <Button size="lg" fullWidth disabled={pending} onClick={joinReserve} className="mt-4">
          {pending ? "…" : "Join the reserve queue"}
        </Button>
        <Meta as="p" className="mt-2.5">
          reserves auto-promote — if a slot opens, you&apos;re told
        </Meta>
        {error && (
          <Meta tone="action" as="p" className="mt-2">
            {error}
          </Meta>
        )}
      </div>
    );
  }

  if (step === "name") {
    return (
      <div className="w-full text-left">
        <h2 className="text-cu-title text-ink">
          {status === "in" ? (
            <>
              Spot held.
              <br />
              Who should we say is coming?
            </>
          ) : (
            <>
              You&apos;re on the list.
              <br />
              Who should we say it is?
            </>
          )}
        </h2>
        {status === "in" && <Meta as="p" className="mt-2.5">held for you for 5:00 while you type</Meta>}
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") lockName();
          }}
          placeholder="First name — e.g. Alex"
          autoFocus
          className="w-full box-border mt-4.5 bg-surface border border-ink-hairline-3 rounded-button px-4 py-3.5 text-[15px] font-semibold text-ink outline-none"
        />
        <Button size="lg" fullWidth disabled={pending} onClick={lockName} className="mt-3">
          {pending ? "…" : "Lock it in"}
        </Button>
        <Meta as="p" className="mt-3.5 leading-[1.7]">
          that&apos;s it — no password, no email. a magic link can save your games later, after you&apos;ve played.
        </Meta>
        {error && (
          <Meta tone="action" as="p" className="mt-2">
            {error}
          </Meta>
        )}
      </div>
    );
  }

  // step === "done"
  const initialLetter = displayName.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <div className="w-full text-center">
      {showCamera && (
        <SelfieCamera
          onClose={() => setShowCamera(false)}
          onSaved={(url) => {
            setAvatarUrl(url);
            setShowCamera(false);
          }}
        />
      )}

      <div className="relative w-fit mx-auto">
        {avatarUrl ? (
          <Avatar src={avatarUrl} name={displayName} size="lg" />
        ) : (
          <div
            className={`w-[64px] h-[64px] rounded-full bg-action flex items-center justify-center ${justArrived ? "animate-cu-arrive" : ""}`}
          >
            <span className="text-[26px] font-extrabold text-action-contrast">{initialLetter}</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowCamera(true)}
          aria-label="Add a photo"
          className="absolute -right-1 -bottom-1 w-6 h-6 rounded-full bg-action border-2 border-ground flex items-center justify-center"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8h3l2-2.5h6L17 8h3v11H4z" />
            <circle cx="12" cy="13" r="3.2" />
          </svg>
        </button>
      </div>

      <h2 className="text-cu-title text-ink mt-3.5">
        {status === "in" ? `You're in, ${displayName}.` : `You're on the list, ${displayName}.`}
      </h2>

      {status === "in" ? (
        <div className="flex justify-center gap-1.5 mt-4">
          <AvatarStack people={confirmedPeople} size="md" ring="ground" />
          <div className={`w-[34px] h-[34px] -ml-2.5 rounded-full bg-action flex items-center justify-center ring-2 ring-[var(--color-ground)] ${justArrived ? "animate-cu-arrive" : ""}`}>
            <span className="text-[13px] font-extrabold text-action-contrast">{initialLetter}</span>
          </div>
        </div>
      ) : (
        <Meta as="p" className="mt-2">
          you&apos;ll hear the moment a slot opens up
        </Meta>
      )}

      <Meta as="p" className="mt-3">
        {whenLabel}
        {venue?.name ? ` · ${venue.name}` : ""}
      </Meta>

      <div className="flex justify-center gap-2 mt-3.5">
        <a
          href={`/fc/${token}/ics`}
          className="rounded-chip border border-ink-hairline-4 text-ink font-bold text-[11px] px-3.5 py-2"
        >
          Add to calendar
        </a>
        {directionsUrl && (
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener"
            className="rounded-chip border border-ink-hairline-4 text-ink font-bold text-[11px] px-3.5 py-2"
          >
            Directions
          </a>
        )}
      </div>

      <Link href={`/fc/${token}`} className={`${STRONG_LG_LINK_CLASS} mt-5`}>
        Enter CUATRO →
      </Link>

      <Link
        href={`/login?next=${encodeURIComponent(`/fc/${token}`)}`}
        className="block text-cu-meta text-ink-muted underline underline-offset-[3px] mt-4"
      >
        Make it yours — save your games with a magic link
      </Link>
    </div>
  );
}
