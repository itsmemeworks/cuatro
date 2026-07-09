"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Avatar, Button, InfoTerm, Meta, QrShareSheet } from "@/components/ui";
import { usePresenceCount } from "@/lib/realtime/presence";
import { formatGlass } from "@/lib/design";

export type RingState = "pending" | "sent" | "done";

/** One played-with candidate row (ring 2a) — someone from the confirmed four's verified match history. */
export type PlayedWithRow = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  rating: number | null;
  sharedMatchCount: number;
  lastPlayedWithLabel: string;
  /** Already sent a played-with invite for this session (never nag twice). */
  invited: boolean;
};

/**
 * Fourth Call — send (organiser view, prototype screen 6). Ring 1 + ring 2
 * status come from the server (they're driven by real `fourth_call`
 * notifications — see the page component). Ring 3 ("anyone with the link")
 * mints a signed public claim link on tap (see server/fourth-call.ts's
 * getRing3ClaimLink) and copies/shares its full URL — no account or circle
 * membership needed to view it, signing in only gates actually claiming
 * the slot (app/fc/[token]/page.tsx).
 *
 * The prototype's bottom CTA walks one button through "Send the call" ->
 * "Sent…" -> "Live…" -> "Done" as if a tap fires each ring. This app has
 * no such tap for ring 1 (it fires automatically within 48h of kickoff —
 * see games-service.ts's checkFourthCallLevel1, called just by viewing this
 * page/the session page) — so the CTA below is state-only for that ring,
 * and only becomes a real action once ring 2's "Reach nearby players" (the
 * Local Ring) is actually available (the one manual override the backend has).
 */
