"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSessionLive } from "@/lib/realtime/hooks";
import { Avatar, Button, Card, Chip, DashedSlot, Fact, Meta } from "@/components/ui";
import { InfoTerm } from "@/components/ui/info-term";
import { errorCopy } from "@/lib/error-copy";
import { formatGlass } from "@/lib/design";
import { CircleEmblem, PlayerLink, circleColour } from "./roster";
import type { SessionCardPlayer } from "./SessionCard";
import { LateCancelSheet, isLateCancel } from "./late-cancel-sheet";

/** Client-safe mirror of the server's rotation reason. */
export type RotationReasonCard = { plays: number; windowSize: number; satOutLast: boolean; reason: string };

/**
 * THE ROTATION view passed to the week card. Pre-lock (`locked` false),
 * `lineup`/`sitting` are the LIVE provisional split; post-lock they mirror the
 * committed four and sit-out list. `reasons` explains each available player.
 */
export type RotationCardView = {
  mode: "limited" | "unlimited";
  locked: boolean;
  /** No played history yet — the four are first-come, reasons say "first to tap in". */
  coldStart: boolean;
  /** Epoch ms the provisional four locks (startsAt − cutoff). Unlimited never reaches it. */
  locksAtMs: number;
  available: SessionCardPlayer[];
  lineup: SessionCardPlayer[];
  sitting: SessionCardPlayer[];
  reasons: Record<string, RotationReasonCard>;
  viewerAvailable: boolean;
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
 * "This week" — the Standing Game screen's slot list (design/CUATRO-Prototype-LATEST.dc.html's
 * "Standing Game" screen, design/DESIGN-AUDIT.md S3/S4): avatar+name+status-
 * chip rows (viewer's own row always first), a dashed open slot with "send a
 * Fourth Call", and a reserve queue with an auto-promote explainer.
 *
 * A dedicated component rather than a restyle of components/games/SessionCard.tsx
 * (that one's tile-grid anatomy is shared with Home/Circle feed, which are
 * frozen for this pass — see design/DESIGN-AUDIT.md's brief). Same data
 * shape and the same `/api/games/sessions/:id/rsvp` endpoint, just this
 * screen's own row-list anatomy.
 */
export function StandingGameWeekCard({
  sessionId,
  circleId,
  circleName,
  circleColour: circleColourProp,
  circleEmblem,
  weekLabel,
  slots,
  confirmed,
  reserves,
  viewerUserId,
  viewerDisplayName,
  viewerAvatarUrl,
  viewerStatus,
  rsvpWindowOpensAt,
  startsAt,
  canSendFourthCall,
  fourthCallHref,
  glassByUserId,
  guestByUserId,
  rotation,
  onPromoted,
}: {
  sessionId: string;
  /** Circle identity for the header emblem + colour accent (never coral). */
  circleId: string;
  circleName: string;
  /** The Circle's explicitly-chosen colour (palette hex) / emblem; null falls back to the deterministic seed colour + name initials. */
  circleColour?: string | null;
  circleEmblem?: string | null;
  weekLabel: string;
  slots: number;
  confirmed: SessionCardPlayer[];
  reserves: SessionCardPlayer[];
  viewerUserId: string;
  viewerDisplayName: string;
  viewerAvatarUrl: string | null;
  viewerStatus: "in" | "reserve" | "out" | null;
  rsvpWindowOpensAt: Date;
  startsAt: Date;
  /** Only an organiser may send a Fourth Call — see games/[sessionId]/fourth-call's own gate. */
  canSendFourthCall: boolean;
  fourthCallHref: string;
  /** Glass per player, keyed by userId; a value of null means unrated. Omitted keys render "not rated yet". */
  glassByUserId?: Record<string, number | null>;
  /** Guests (no profile) render unlinked; keyed by userId. */
  guestByUserId?: Record<string, boolean>;
  /** Present iff this is a rotation game — swaps the slot list for the availability/lineup view. */
  rotation?: RotationCardView | null;
  onPromoted?: () => void;
}) {
  const router = useRouter();
  const [now, setNow] = useState<number>(() => Date.now());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lateConfirm, setLateConfirm] = useState<null | "out" | "unavailable">(null);

  useSessionLive(sessionId);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const startsAtMs = startsAt.getTime();
  const windowOpensMs = rsvpWindowOpensAt.getTime();
  const windowOpen = now >= windowOpensMs && now < startsAtMs;
  const sessionStarted = now >= startsAtMs;
  const viewerHoldsSlotNow = viewerStatus === "in";

  function sendRsvp(action: "in" | "out" | "available" | "unavailable") {
    // Dropping a held slot inside 24h is a late cancel — confirm first.
    if ((action === "out" || action === "unavailable") && viewerHoldsSlotNow && isLateCancel(startsAtMs, now)) {
      setLateConfirm(action);
      return;
    }
    void doRsvp(action);
  }

  async function doRsvp(action: "in" | "out" | "available" | "unavailable") {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/sessions/${sessionId}/rsvp`, {
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

  const others = confirmed.filter((p) => p.userId !== viewerUserId);
  const openSlots = Math.max(0, slots - 1 - others.length); // slots left once your own row + everyone else confirmed are accounted for
  const openCount = Math.max(0, slots - confirmed.length);

  const youChip =
    viewerStatus === "in"
      ? { label: "In ✓", tone: "positive" as const }
      : viewerStatus === "reserve"
        ? { label: "Reserved ✓", tone: "streak" as const }
        : { label: "Not answered", tone: "neutral" as const };

  const viewerHoldsSlot = viewerStatus === "in";
  const viewerReserved = viewerStatus === "reserve";

  const glassFor = (userId: string) => (glassByUserId ? glassByUserId[userId] ?? null : undefined);

  const lateCancelSheet = (
    <LateCancelSheet
      open={lateConfirm !== null}
      pending={pending}
      onCancel={() => setLateConfirm(null)}
      onConfirm={() => {
        const action = lateConfirm;
        setLateConfirm(null);
        if (action) void doRsvp(action);
      }}
    />
  );

  // THE ROTATION swaps the whole slot-list body: pre-lock it's an availability
  // view with a live provisional four; post-lock it's the committed four + the
  // sit-out list, each row carrying its fairness reason.
  if (rotation) {
    const short = rotation.lineup.length < slots;
    const rotationRow = (p: SessionCardPlayer, tone: "positive" | "streak" | "neutral", chip: string) => {
      const r = rotation.reasons[p.userId];
      const isYou = p.userId === viewerUserId;
      return (
        <div key={p.userId} className="flex items-center gap-2.5 py-2.5 border-b border-ink-hairline-1 last:border-b-0">
          <PlayerLink userId={p.userId} isGuest={guestByUserId?.[p.userId]} className="flex items-center gap-2.5 flex-1 min-w-0">
            <Avatar src={p.avatarUrl} name={p.displayName} size="sm" />
            <span className="flex flex-col min-w-0">
              <span className="text-cu-body font-bold text-ink truncate">
                {p.displayName}
                {isYou && <span className="font-normal text-ink-muted"> (you)</span>}
              </span>
              {r && (
                <Fact as="span" size="sm" tone="muted" className="truncate">
                  {r.satOutLast ? `sat out last week · ${r.reason}` : r.reason}
                </Fact>
              )}
            </span>
          </PlayerLink>
          {glassFor(p.userId) !== undefined && (
            <Fact size="sm" tone="muted" className="whitespace-nowrap">
              {formatGlass(glassFor(p.userId))}
            </Fact>
          )}
          <Chip tone={tone}>{chip}</Chip>
        </div>
      );
    };

    const provisional = !rotation.locked;
    const rotationButton =
      provisional ? (
        <div className="flex gap-2">
          <Button
            size="lg"
            className="flex-[2]"
            variant={rotation.viewerAvailable ? "strong" : "primary"}
            pending={pending}
            onClick={() => sendRsvp(rotation.viewerAvailable ? "unavailable" : "available")}
          >
            {rotation.viewerAvailable ? "You're available ✓" : "I'm available"}
          </Button>
          {rotation.viewerAvailable && (
            <Button size="lg" variant="destructiveQuiet" className="flex-1" pending={pending} onClick={() => sendRsvp("unavailable")}>
              Not this week
            </Button>
          )}
        </div>
      ) : (
        (viewerHoldsSlot || viewerReserved) && (
          <div className="flex gap-2">
            <Button
              size="lg"
              className="flex-[2]"
              variant="strong"
              style={viewerHoldsSlot ? { background: "var(--color-win)", color: "var(--color-action-contrast)" } : undefined}
              pending={pending}
              onClick={() => sendRsvp("out")}
            >
              {viewerHoldsSlot ? "You're in this week ✓" : "Sitting out ✓"}
            </Button>
            <Button size="lg" variant="destructiveQuiet" className="flex-1" pending={pending} onClick={() => sendRsvp("out")}>
              Can&apos;t
            </Button>
          </div>
        )
      );

    return (
      <>
        <Card padded={false} className="overflow-hidden">
          <span aria-hidden className="block h-1" style={{ background: circleColour(circleId, circleColourProp) }} />
          <div className="flex items-center gap-2.5 px-4 py-3 bg-ink-hairline-1">
            <CircleEmblem seed={circleId} name={circleName} emblem={circleEmblem} colour={circleColourProp} px={28} />
            <div className="flex-1 min-w-0">
              <p className="text-cu-card-title text-ink truncate">{circleName}</p>
              <p className="text-cu-meta text-ink-muted">This week · {weekLabel}</p>
            </div>
            <p className="font-mono tabular-nums font-bold text-[10.5px] whitespace-nowrap text-action-strong">
              {provisional ? `${rotation.available.length} AVAILABLE` : rotation.locked && !short ? `SET · ${slots} OF ${slots}` : `${Math.max(0, slots - rotation.lineup.length)} SPOT${slots - rotation.lineup.length === 1 ? "" : "S"} OPEN`}
            </p>
          </div>

          <div className="px-4 py-3">
            <p className="text-cu-secondary text-ink-muted leading-relaxed">
              <InfoTerm term="rotation" label="The Rotation" /> is on.{" "}
              {rotation.coldStart
                ? "First few weeks run first-come, it starts picking the fairest four once your game has some history."
                : !provisional
                  ? "This week's four is set. It rotates so everyone gets fair court time."
                  : rotation.mode === "unlimited"
                    ? "Re-picks the fairest four as availability changes, right up to kickoff."
                    : now >= rotation.locksAtMs
                      ? "Locking the four now."
                      : `Locks in ${formatCountdown(rotation.locksAtMs - now)}, whoever's due plays.`}
            </p>
          </div>

          {rotation.lineup.length > 0 && (
            <div className="px-4">
              <p className="text-cu-secondary font-extrabold tracking-[0.12em] text-ink-muted pb-1">
                {provisional ? "PROVISIONAL FOUR" : "PLAYING THIS WEEK"}
              </p>
              {rotation.lineup.map((p) => rotationRow(p, provisional ? "streak" : "positive", provisional ? "Due" : "In ✓"))}
            </div>
          )}

          {short && (
            <div className="px-4 pt-2">
              <Meta as="p" className="leading-relaxed">
                Short this week. {provisional ? "Once it locks, " : ""}a Fourth Call fills the open{" "}
                {slots - rotation.lineup.length === 1 ? "spot" : "spots"}.
              </Meta>
            </div>
          )}

          {rotation.sitting.length > 0 && (
            <div className="bg-ink-hairline-1 px-4 py-3 mt-3">
              <p className="text-cu-secondary font-extrabold tracking-[0.12em] text-ink-muted pb-1">
                {provisional ? "SITTING OUT (PROVISIONAL)" : "SITTING OUT THIS WEEK"}
              </p>
              {rotation.sitting.map((p, i) => {
                const r = rotation.reasons[p.userId];
                const isYou = p.userId === viewerUserId;
                return (
                  <div key={p.userId} className="flex items-center gap-2.5 py-2">
                    <span className="font-mono tabular-nums text-[11px] text-ink-muted w-3">{i + 1}</span>
                    <PlayerLink userId={p.userId} isGuest={guestByUserId?.[p.userId]} className="flex items-center gap-2.5 flex-1 min-w-0">
                      <Avatar src={p.avatarUrl} name={p.displayName} size="xs" />
                      <span className="flex flex-col min-w-0">
                        <span className="text-cu-secondary font-semibold text-ink truncate">
                          {p.displayName}
                          {isYou && <span className="text-action"> (you)</span>}
                        </span>
                        {r && <Fact as="span" size="sm" tone="muted" className="truncate">{r.reason}</Fact>}
                      </span>
                    </PlayerLink>
                    {i === 0 && !provisional && <span className="font-mono text-[10px] text-win whitespace-nowrap">first in ✓</span>}
                  </div>
                );
              })}
              <Meta as="p" className="mt-2 leading-relaxed">
                {provisional
                  ? "Not final until it locks. Whoever sits out is first to play next week."
                  : `${rotation.sitting[0]!.displayName} is first in if anyone drops, and first to play next week.`}
              </Meta>
            </div>
          )}

          {rotation.available.length === 0 && provisional && (
            <div className="px-4 pb-4">
              <Meta as="p">No one&apos;s marked available yet. Say you&apos;re in and you&apos;ll show here.</Meta>
            </div>
          )}

          {rotation.locked && short && canSendFourthCall && (
            <div className="px-4 py-3 border-t border-ink-hairline-1 flex items-center gap-2.5">
              <DashedSlot size="sm" pulse label={String(rotation.lineup.length + 1)} />
              <span className="flex-1 text-cu-body font-bold text-action-strong">Open, send a Fourth Call</span>
              <Link href={fourthCallHref} className="shrink-0 rounded-chip border border-ink-hairline-3 text-ink font-bold text-[10.5px] px-3 py-1.5 whitespace-nowrap transition-cu-state hover:bg-ink-hairline-1">
                Find a 4th →
              </Link>
            </div>
          )}
        </Card>

        {error && <Meta tone="action">{errorCopy(error)}</Meta>}

        {!sessionStarted && windowOpen && rotationButton}
        {!sessionStarted && !windowOpen && (
          <Meta as="p" className="text-center">
            RSVPs open {formatCountdown(windowOpensMs - now)} from now
          </Meta>
        )}
        {lateCancelSheet}
      </>
    );
  }

  return (
    <>
      <Card padded={false} className="overflow-hidden">
        {/* Circle-colour accent along the top — identity, not action. */}
        <span aria-hidden className="block h-1" style={{ background: circleColour(circleId, circleColourProp) }} />
        <div className="flex items-center gap-2.5 px-4 py-3 bg-ink-hairline-1">
          <CircleEmblem seed={circleId} name={circleName} emblem={circleEmblem} colour={circleColourProp} px={28} />
          <div className="flex-1 min-w-0">
            <p className="text-cu-card-title text-ink truncate">{circleName}</p>
            <p className="text-cu-meta text-ink-muted">This week · {weekLabel}</p>
          </div>
          <p className={`font-mono tabular-nums font-bold text-[10.5px] whitespace-nowrap ${openCount === 0 ? "text-win" : "text-action-strong"}`}>
            {openCount === 0 ? `FULL · ${slots} OF ${slots}` : `${openCount} SPOT${openCount > 1 ? "S" : ""} OPEN`}
          </p>
        </div>

        <div className="px-4 pt-1.5">
          <div className="flex items-center gap-2.5 py-2.5 border-b border-ink-hairline-1">
            <PlayerLink userId={viewerUserId} className="flex items-center gap-2.5 flex-1 min-w-0">
              <Avatar src={viewerAvatarUrl} name={viewerDisplayName} size="sm" />
              <span className="flex-1 text-cu-body font-bold text-ink truncate">
                {viewerDisplayName} <span className="font-normal text-ink-muted">(you)</span>
              </span>
            </PlayerLink>
            {glassFor(viewerUserId) !== undefined && (
              <Fact size="sm" tone="muted" className="whitespace-nowrap">
                {formatGlass(glassFor(viewerUserId))}
              </Fact>
            )}
            <Chip tone={youChip.tone}>{youChip.label}</Chip>
          </div>

          {others.map((p) => (
            <div key={p.userId} className="flex items-center gap-2.5 py-2.5 border-b border-ink-hairline-1">
              <PlayerLink userId={p.userId} isGuest={guestByUserId?.[p.userId]} className="flex items-center gap-2.5 flex-1 min-w-0">
                <Avatar src={p.avatarUrl} name={p.displayName} size="sm" />
                <span className="flex-1 text-cu-body font-bold text-ink truncate">{p.displayName}</span>
              </PlayerLink>
              {glassFor(p.userId) !== undefined && (
                <Fact size="sm" tone="muted" className="whitespace-nowrap">
                  {formatGlass(glassFor(p.userId))}
                </Fact>
              )}
              <Chip tone="positive">In ✓</Chip>
            </div>
          ))}

          {Array.from({ length: openSlots }, (_, i) => (
            <div key={`open-${i}`} className="flex items-center gap-2.5 py-2.5 last:pb-3">
              {/* Row order is: your own row (1), each confirmed `other` (2..1+others.length), then the open slots — so this one's own number is 2 + others.length + i, not a hardcoded "4" (the prototype's only mockup happens to show exactly one open slot, the 4th, which is why "4" looked right for every case). */}
              <DashedSlot size="sm" pulse={i === 0} label={String(2 + others.length + i)} />
              {i === 0 && canSendFourthCall ? (
                <>
                  <span className="flex-1 text-cu-body font-bold text-action-strong">Open, send a Fourth Call</span>
                  <Link
                    href={fourthCallHref}
                    className="shrink-0 rounded-chip border border-ink-hairline-3 text-ink font-bold text-[10.5px] px-3 py-1.5 whitespace-nowrap transition-cu-state hover:bg-ink-hairline-1"
                  >
                    Find a 4th →
                  </Link>
                </>
              ) : (
                <span className="flex-1 text-cu-secondary text-ink-muted">open</span>
              )}
            </div>
          ))}
        </div>

        {reserves.length > 0 && (
          <div className="bg-ink-hairline-1 px-4 py-3">
            <p className="text-cu-secondary font-extrabold tracking-[0.12em] text-ink-muted">RESERVE QUEUE</p>
            <div className="flex flex-col gap-2 mt-2">
              {reserves.map((r, i) => (
                <div key={r.userId} className="flex items-center gap-2.5">
                  <span className="font-mono tabular-nums text-[11px] text-ink-muted w-3">{i + 1}</span>
                  <PlayerLink userId={r.userId} isGuest={guestByUserId?.[r.userId]} className="flex items-center gap-2.5 flex-1 min-w-0">
                    <Avatar src={r.avatarUrl} name={r.displayName} size="xs" />
                    <span className="flex-1 text-cu-secondary font-semibold text-ink truncate">
                      {r.displayName}
                      {r.userId === viewerUserId && <span className="text-action"> (you)</span>}
                    </span>
                  </PlayerLink>
                  {i === 0 && <span className="font-mono text-[10px] text-win">auto-promotes ✓</span>}
                </div>
              ))}
            </div>
            <Meta as="p" className="mt-2 leading-relaxed">
              if anyone drops, {reserves[0]!.displayName} is in automatically, everyone gets told
            </Meta>
          </div>
        )}
      </Card>

      {error && <Meta tone="action">{errorCopy(error)}</Meta>}

      {!sessionStarted && windowOpen && (
        <div className="flex gap-2">
          <Button
            size="lg"
            className="flex-[2]"
            variant={viewerHoldsSlot || viewerReserved ? "strong" : "primary"}
            style={viewerHoldsSlot ? { background: "var(--color-win)", color: "var(--color-action-contrast)" } : undefined}
            pending={pending}
            onClick={() => sendRsvp(viewerHoldsSlot || viewerReserved ? "out" : "in")}
          >
            {viewerHoldsSlot ? "You're in ✓" : viewerReserved ? "Reserved ✓" : "I'm in"}
          </Button>
          {(viewerHoldsSlot || viewerReserved) && (
            <Button size="lg" variant="destructiveQuiet" className="flex-1" pending={pending} onClick={() => sendRsvp("out")}>
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
      {lateCancelSheet}
    </>
  );
}
