"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Avatar, Fact, SubmitButton } from "@/components/ui";
import type { LedgerEvent, MatchOutcome } from "@cuatro/glass";
import { fmtSealDelta, glassSkipNote, ratingStillHidden, sealFactTone, type MatchStatus, type Team } from "@/components/matches/match-confirm-flow";
import { FriendlyBadge } from "@/components/matches/friendly-badge";
import { DEFAULT_TZ, formatDate, localDateKey } from "@/lib/time";

/*
 * The wide (>=900px) match detail: the design overlay's step 5 grown into a
 * page. The reporter's side sees "Sent. Waiting for the other side" plus a
 * PREVIEW of what the opposing side is looking at; the opposing side sees
 * the real coral RESULT NEEDS YOUR CONFIRM panel; the seal shows BOTH teams'
 * deltas together, never one team first (design/HANDOFF.md's both-teams-
 * confirm law — same choreography as the phone MatchConfirmFlow: second
 * confirmation arrives, a 700ms beat, then the seal card). Rendered as the
 * `hidden min-[900px]:block` sibling of the untouched phone tree; props flow
 * from the same server fetch, and LiveRefresh on the page re-fetches on any
 * match broadcast for both parties.
 */

type Phase = "idle" | "arriving" | "sealed";

interface PlayerBits {
  name: string;
  avatarUrl: string | null;
}

/**
 * "today" / "last night" / "yesterday" / "Thu 3 Jul", tz-explicit (F2 §5):
 * the day buckets and the 17:00 "last night" check are computed in
 * DEFAULT_TZ (this component receives no venue/circle tz), never via
 * Date#getHours/local-midnight maths — the Fly runtime is TZ=UTC.
 */
function whenLine(startsAtMs: number, venueName: string | null): string {
  const tz = DEFAULT_TZ;
  const now = Date.now();
  const key = localDateKey(startsAtMs, tz);
  let when: string;
  if (key === localDateKey(now, tz)) when = "today";
  else if (key === localDateKey(now - 24 * 60 * 60 * 1000, tz)) {
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date(startsAtMs)));
    when = hour >= 17 ? "last night" : "yesterday";
  } else when = formatDate(startsAtMs, tz);
  return venueName ? `${when} at ${venueName}` : when;
}

