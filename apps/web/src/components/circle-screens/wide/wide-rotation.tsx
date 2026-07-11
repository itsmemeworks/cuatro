"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Avatar, Button, DashedSlot, Fact, Meta } from "@/components/ui";
import { errorCopy } from "@/lib/error-copy";
import { formatGlass } from "@/lib/design";
import { PlayerLink } from "@/components/games/roster";
import type { SessionCardPlayer } from "@/components/games/SessionCard";
import type { RotationCardView } from "@/components/games/StandingGameWeekCard";
import { LateCancelSheet, isLateCancel } from "@/components/games/late-cancel-sheet";
import { benchStatus, cascadeStatus, lockedHeaderLabel, sessionStamp, shortDayTime, thisWeekHeading } from "./wide-rotation-model";

/*
 * THE ROTATION at wide widths (design/CUATRO-Web-LATEST.dc.html "Circle ·
 * Rotation game"): the SAME rotation data the phone card renders, re-laid as
 * the design's two-column anatomy. Pre-lock the left column is the
 * availability ask + the lock countdown, the right column the fair-share
 * ranked list; locked, the left is THE FOUR + THE BENCH and the right the
 * consent-offer cascade (organiser view). No rotation logic lives here — the
 * server decides everything, these panels only present it and post the same
 * /rsvp actions the phone card does.
 *
 * Realtime: the phone StandingGameWeekCard stays mounted (CSS-hidden at 900+)
 * and holds the session's single realtime subscription; its router.refresh()
 * re-renders these panels with fresh server data, so they subscribe to
 * nothing themselves.
 */

