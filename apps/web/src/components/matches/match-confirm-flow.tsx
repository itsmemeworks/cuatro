"use client";

import { useEffect, useRef, useState } from "react";
import { Card, Fact, SubmitButton } from "@/components/ui";
import type { LedgerEvent, MatchOutcome } from "@cuatro/glass";

export type Team = "A" | "B";
export type MatchStatus = "pending_confirmation" | "verified" | "disputed" | "void";

type Phase = "idle" | "arriving" | "sealed";

/**
 * Sign follows the RESULT, not the raw float: the engine never moves a
 * winner down nor a loser up, so the only ambiguous case is a fully
 * Echo-damped 0.00 delta — which must read −0.00 for the losing team,
 * never +0.00 (QA5 finding 1). U+2212 minus. Exported (with sealFactTone)
 * for the seal-card unit tests; match-detail-wide.tsx shares both.
 */
export function fmtSealDelta(delta: number, won: boolean): string {
  return `${won ? "+" : "−"}${Math.abs(delta).toFixed(2)}`;
}

/**
 * The tone of one sealed delta line. `won` comes from the MATCH WINNER
 * (computeWinner over the score, passed down as winnerTeam) — never from
 * the delta's sign, which paints a fully-damped loss win-green (QA5
 * finding 1). Mid-Trio players stay muted regardless.
 */
export function sealFactTone(explanation: string, won: boolean): "muted" | "win" | "loss" {
  return ratingStillHidden(explanation) ? "muted" : won ? "win" : "loss";
}

/**
 * True for a player whose Glass is still mid-Placement-Trio and NOT
 * completing it on this match — matches-db.ts's applyGlassAndPersist writes
 * the literal "Placement match N of 3 — your Glass number stays hidden
 * until the Trio completes" explanation for exactly this case (the
 * trio-completing match instead gets "Placement Trio complete — ..." and a
 * normal post-placement match gets buildExplanation's prose — both of
 * which DO reveal the number, correctly). The seal is the only screen both
 * teams see immediately, so it must honour the same "hidden until revealed"
 * rule as the Ledger and GlassHero rather than leaking the number early.
 */
export function ratingStillHidden(explanation: string): boolean {
  return explanation.startsWith("Placement match");
}

/**
 * A verified match with zero Ledger rows means the Glass engine skipped it
 * outright — @cuatro/glass's README "Walkover / retired policy": every
 * walkover is skipped regardless of games played, and a "retired" outcome
 * is only skipped when it ended with zero games (matches-db.ts's
 * applyGlassAndPersist still flips the match to "verified" in this case, so
 * without this check the seal card would render "written to both Ledgers"
 * over two silently-empty columns — indistinguishable from a rendering bug).
 * Exported so the copy is unit-testable without mounting the component —
 * see test/match-confirm-flow.test.ts.
 */
export function glassSkipNote(outcome: MatchOutcome, ledgerEventCount: number): string | null {
  if (ledgerEventCount > 0) return null;
  if (outcome === "walkover") return "Recorded as a walkover. Legs, weather, or life, no one's Glass rating moved and no story needed.";
  return "No games were played, so no one's Glass rating moved.";
}

/**
 * The confirmation + seal state machine for one match (design/HANDOFF.md's
 * "both-teams-confirm" signature moment, exact choreography in
 * CUATRO-Directions.dc.html turn 8b): second confirmation pops, a 700ms
 * beat, then the seal card rises showing BOTH teams' deltas together —
 * never one team first.
 *
 * Reacts purely to the `status`/`confirmedTeams` props changing rather than
 * to the realtime event directly — the page already renders a
 * `<LiveRefresh sessionId=.../>` that calls `router.refresh()` on any match
 * broadcast, which re-fetches this match's real status server-side and
 * flows back down as new props here. That single mechanism covers both the
 * counterparty (who only ever learns about the change this way) and the
 * person who just clicked Confirm themselves (whose own server-action
 * submission triggers the same prop refresh) — one code path, both parties
 * see the identical choreography.
 */