export function FourthCallSend({
  sessionId,
  ring1State,
  ring1Label,
  playedWithState,
  playedWithLabel,
  playedWith,
  ring2State,
  ring2Label,
  canEscalate,
  ring3Available,
  claimed,
  organiserId,
}: {
  sessionId: string;
  ring1State: RingState;
  ring1Label: string;
  /** Played-with ring (2a) status + copy — computed server-side (see the page component). */
  playedWithState: RingState;
  playedWithLabel: string;
  /** The played-with candidates to show (faces + the expandable list with per-person Invite). */
  playedWith: PlayedWithRow[];
  ring2State: RingState;
  ring2Label: string;
  canEscalate: boolean;
  /** Whether ring 3's link can be generated right now (the session hasn't started and the four isn't already full). */
  ring3Available: boolean;
  /** Whether a Fourth Call claimant already holds the open slot — see findFourthCallClaimant. */
  claimed: boolean;
  /** The organiser's own user id, excluded from the live "viewing" count below — see lib/realtime/presence.ts. */
  organiserId?: string | null;
}) {
  const router = useRouter();
  const [escalating, setEscalating] = useState(false);
  const [playedWithExpanded, setPlayedWithExpanded] = useState(false);
  // Optimistic per-person state so a tapped "Invite" reads as sent immediately,
  // before router.refresh() re-renders from the server's notified set.
  const [invitingIds, setInvitingIds] = useState<Set<string>>(new Set());
  const [invitedLocally, setInvitedLocally] = useState<Set<string>>(new Set());
  const [invitingAll, setInvitingAll] = useState(false);
  const [ring3Pending, setRing3Pending] = useState(false);
  const [ring3Copied, setRing3Copied] = useState(false);
  const [ring3Error, setRing3Error] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  // Live "N viewing…" (design/HANDOFF.md screen 6) — aggregates every
  // viewer currently on the receive screen or the public ring-3 link, both
  // of which track presence on this same session channel. Organiser-only
  // and only meaningful while slots are still open (ring3Available already
  // encodes "upcoming and not full" — see the page component).
  const viewingCount = usePresenceCount(sessionId, organiserId);

  async function escalate() {
    setEscalating(true);
    try {
      await fetch(`/api/fourth-call/${sessionId}/escalate`, { method: "POST" });
      router.refresh();
    } finally {
      setEscalating(false);
    }
  }

  // Ring 2a: invite one played-with candidate (userId), or everyone (no
  // userId). Both go through the same escalate route / transaction / notify
  // path — never-nag-twice is enforced per person server-side.
  async function invitePlayedWith(userId?: string) {
    if (userId) setInvitingIds((s) => new Set(s).add(userId));
    else setInvitingAll(true);
    try {
      await fetch(`/api/fourth-call/${sessionId}/escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userId ? { ring: "played_with", userId } : { ring: "played_with" }),
      });
      if (userId) setInvitedLocally((s) => new Set(s).add(userId));
      else setInvitedLocally((s) => new Set([...s, ...playedWith.map((p) => p.userId)]));
      router.refresh();
    } finally {
      if (userId) {
        setInvitingIds((s) => {
          const next = new Set(s);
          next.delete(userId);
          return next;
        });
      } else {
        setInvitingAll(false);
      }
    }
  }

  const isInvited = (p: PlayedWithRow) => p.invited || invitedLocally.has(p.userId);
  const anyToInvite = playedWith.some((p) => !isInvited(p));

  // Both ring-3 affordances (Copy and Show QR) mint the same signed public
  // claim link — see server/fourth-call.ts getRing3ClaimLink.
  async function mintRing3Link(): Promise<string | null> {
    const res = await fetch(`/api/fourth-call/${sessionId}/escalate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level: 3 }),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) return null;
    return `${window.location.origin}${body.path}`;
  }

  async function copyRing3Link() {
    setRing3Pending(true);
    setRing3Error(false);
    try {
      const url = await mintRing3Link();
      if (!url) {
        setRing3Error(true);
        return;
      }

      if (navigator.share) {
        try {
          await navigator.share({ title: "Fourth Call, anyone free?", url });
          return;
        } catch {
          // Cancelled share sheet — fall through to copy.
        }
      }
      await navigator.clipboard.writeText(url);
      setRing3Copied(true);
      setTimeout(() => setRing3Copied(false), 2000);
    } catch {
      setRing3Error(true);
    } finally {
      setRing3Pending(false);
    }
  }

  async function showRing3Qr() {
    setRing3Pending(true);
    setRing3Error(false);
    try {
      const url = await mintRing3Link();
      if (!url) {
        setRing3Error(true);
        return;
      }
      setQrUrl(url);
      setQrOpen(true);
    } catch {
      setRing3Error(true);
    } finally {
      setRing3Pending(false);
    }
  }

  // Before the automatic rings can do anything (ring 1 fires within 48h of
  // kickoff, ring 2 escalates off the back of it) the one lever an organiser
  // always has is the ring-3 share link — so promote it to the primary CTA
  // instead of leaving a grey "opens automatically" box as the only button.
  const promoteRing3 = !claimed && ring3Available && !canEscalate && ring2State !== "sent";

  // The quiet status label shown when neither escalate nor the ring-3 share is
  // the live action (game full/started, or the network call is already out).
  const fallbackLabel =
    ring2State === "done"
      ? ring2Label
      : ring2State === "sent"
        ? "Live, first tap wins…"
        : ring1State === "sent"
          ? "Sent, the Circle sees it first…"
          : "Opens automatically closer to kickoff";

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-card bg-surface border border-ink-hairline-1 px-4 divide-y divide-ink-hairline-1">
        <div className="flex items-center gap-3 py-3.5">
          <span
            className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 ${
              ring1State === "pending" ? "border border-ink-hairline-4 text-ink-muted" : "bg-win text-action-contrast"
            }`}
          >
            {ring1State === "pending" ? "1" : "✓"}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-cu-body font-bold text-ink">The Circle first</p>
            <Meta as="p" className="mt-0.5">
              {ring1Label}
            </Meta>
          </div>
        </div>

        <div className="py-3.5">
          <div className="flex items-center gap-3">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 ${
                playedWithState === "pending" ? "border border-ink-hairline-4 text-ink-muted" : "bg-win text-action-contrast"
              }`}
            >
              {playedWithState === "pending" ? "2" : "✓"}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-cu-body font-bold text-ink">
                People you&apos;ve played with{" "}
                {playedWithState === "sent" && <span className="text-action-strong font-extrabold">· live</span>}
              </p>
              <Meta as="p" className="mt-0.5">
                {playedWithLabel}
              </Meta>
            </div>
            {playedWith.length > 0 && (
              <button
                type="button"
                onClick={() => setPlayedWithExpanded((v) => !v)}
                className="shrink-0 flex items-center gap-1.5 rounded-chip border border-ink-hairline-3 text-ink font-bold text-[10.5px] px-2.5 py-1.5 transition-cu-state active:opacity-80"
                aria-expanded={playedWithExpanded}
              >
                <span className="flex -space-x-1.5">
                  {playedWith.slice(0, 3).map((p) => (
                    <Avatar key={p.userId} src={p.avatarUrl} name={p.displayName} size="xs" ring="surface" />
                  ))}
                </span>
                {playedWith.length}
                <span aria-hidden>{playedWithExpanded ? "▴" : "▾"}</span>
              </button>
            )}
          </div>

          {playedWithExpanded && playedWith.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {playedWith.map((p) => {
                const invited = isInvited(p);
                const busy = invitingIds.has(p.userId) || invitingAll;
                return (
                  <div key={p.userId} className="flex items-center gap-3">
                    <Avatar src={p.avatarUrl} name={p.displayName} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-cu-body font-bold text-ink truncate">{p.displayName}</p>
                      <Meta as="p" className="mt-0.5 truncate">
                        Glass {formatGlass(p.rating)} · {p.lastPlayedWithLabel}
                      </Meta>
                    </div>
                    {invited ? (
                      <span className="shrink-0 rounded-chip border border-win text-win font-bold text-[10.5px] px-3 py-1.5">
                        Invited ✓
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => invitePlayedWith(p.userId)}
                        disabled={busy}
                        className="shrink-0 rounded-chip border border-ink-hairline-3 text-ink font-bold text-[10.5px] px-3 py-1.5 transition-cu-state active:opacity-80 disabled:opacity-50"
                      >
                        {invitingIds.has(p.userId) ? "…" : "Invite"}
                      </button>
                    )}
                  </div>
                );
              })}
              {anyToInvite && (
                <button
                  type="button"
                  onClick={() => invitePlayedWith()}
                  disabled={invitingAll}
                  className="self-start mt-0.5 rounded-chip border border-ink-hairline-3 text-ink font-bold text-[10.5px] px-3 py-1.5 transition-cu-state active:opacity-80 disabled:opacity-50"
                >
                  {invitingAll ? "…" : "Invite all"}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 py-3.5">
          <span
            className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 ${
              ring2State === "pending" ? "border border-ink-hairline-4 text-ink-muted" : "bg-win text-action-contrast"
            }`}
          >
            {ring2State === "pending" ? "2" : "✓"}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-cu-body font-bold text-ink">
              <InfoTerm term="localRing" label="Players near you" />{" "}
              {ring2State === "sent" && <span className="text-action-strong font-extrabold">· live</span>}
            </p>
            <Meta as="p" className="mt-0.5">
              {ring2Label}
            </Meta>
            {ring3Available && viewingCount > 0 && (
              <Meta as="p" tone="action" className="mt-0.5 font-extrabold">
                {viewingCount} viewing right now…
              </Meta>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 py-3.5">
          <span
            className={`w-6 h-6 rounded-full border flex items-center justify-center font-bold text-[11px] shrink-0 ${
              ring3Available ? "border-ink-hairline-4 text-ink" : "border-ink-hairline-4 text-ink-muted"
            }`}
          >
            3
          </span>
          <div className="flex-1 min-w-0">
            <p className={`text-cu-body font-bold ${ring3Available ? "text-ink" : "text-ink-muted"}`}>Anyone with the link</p>
            <Meta as="p" className="mt-0.5">
              {ring3Available
                ? "share it anywhere, no account needed to see it, signing in is only for claiming"
                : "not needed, the four's full, or this game's already started"}
            </Meta>
            {ring3Error && (
              <Meta tone="action" as="p" className="mt-0.5">
                couldn&apos;t generate the link, try again
              </Meta>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={copyRing3Link}
              disabled={!ring3Available || ring3Pending}
              className="rounded-chip border border-ink-hairline-3 text-ink font-bold text-[10.5px] px-3 py-1.5 transition-cu-state active:opacity-80 disabled:opacity-50"
            >
              {ring3Copied ? "Copied ✓" : ring3Pending ? "…" : "Copy ↗"}
            </button>
            <button
              type="button"
              onClick={showRing3Qr}
              disabled={!ring3Available || ring3Pending}
              className="rounded-chip border border-ink-hairline-3 text-ink font-bold text-[10.5px] px-3 py-1.5 transition-cu-state active:opacity-80 disabled:opacity-50"
            >
              QR
            </button>
          </div>
        </div>
      </div>

      {claimed ? (
        <Link
          href={`/games/${sessionId}`}
          className="rounded-button min-h-12 px-5 py-3.5 text-center text-[14px] font-extrabold bg-strong-bg text-strong-fg transition-cu-state active:opacity-80"
        >
          Done, back to the game →
        </Link>
      ) : promoteRing3 ? (
        <Button variant="primary" size="lg" fullWidth disabled={ring3Pending} onClick={copyRing3Link}>
          {ring3Copied ? "Link copied ✓" : ring3Pending ? "…" : "Share a link, anyone with it can claim the spot"}
        </Button>
      ) : canEscalate ? (
        <Button variant="primary" size="lg" fullWidth disabled={escalating} onClick={escalate}>
          {escalating ? "…" : "Reach nearby players →"}
        </Button>
      ) : (
        <div className="rounded-button min-h-12 px-5 py-3.5 text-center text-[14px] font-extrabold bg-ink-hairline-2 text-ink-muted">
          {fallbackLabel}
        </div>
      )}

      <Meta as="p" className="text-center">
        opens automatically within 48h of kickoff · reaches nearby players 20 min later if the Circle&apos;s quiet
      </Meta>

      {qrUrl && (
        <QrShareSheet
          open={qrOpen}
          onClose={() => setQrOpen(false)}
          title="Fourth Call"
          url={qrUrl}
          readableLink={qrUrl.replace(/^https?:\/\//, "")}
          caption="scan to grab the open spot, no account needed to see it, signing in is only for claiming"
        />
      )}
    </div>
  );
}