export type RotationWideProps = {
  sessionId: string;
  slots: number;
  /** Epoch ms. */
  startsAtMs: number;
  /** Epoch ms the RSVP window opens. */
  rsvpWindowOpensAtMs: number;
  viewerUserId: string;
  viewerStatus: "in" | "reserve" | "out" | null;
  rotation: RotationCardView;
  canSendFourthCall: boolean;
  fourthCallHref: string;
  glassByUserId?: Record<string, number | null>;
  guestByUserId?: Record<string, boolean>;
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

const PANEL = "bg-surface border border-ink-hairline-1 rounded-[20px]";
const SECTION_HEADER = "px-[18px] py-[11px] bg-ink-hairline-1 font-sans font-extrabold text-[10px] tracking-[0.14em] text-ink-muted";
const ROW = "flex items-center gap-[11px] px-[18px] py-[11px] border-b border-ink-hairline-1 last:border-b-0";

function PlayerName({ p, viewerUserId }: { p: SessionCardPlayer; viewerUserId: string }) {
  return (
    <span className="font-sans font-bold text-[12.5px] text-ink truncate">
      {p.displayName}
      {p.userId === viewerUserId && <span className="font-normal text-ink-muted"> (you)</span>}
    </span>
  );
}

/**
 * Left column. Pre-lock: the availability ask + lock countdown. Locked:
 * THE FOUR + THE BENCH. Owns the RSVP posts (same endpoint and late-cancel
 * confirm as the phone card).
 */
export function RotationWideMain({
  sessionId,
  slots,
  startsAtMs,
  rsvpWindowOpensAtMs,
  viewerUserId,
  viewerStatus,
  rotation,
  canSendFourthCall,
  fourthCallHref,
  glassByUserId,
  guestByUserId,
}: RotationWideProps) {
  const router = useRouter();
  const [now, setNow] = useState<number>(() => Date.now());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lateConfirm, setLateConfirm] = useState<null | "out" | "unavailable">(null);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const windowOpen = now >= rsvpWindowOpensAtMs && now < startsAtMs;
  const sessionStarted = now >= startsAtMs;
  const viewerHoldsSlot = viewerStatus === "in";
  const viewerReserved = viewerStatus === "reserve";
  const provisional = !rotation.locked;
  const short = rotation.lineup.length < slots;

  function sendRsvp(action: "in" | "out" | "available" | "unavailable") {
    if ((action === "out" || action === "unavailable") && viewerHoldsSlot && isLateCancel(startsAtMs, now)) {
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
      router.refresh();
    } catch {
      setError("network_error");
    } finally {
      setPending(false);
    }
  }

  const glassFor = (userId: string) => (glassByUserId ? glassByUserId[userId] ?? null : undefined);

  const rsvpButtons = provisional ? (
    <div className="flex gap-[9px]">
      <Button
        size="lg"
        className="flex-[2]"
        variant={rotation.viewerAvailable ? "strong" : "primary"}
        pending={pending}
        onClick={() => sendRsvp(rotation.viewerAvailable ? "unavailable" : "available")}
      >
        {rotation.viewerAvailable ? "You're available ✓" : "Available"}
      </Button>
      {rotation.viewerAvailable && (
        <Button size="lg" variant="destructiveQuiet" className="flex-1" pending={pending} onClick={() => sendRsvp("unavailable")}>
          Not this week
        </Button>
      )}
    </div>
  ) : (
    (viewerHoldsSlot || viewerReserved) && (
      <div className="flex gap-[9px]">
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

  if (provisional) {
    return (
      <div className="flex flex-col gap-3">
        <div className={`${PANEL} p-[18px]`}>
          <p className="font-sans font-extrabold text-[13px] text-ink">{thisWeekHeading(startsAtMs)}</p>
          <p className="font-mono text-[11px] leading-relaxed text-ink-muted mt-1.5">
            {rotation.coldStart
              ? "no history yet, so the first four to say yes play. The Rotation starts picking the fairest four once this game has some"
              : "nobody holds a slot. CUATRO picks a fair four, fewest recent plays first"}
          </p>
          {!sessionStarted && windowOpen && <div className="mt-3.5">{rsvpButtons}</div>}
          {!sessionStarted && !windowOpen && (
            <Meta as="p" className="mt-3.5">
              RSVPs open {formatCountdown(rsvpWindowOpensAtMs - now)} from now
            </Meta>
          )}
          {error && (
            <Meta as="p" tone="action" className="mt-2">
              {errorCopy(error)}
            </Meta>
          )}
        </div>

        <div className={`${PANEL} px-[18px] py-4 flex items-center gap-3.5`}>
          <div className="flex-1 min-w-0">
            <p className="font-sans font-extrabold text-[16px] text-ink">
              {rotation.mode === "unlimited" ? "Lineup re-picks to kickoff" : `Lineup locks ${shortDayTime(rotation.locksAtMs)}`}
            </p>
            <p className="font-mono text-[10.5px] text-ink-muted mt-1">
              {rotation.mode === "unlimited"
                ? "the fairest four recomputes as availability changes"
                : "the fairest four get the nod, everyone gets told"}
            </p>
          </div>
          {rotation.mode === "limited" && (
            <span className="font-mono tabular-nums font-bold text-[14px] text-action-strong whitespace-nowrap">
              in {formatCountdown(rotation.locksAtMs - now)}
            </span>
          )}
        </div>
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
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className={`${PANEL} overflow-hidden`}>
        <div className="flex items-center justify-between px-[18px] py-[11px] bg-win-tint">
          <span className="font-sans font-extrabold text-[10px] tracking-[0.14em] text-win">
            {lockedHeaderLabel(rotation.locked ? rotation.locksAtMs : null)}
          </span>
          <span className="font-mono text-[10px] text-ink-muted">{sessionStamp(startsAtMs)}</span>
        </div>
        {rotation.lineup.map((p) => (
          <div key={p.userId} className={ROW}>
            <PlayerLink userId={p.userId} isGuest={guestByUserId?.[p.userId]} className="flex items-center gap-[11px] flex-1 min-w-0">
              <Avatar src={p.avatarUrl} name={p.displayName} size="sm" />
              <PlayerName p={p} viewerUserId={viewerUserId} />
            </PlayerLink>
            {glassFor(p.userId) !== undefined && (
              <Fact size="sm" tone="muted" className="whitespace-nowrap">
                {formatGlass(glassFor(p.userId))}
              </Fact>
            )}
            <span className="font-sans font-bold text-[12px] text-win">✓</span>
          </div>
        ))}
        {short &&
          Array.from({ length: slots - rotation.lineup.length }, (_, i) => (
            <div key={`open-${i}`} className={ROW}>
              <DashedSlot size="sm" pulse={i === 0} label={String(rotation.lineup.length + 1 + i)} />
              {i === 0 && canSendFourthCall ? (
                <>
                  <span className="flex-1 font-sans font-bold text-[12.5px] text-action-strong">Open, send a Fourth Call</span>
                  <Link
                    href={fourthCallHref}
                    className="shrink-0 rounded-chip border border-ink-hairline-3 text-ink font-bold text-[10.5px] px-3 py-1.5 whitespace-nowrap transition-cu-state hover:bg-ink-hairline-1"
                  >
                    Find a 4th →
                  </Link>
                </>
              ) : (
                <span className="flex-1 font-sans text-[12.5px] text-ink-muted">open</span>
              )}
            </div>
          ))}
      </div>

      {rotation.sitting.length > 0 && (
        <div className={`${PANEL} overflow-hidden`}>
          <div className={SECTION_HEADER}>THE BENCH</div>
          {rotation.sitting.map((p, i) => {
            const status = benchStatus(i);
            return (
              <div key={p.userId} className={`${ROW} last:border-b-0`}>
                <span className="font-mono tabular-nums font-bold text-[11px] text-ink-muted w-3.5">{i + 1}</span>
                <PlayerLink userId={p.userId} isGuest={guestByUserId?.[p.userId]} className="flex items-center gap-[11px] flex-1 min-w-0">
                  <Avatar src={p.avatarUrl} name={p.displayName} size="sm" />
                  <PlayerName p={p} viewerUserId={viewerUserId} />
                </PlayerLink>
                <Fact size="sm" tone={status.tone} className="whitespace-nowrap">
                  {status.label}
                </Fact>
              </div>
            );
          })}
          <p className="px-[18px] pb-3 pt-1 font-mono text-[10px] leading-relaxed text-ink-muted">
            sitting out banks priority. The bench goes first next week
          </p>
        </div>
      )}

      {!sessionStarted && windowOpen && rsvpButtons}
      {error && (
        <Meta as="p" tone="action">
          {errorCopy(error)}
        </Meta>
      )}
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
    </div>
  );
}

/**
 * Right column. Pre-lock: the fair-share ranked availability list. Locked and
 * a spot open: the consent-offer cascade, organiser view only — sit-outs are
 * never force-drafted, and members don't need to watch each other dither.
 */
export function RotationWideAside({
  slots,
  viewerUserId,
  rotation,
  viewerIsOrganiser,
  offerUserId,
  guestByUserId,
}: {
  slots: number;
  viewerUserId: string;
  rotation: RotationCardView;
  viewerIsOrganiser: boolean;
  /** Who currently holds the live consent offer (server-decided), null when none. */
  offerUserId: string | null;
  guestByUserId?: Record<string, boolean>;
}) {
  const provisional = !rotation.locked;

  if (provisional) {
    // The design's single ranked list: the provisional four first (that IS the
    // fair-share ranking), then the sit-outs in offer order.
    const ranked = [...rotation.lineup, ...rotation.sitting];
    return (
      <div className={`${PANEL} overflow-hidden`}>
        <div className="flex items-center justify-between px-[18px] py-[11px] bg-ink-hairline-1">
          <span className="font-sans font-extrabold text-[10px] tracking-[0.14em] text-ink-muted">AVAILABLE · {rotation.available.length}</span>
          <span className="font-mono text-[10px] text-ink-muted">{rotation.coldStart ? "first come this week" : "ranked by fair share"}</span>
        </div>
        {ranked.length === 0 ? (
          <Meta as="p" className="px-[18px] py-4">
            No one&apos;s marked available yet. Say you&apos;re in and you&apos;ll show here.
          </Meta>
        ) : (
          ranked.map((p, i) => {
            const r = rotation.reasons[p.userId];
            return (
              <div key={p.userId} className={ROW}>
                <span className="font-mono tabular-nums font-bold text-[11px] text-ink-muted w-3.5">{i + 1}</span>
                <PlayerLink userId={p.userId} isGuest={guestByUserId?.[p.userId]} className="flex items-center gap-[11px] flex-1 min-w-0">
                  <Avatar src={p.avatarUrl} name={p.displayName} size="sm" />
                  <PlayerName p={p} viewerUserId={viewerUserId} />
                </PlayerLink>
                {r && (
                  <Fact size="sm" tone={!rotation.coldStart && r.plays === 0 ? "win" : "muted"} className="whitespace-nowrap">
                    {r.satOutLast ? `sat out last week · ${r.reason}` : r.reason}
                  </Fact>
                )}
              </div>
            );
          })
        )}
      </div>
    );
  }

  const short = rotation.lineup.length < slots;
  if (!short || rotation.sitting.length === 0 || !viewerIsOrganiser) return null;

  const holderIndex = offerUserId ? rotation.sitting.findIndex((p) => p.userId === offerUserId) : -1;
  const holderFirstName = holderIndex >= 0 ? rotation.sitting[holderIndex]!.displayName.split(" ")[0]! : null;

  return (
    <div className={`${PANEL} overflow-hidden`}>
      <div className={SECTION_HEADER}>OFFER CASCADE · ORGANISER VIEW</div>
      {rotation.sitting.map((p, i) => {
        const status = cascadeStatus(i, holderIndex, holderFirstName);
        return (
          <div key={p.userId} className={ROW}>
            <span className="font-mono tabular-nums font-bold text-[11px] text-ink-muted w-3.5">{i + 1}</span>
            <PlayerLink userId={p.userId} isGuest={guestByUserId?.[p.userId]} className="flex items-center gap-[11px] flex-1 min-w-0">
              <Avatar src={p.avatarUrl} name={p.displayName} size="xs" />
              <span className={`font-sans font-bold text-[12px] truncate ${i === holderIndex ? "text-ink" : "text-ink-muted"}`}>
                {p.displayName}
                {p.userId === viewerUserId && <span className="font-normal"> (you)</span>}
              </span>
            </PlayerLink>
            <Fact size="sm" tone={status.tone} className="whitespace-nowrap">
              {status.label}
            </Fact>
          </div>
        );
      })}
      <p className="px-[18px] pb-3 pt-1 font-mono text-[10px] leading-relaxed text-ink-muted">
        sit-outs are never force-drafted. Consent only, one at a time
      </p>
    </div>
  );
}
