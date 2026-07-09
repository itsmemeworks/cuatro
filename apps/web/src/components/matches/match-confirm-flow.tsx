"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card, Fact } from "@/components/ui";
import type { LedgerEvent, MatchOutcome } from "@cuatro/glass";

export type Team = "A" | "B";
export type MatchStatus = "pending_confirmation" | "verified" | "disputed" | "void";

type Phase = "idle" | "arriving" | "sealed";

function fmtDelta(delta: number): string {
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;
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
  if (outcome === "walkover") return "Recorded as a walkover — no one's Glass rating moved.";
  return "No games were played — no one's Glass rating moved.";
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
  teamAName,
  teamBName,
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
  teamAName: string;
  teamBName: string;
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
    return (
      <div className="animate-cu-seal rounded-button bg-win-tint border border-win/40 p-4 text-center flex flex-col gap-2.5">
        <p className="text-cu-body font-extrabold text-win">Result sealed — written to both Ledgers</p>
        <div className="flex justify-center gap-6">
          {[teamAEvents, teamBEvents].map((events, i) => (
            <div key={i} className="flex flex-col gap-1">
              {events.map((ev) => (
                <Fact key={ev.playerId} size="sm" weight="semibold" tone={ratingStillHidden(ev.explanation) ? "muted" : ev.delta >= 0 ? "win" : "loss"}>
                  {ratingStillHidden(ev.explanation)
                    ? `${players[ev.playerId] ?? "Player"} — Glass still building`
                    : `${players[ev.playerId] ?? "Player"} ${fmtDelta(ev.delta)} → ${ev.ratingAfter.toFixed(2)}`}
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
              {isViewerRow && confirmed && " — you confirmed"}
            </span>
            {confirmed ? (
              <span className={`text-cu-card-title font-bold text-win ${arriving ? "animate-cu-arrive" : ""}`}>✓</span>
            ) : isViewerRow && canAct ? (
              <div className="flex gap-2">
                <form action={disputeAction}>
                  <Button type="submit" variant="destructiveQuiet">
                    Dispute
                  </Button>
                </form>
                <form action={confirmAction}>
                  <Button type="submit" variant="primary">
                    Confirm
                  </Button>
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