export function MatchDetailWide({
  status,
  outcome,
  friendly,
  sets,
  winnerTeam,
  viewerTeam,
  viewerHasConfirmed,
  canAct,
  teamA,
  teamB,
  teamAIds,
  teamBIds,
  viewerId,
  ledgerEvents,
  playerNames,
  startsAtMs,
  venueName,
  circleName,
  sessionId,
  confirmAction,
  disputeAction,
}: {
  status: MatchStatus;
  outcome: MatchOutcome;
  friendly: boolean;
  sets: { a: number; b: number }[];
  /** computeWinner over the match's score — the seal card's W/L truth (see sealFactTone). */
  winnerTeam: Team;
  viewerTeam: Team | null;
  viewerHasConfirmed: boolean;
  canAct: boolean;
  teamA: [PlayerBits, PlayerBits];
  teamB: [PlayerBits, PlayerBits];
  teamAIds: [string, string];
  teamBIds: [string, string];
  viewerId: string;
  ledgerEvents: readonly LedgerEvent[] | null;
  playerNames: Record<string, string>;
  startsAtMs: number;
  venueName: string | null;
  circleName: string;
  sessionId: string;
  confirmAction: (formData: FormData) => void;
  disputeAction: (formData: FormData) => void;
}) {
  const [phase, setPhase] = useState<Phase>(status === "verified" ? "sealed" : "idle");
  const prevStatusRef = useRef(status);

  // Same live-seal beat as the phone MatchConfirmFlow: when props flip to
  // verified underneath us (LiveRefresh refetch), hold 700ms, then seal.
  // The haptic fires only when THIS tree is the visible one (min-width 900),
  // so the hidden phone sibling can't double-buzz the same seal.
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prevStatus !== "verified" && status === "verified") {
      setPhase("arriving");
      const t = setTimeout(() => {
        setPhase("sealed");
        if (
          typeof navigator !== "undefined" &&
          navigator.vibrate &&
          typeof window !== "undefined" &&
          window.matchMedia("(min-width: 900px)").matches
        ) {
          navigator.vibrate(70);
        }
      }, 700);
      return () => clearTimeout(t);
    }
    if (status === "verified") setPhase("sealed");
  }, [status]);

  const viewerPair = viewerTeam === "B" ? teamB : teamA;
  const oppPair = viewerTeam === "B" ? teamA : teamB;
  const viewerOnB = viewerTeam === "B";
  const scoreForViewer = sets.map((s) => (viewerOnB ? `${s.b}–${s.a}` : `${s.a}–${s.b}`)).join(" ");
  const noScore = sets.length === 0;

  const pairName = (pair: [PlayerBits, PlayerBits], pairIds: [string, string], withYou: boolean) =>
    pairIds
      .map((id, i) => (withYou && id === viewerId ? "you" : pair[i].name))
      .join(" & ");

  const viewerPairIds = viewerOnB ? teamBIds : teamAIds;
  const oppPairIds = viewerOnB ? teamAIds : teamBIds;
  const oppFirstName = oppPair[0].name.split(" ")[0] ?? oppPair[0].name;

  return (
    <div className="max-w-[720px] mx-auto px-[30px]">
      <div className="bg-surface border border-ink-hairline-2 rounded-[22px] overflow-hidden">
        {/* header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-ink-hairline-1">
          <span className="font-sans font-extrabold text-[11px] tracking-[0.14em] text-ink-muted">MATCH RESULT</span>
          {friendly && <FriendlyBadge />}
          <span className="flex-1" />
          <span className="font-mono text-[10px] text-ink-muted/70">{circleName}</span>
        </div>

        <div className="px-5 pt-[18px] pb-5 flex flex-col gap-4">
          {/* the score, viewer's pair first — the step-4 summary carried over */}
          <div className="bg-ground border border-ink-hairline-2 rounded-[18px] p-[18px]">
            <div className="flex items-center gap-2.5">
              <div className="flex">
                {viewerPair.map((p, i) => (
                  <Avatar key={i} src={p.avatarUrl} name={viewerPairIds[i] === viewerId ? "You" : p.name} size="sm" ring="surface" overlap={i > 0} />
                ))}
              </div>
              <span className="flex-1 font-sans font-bold text-[13px] text-ink truncate">
                {viewerPairIds.map((id, i) => (id === viewerId ? "You" : viewerPair[i].name)).join(" & ")}
              </span>
              <span className="font-sans font-extrabold text-[24px] text-ink tabular-nums whitespace-nowrap">
                {noScore ? (outcome === "walkover" ? "walkover" : "retired") : sets.map((s) => (viewerOnB ? `${s.b}–${s.a}` : `${s.a}–${s.b}`)).join(" · ")}
              </span>
            </div>
            <div className="flex items-center gap-2.5 mt-2.5">
              <div className="flex">
                {oppPair.map((p, i) => (
                  <Avatar key={i} src={p.avatarUrl} name={p.name} size="sm" ring="surface" overlap={i > 0} />
                ))}
              </div>
              <span className="flex-1 font-sans font-bold text-[13px] text-ink-muted truncate">{oppPair.map((p) => p.name).join(" & ")}</span>
              <span className="font-mono text-[10.5px] text-ink-muted">{whenLine(startsAtMs, venueName)}</span>
            </div>
          </div>

          {status === "disputed" && (
            <div className="bg-ground border border-ink-hairline-2 rounded-[18px] px-[18px] py-4">
              <p className="font-sans font-semibold text-[13px] text-ink">This result is disputed.</p>
              <p className="font-sans text-[12px] text-ink-muted mt-1">
                No one&apos;s Glass rating moved. Sort it out and record it again if the score was wrong.
              </p>
            </div>
          )}

          {status === "pending_confirmation" && !canAct && (
            <>
              {/* the reporter's side (or a teammate): sent, waiting */}
              <div className="bg-surface-feature border border-ink-hairline-3 rounded-[18px] px-[18px] py-4">
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full border-2 border-ink-on-feature-hairline box-border" aria-hidden />
                  <span className="flex-1 font-sans font-extrabold text-[13px] text-ink-on-feature">
                    {viewerHasConfirmed ? "Sent. Waiting for the other side" : "Waiting on confirmations"}
                  </span>
                  <span className="font-mono text-[10px] text-ink-on-feature-muted">
                    {noScore ? outcome : scoreForViewer} · {friendly ? "friendly" : "rated"}
                  </span>
                </div>
                <p className="font-mono text-[11px] leading-relaxed text-ink-on-feature-muted mt-2">
                  {viewerTeam == null
                    ? "both teams confirm it themselves. Glass moves only then"
                    : friendly
                      ? `any real member of ${oppFirstName}'s team can seal it. A friendly seals the same way, Glass just stays put`
                      : `any real member of ${oppFirstName}'s team can seal it. Glass moves only then. Friendlies seal the same way, Glass untouched`}
                </p>
              </div>

              {viewerTeam != null && viewerHasConfirmed && (
                <>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-ink-hairline-1" />
                    <span className="font-mono text-[10px] text-ink-muted/60">HOW {oppFirstName.toUpperCase()}&apos;S SIDE SEES IT</span>
                    <div className="flex-1 h-px bg-ink-hairline-1" />
                  </div>
                  {/* a non-interactive PREVIEW of the opposing panel — their confirm buttons only work on their screen */}
                  <div className="bg-surface-feature border-[1.5px] border-action rounded-[18px] px-[18px] py-4 pointer-events-none select-none" aria-hidden>
                    <p className="font-sans font-extrabold text-[10px] tracking-[0.12em] text-action-on-feature-label">RESULT NEEDS YOUR CONFIRM</p>
                    <p className="font-sans font-bold text-[14px] leading-normal text-ink-on-feature mt-1.5">
                      {pairName(viewerPair, viewerPairIds, false)} report {noScore ? `a ${outcome}` : scoreForViewer} over you, {whenLine(startsAtMs, venueName)}
                    </p>
                    <div className="flex gap-2 mt-3">
                      <span className="flex-[2] bg-action text-action-contrast rounded-xl text-center py-3 font-sans font-extrabold text-[13px]">
                        Confirm result
                      </span>
                      <span className="flex-1 border border-ink-on-feature-hairline text-ink-on-feature-muted rounded-xl text-center py-3 font-sans font-semibold text-[12px]">
                        Dispute
                      </span>
                    </div>
                  </div>
                </>
              )}

              <div className="flex">
                <span className="flex-1" />
                <Link
                  href={`/games/${sessionId}`}
                  className="border border-ink-hairline-4 text-ink rounded-[13px] px-[26px] py-3 font-sans font-bold text-[13px] transition-cu-state hover:bg-ink-hairline-1 active:opacity-80"
                >
                  Done
                </Link>
              </div>
            </>
          )}

          {status === "pending_confirmation" && canAct && (
            <div className="bg-surface-feature border-[1.5px] border-action rounded-[18px] px-[18px] py-4">
              <p className="font-sans font-extrabold text-[10px] tracking-[0.12em] text-action-on-feature-label">RESULT NEEDS YOUR CONFIRM</p>
              <p className="font-sans font-bold text-[14px] leading-normal text-ink-on-feature mt-1.5">
                {pairName(oppPair, oppPairIds, false)} report {noScore ? `a ${outcome}` : sets.map((s) => (viewerOnB ? `${s.a}–${s.b}` : `${s.b}–${s.a}`)).join(" ")}{" "}
                over {pairName(viewerPair, viewerPairIds, true)}, {whenLine(startsAtMs, venueName)}
              </p>
              <div className="flex gap-2 mt-3">
                {/* SubmitButtons: pending spinner while the action runs (mid-wave addendum, no silent clicks). */}
                <form action={confirmAction} className="flex-[2] flex">
                  <SubmitButton variant="primary" fullWidth>
                    Confirm result
                  </SubmitButton>
                </form>
                <form action={disputeAction} className="flex-1 flex">
                  <SubmitButton variant="destructiveQuiet" onFeature fullWidth>
                    Dispute
                  </SubmitButton>
                </form>
              </div>
              <p className="font-mono text-[10px] text-ink-on-feature-muted mt-2.5">
                {friendly ? "a friendly, Glass stays put either way. Reliability still counts" : "your confirm seals it for your whole team. Glass moves for all four"}
              </p>
            </div>
          )}

          {status === "verified" && phase !== "sealed" && (
            <div className="bg-ground border border-ink-hairline-2 rounded-[18px] px-[18px] py-4">
              <p className="font-sans font-semibold text-[13px] text-ink">Both teams confirmed.</p>
            </div>
          )}

          {status === "verified" && phase === "sealed" && ledgerEvents && (
            <SealCard
              friendly={friendly}
              outcome={outcome}
              winnerTeam={winnerTeam}
              ledgerEvents={ledgerEvents}
              playerNames={playerNames}
              teamAIds={teamAIds}
              teamBIds={teamBIds}
            />
          )}

          {status === "verified" && (
            <div className="flex">
              <span className="flex-1" />
              <Link
                href={`/games/${sessionId}`}
                className="border border-ink-hairline-4 text-ink rounded-[13px] px-[26px] py-3 font-sans font-bold text-[13px] transition-cu-state hover:bg-ink-hairline-1 active:opacity-80"
              >
                Done
              </Link>
            </div>
          )}

          {status === "pending_confirmation" && (
            <p className="font-mono text-[10px] text-ink-muted/70 text-center">
              {friendly
                ? "a friendly still gets confirmed by both teams. It counts for Reliability and history, Glass just stays put"
                : "Glass moves only when both teams confirm, no referee, no disputes desk"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The seal, wide: both teams' deltas TOGETHER (never one team first), or the
 * honest quiet card when the engine skipped (friendly / walkover / no games).
 * Copy mirrors the phone MatchConfirmFlow exactly; ratingStillHidden keeps a
 * mid-Trio player's number hidden here just like everywhere else.
 */
function SealCard({
  friendly,
  outcome,
  winnerTeam,
  ledgerEvents,
  playerNames,
  teamAIds,
  teamBIds,
}: {
  friendly: boolean;
  outcome: MatchOutcome;
  winnerTeam: Team;
  ledgerEvents: readonly LedgerEvent[];
  playerNames: Record<string, string>;
  teamAIds: [string, string];
  teamBIds: [string, string];
}) {
  if (friendly) {
    return (
      <div className="bg-ground border border-ink-hairline-2 rounded-[18px] px-[18px] py-4">
        <p className="font-sans font-semibold text-[13px] text-ink">Result sealed.</p>
        <p className="font-sans text-[12px] text-ink-muted mt-1">
          A friendly, so no one&apos;s Glass rating moved. It still counts for Reliability and shows in your history.
        </p>
      </div>
    );
  }
  const skipNote = glassSkipNote(outcome, ledgerEvents.length);
  if (skipNote) {
    return (
      <div className="bg-ground border border-ink-hairline-2 rounded-[18px] px-[18px] py-4">
        <p className="font-sans font-semibold text-[13px] text-ink">Result sealed.</p>
        <p className="font-sans text-[12px] text-ink-muted mt-1">{skipNote}</p>
      </div>
    );
  }
  const teamAEvents = ledgerEvents.filter((e) => teamAIds.includes(e.playerId));
  const teamBEvents = ledgerEvents.filter((e) => teamBIds.includes(e.playerId));
  const sides = [
    { events: teamAEvents, won: winnerTeam === "A" },
    { events: teamBEvents, won: winnerTeam === "B" },
  ];
  return (
    <div className="animate-cu-seal rounded-[18px] bg-win-tint border border-win/40 px-[18px] py-4 text-center flex flex-col gap-2.5">
      <p className="font-sans font-extrabold text-[14px] text-win">Result sealed, written to both Ledgers</p>
      <div className="flex justify-center gap-10">
        {sides.map(({ events, won }, i) => (
          <div key={i} className="flex flex-col gap-1">
            {events.map((ev) => (
              <Fact key={ev.playerId} size="sm" weight="semibold" tone={sealFactTone(ev.explanation, won)}>
                {ratingStillHidden(ev.explanation)
                  ? `${playerNames[ev.playerId] ?? "Player"}, Glass still building`
                  : `${playerNames[ev.playerId] ?? "Player"} ${fmtSealDelta(ev.delta, won)} → ${ev.ratingAfter.toFixed(2)}`}
              </Fact>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