export function MatchConfirmFlow({
  status,
  outcome,
  friendly = false,
  teamAName,
  teamBName,
  winnerTeam,
  confirmedTeams,
  viewerTeam,
  canAct,
  ledgerEvents,
  players,
  teamAPlayerIds,
  teamBPlayerIds,
  confirmAction,
  disputeAction,
}: {
  status: MatchStatus;
  outcome: MatchOutcome;
  /** FRIENDLIES: a friendly match seals like any other but never moves Glass — the seal card says so instead of showing empty Ledger columns. */
  friendly?: boolean;
  teamAName: string;
  teamBName: string;
  /** computeWinner over the match's score — the seal card's W/L truth (see sealFactTone). */
  winnerTeam: Team;
  confirmedTeams: Team[];
  viewerTeam: Team | null;
  canAct: boolean;
  ledgerEvents: readonly LedgerEvent[] | null;
  players: Record<string, string>;
  teamAPlayerIds: [string, string];
  teamBPlayerIds: [string, string];
  confirmAction: (formData: FormData) => void;
  disputeAction: (formData: FormData) => void;
}) {
  const [phase, setPhase] = useState<Phase>(status === "verified" ? "sealed" : "idle");
  const [justConfirmed, setJustConfirmed] = useState<Team[]>([]);
  const prevStatusRef = useRef(status);
  const prevConfirmedRef = useRef(confirmedTeams);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    const prevConfirmed = prevConfirmedRef.current;
    prevStatusRef.current = status;
    prevConfirmedRef.current = confirmedTeams;

    if (prevStatus !== "verified" && status === "verified") {
      const newlyConfirmed = confirmedTeams.filter((t) => !prevConfirmed.includes(t));
      setJustConfirmed(newlyConfirmed.length > 0 ? newlyConfirmed : confirmedTeams);
      setPhase("arriving");
      const t = setTimeout(() => {
        setPhase("sealed");
        if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(70); // one deep haptic, on the seal only
      }, 700);
      return () => clearTimeout(t);
    }
    if (status === "verified") setPhase("sealed");
  }, [status, confirmedTeams]);

  if (status === "disputed") {
    // Never red-alarm styling — a dispute is a quiet fact, not a punishment.
    return (
      <Card>
        <p className="text-cu-body font-semibold text-ink">This result is disputed.</p>
        <p className="text-cu-secondary text-ink-muted mt-1">
          No one&apos;s Glass rating moved. Sort it out and record it again if the score was wrong.
        </p>
      </Card>
    );
  }

  if (phase === "sealed" && ledgerEvents) {
    // FRIENDLIES: a friendly match seals with zero Ledger rows on purpose (the
    // rating gate skipped the Glass engine). Say that plainly — never fall
    // through to glassSkipNote's "no games were played" (games WERE played, the
    // game was just friendly) or to the two-blank-columns seal card.
    if (friendly) {
      return (
        <Card>
          <p className="text-cu-body font-semibold text-ink">Result sealed.</p>
          <p className="text-cu-secondary text-ink-muted mt-1">
            A friendly, so no one&apos;s Glass rating moved. It still counts for Reliability and shows in your history.
          </p>
        </Card>
      );
    }

    const skipNote = glassSkipNote(outcome, ledgerEvents.length);
    if (skipNote) {
      // Same quiet-fact framing as the disputed card above — a skipped
      // engine run is a neutral outcome, not something to dress up as a
      // celebratory seal with two blank columns underneath it.
      return (
        <Card>
          <p className="text-cu-body font-semibold text-ink">Result sealed.</p>
          <p className="text-cu-secondary text-ink-muted mt-1">{skipNote}</p>
        </Card>
      );
    }

    const teamAEvents = ledgerEvents.filter((e) => teamAPlayerIds.includes(e.playerId));
    const teamBEvents = ledgerEvents.filter((e) => teamBPlayerIds.includes(e.playerId));
    const sides = [
      { events: teamAEvents, won: winnerTeam === "A" },
      { events: teamBEvents, won: winnerTeam === "B" },
    ];
    return (
      <div className="animate-cu-seal rounded-button bg-win-tint border border-win/40 p-4 text-center flex flex-col gap-2.5">
        <p className="text-cu-body font-extrabold text-win">Result sealed, written to both Ledgers</p>
        <div className="flex justify-center gap-6">
          {sides.map(({ events, won }, i) => (
            <div key={i} className="flex flex-col gap-1">
              {events.map((ev) => (
                <Fact key={ev.playerId} size="sm" weight="semibold" tone={sealFactTone(ev.explanation, won)}>
                  {ratingStillHidden(ev.explanation)
                    ? `${players[ev.playerId] ?? "Player"}, Glass still building`
                    : `${players[ev.playerId] ?? "Player"} ${fmtSealDelta(ev.delta, won)} → ${ev.ratingAfter.toFixed(2)}`}
                </Fact>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const teams: { team: Team; name: string }[] = [
    { team: "A", name: teamAName },
    { team: "B", name: teamBName },
  ];

  return (
    <Card className="flex flex-col gap-3">
      <p className="text-cu-secondary font-extrabold tracking-[0.12em] text-ink-muted">CONFIRMATION</p>
      {teams.map(({ team, name }) => {
        const confirmed = confirmedTeams.includes(team);
        const arriving = phase === "arriving" && justConfirmed.includes(team);
        const isViewerRow = viewerTeam === team;
        return (
          <div key={team} className="flex items-center gap-2.5">
            <span className="text-cu-body font-semibold text-ink flex-1">
              {name}
              {isViewerRow && confirmed && ", you confirmed"}
            </span>
            {confirmed ? (
              <span className={`text-cu-card-title font-bold text-win ${arriving ? "animate-cu-arrive" : ""}`}>✓</span>
            ) : isViewerRow && canAct ? (
              <div className="flex gap-2">
                {/* SubmitButtons show the in-flight spinner (no silent clicks, Pete 2026-07-11). */}
                <form action={disputeAction}>
                  <SubmitButton variant="destructiveQuiet">Dispute</SubmitButton>
                </form>
                <form action={confirmAction}>
                  <SubmitButton variant="primary">Confirm</SubmitButton>
                </form>
              </div>
            ) : (
              <span className="text-cu-secondary text-ink-muted">waiting…</span>
            )}
          </div>
        );
      })}
    </Card>
  );
}
