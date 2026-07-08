"use client";

import { useMemo, useState } from "react";
import { Avatar, Button, Card, Fact, Meta } from "@/components/ui";
import { formatGlass } from "@/lib/design";
import { recordMatchAction } from "@/server/matches-actions";

export interface ResultEntryPlayer {
  id: string;
  displayName: string;
  /** Null when the player is still unrated (Placement Trio not complete) — averages fall back gracefully. */
  rating: number | null;
}

type TeamPair = [string, string];

/**
 * Mirrors matches-db.ts's computeWinner exactly (same set/games tie-break
 * order) so the live encouragement line agrees with what the server will
 * actually decide — but this copy never writes anything; recordMatchAction
 * is still the sole authority once the form submits.
 */
function previewWinner(sets: { a: number; b: number }[]): "A" | "B" | null {
  if (sets.length === 0) return null;
  let setsA = 0;
  let setsB = 0;
  let gamesA = 0;
  let gamesB = 0;
  for (const s of sets) {
    gamesA += s.a;
    gamesB += s.b;
    if (s.a > s.b) setsA++;
    else if (s.b > s.a) setsB++;
  }
  if (setsA === 0 && setsB === 0 && gamesA === 0 && gamesB === 0) return null;
  if (setsA !== setsB) return setsA > setsB ? "A" : "B";
  if (gamesA !== gamesB) return gamesA > gamesB ? "A" : "B";
  return null; // still level — don't guess a winner
}

function TeamRow({
  label,
  slotNames,
  value,
  onChange,
  players,
  avg,
  viewerId,
}: {
  label: string;
  slotNames: [string, string];
  value: TeamPair;
  onChange: (v: TeamPair) => void;
  players: ResultEntryPlayer[];
  avg: number | null;
  viewerId: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex">
        {value.map((id, i) => {
          const p = players.find((pl) => pl.id === id);
          return <Avatar key={i} name={p?.displayName ?? "?"} size="sm" ring="surface" overlap={i > 0} />;
        })}
      </div>
      <div className="flex-1 flex flex-col gap-1">
        <Meta>{label}</Meta>
        <div className="flex gap-1.5">
          {([0, 1] as const).map((i) => (
            <select
              key={i}
              name={slotNames[i]}
              value={value[i]}
              onChange={(e) => {
                const next: TeamPair = [...value];
                next[i] = e.target.value;
                onChange(next);
              }}
              className="flex-1 min-w-0 rounded-button px-2.5 py-2 text-cu-secondary font-bold bg-ground border border-ink-hairline-2 text-ink"
              style={{ minHeight: "var(--touch-target)" }}
            >
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                  {p.id === viewerId ? " (you)" : ""}
                </option>
              ))}
            </select>
          ))}
        </div>
      </div>
      <Fact size="sm" tone="muted">
        avg {formatGlass(avg)}
      </Fact>
    </div>
  );
}

export function ResultEntryForm({
  sessionId,
  players,
  viewerId,
}: {
  sessionId: string;
  players: ResultEntryPlayer[];
  viewerId: string;
}) {
  const [p1, p2, p3, p4] = players;
  const [teamA, setTeamA] = useState<TeamPair>([p1!.id, p2!.id]);
  const [teamB, setTeamB] = useState<TeamPair>([p3!.id, p4!.id]);
  const [sets, setSets] = useState([
    { a: "", b: "" },
    { a: "", b: "" },
    { a: "", b: "" },
  ]);
  const [retired, setRetired] = useState(false);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const avgOf = (ids: TeamPair): number | null => {
    const ratings = ids.map((id) => byId.get(id)?.rating).filter((r): r is number => r != null);
    return ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  };
  const avgA = avgOf(teamA);
  const avgB = avgOf(teamB);

  const filledSets = sets.filter((s) => s.a !== "" && s.b !== "").map((s) => ({ a: Number(s.a), b: Number(s.b) }));
  const winner = previewWinner(filledSets);
  const viewerTeam = teamA.includes(viewerId) ? "A" : teamB.includes(viewerId) ? "B" : null;
  const viewerAvg = viewerTeam === "A" ? avgA : viewerTeam === "B" ? avgB : null;
  const opponentAvg = viewerTeam === "A" ? avgB : viewerTeam === "B" ? avgA : null;
  const showEncouragement =
    viewerTeam != null && winner === viewerTeam && viewerAvg != null && opponentAvg != null && opponentAvg > viewerAvg;

  return (
    <form action={recordMatchAction} className="flex flex-col gap-4">
      <input type="hidden" name="sessionId" value={sessionId} />

      <Card className="flex flex-col gap-3">
        <TeamRow label="Team A" slotNames={["teamA1", "teamA2"]} value={teamA} onChange={setTeamA} players={players} avg={avgA} viewerId={viewerId} />
        <div className="h-px bg-ink-hairline-1" />
        <TeamRow label="Team B" slotNames={["teamB1", "teamB2"]} value={teamB} onChange={setTeamB} players={players} avg={avgB} viewerId={viewerId} />
      </Card>

      <Card className="flex flex-col gap-3">
        <Meta>Score — games per set</Meta>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="text-cu-secondary font-semibold text-ink-muted w-12">Set {i + 1}</span>
            <input
              type="number"
              name={`set${i + 1}_a`}
              min={0}
              max={99}
              value={sets[i]!.a}
              onChange={(e) => setSets((prev) => prev.map((s, idx) => (idx === i ? { ...s, a: e.target.value } : s)))}
              placeholder="—"
              className="w-16 rounded-button px-2 py-2 text-center text-cu-card-title tabular-nums bg-ground border border-ink-hairline-2 text-ink"
              style={{ minHeight: "var(--touch-target)" }}
            />
            <span className="text-ink-muted font-bold">–</span>
            <input
              type="number"
              name={`set${i + 1}_b`}
              min={0}
              max={99}
              value={sets[i]!.b}
              onChange={(e) => setSets((prev) => prev.map((s, idx) => (idx === i ? { ...s, b: e.target.value } : s)))}
              placeholder="—"
              className="w-16 rounded-button px-2 py-2 text-center text-cu-card-title tabular-nums bg-ground border border-ink-hairline-2 text-ink"
              style={{ minHeight: "var(--touch-target)" }}
            />
          </div>
        ))}
        <label className="flex items-center gap-2 text-cu-secondary text-ink-muted mt-1">
          <input
            type="checkbox"
            name="retired"
            value="retired"
            checked={retired}
            onChange={(e) => setRetired(e.target.checked)}
            className="h-4 w-4"
          />
          Match was retired early (injury, ran out of time, etc.)
        </label>
      </Card>

      {showEncouragement && (
        <div className="rounded-button bg-win-tint text-win text-center py-2.5 px-3 text-cu-body font-semibold">
          You beat a stronger pair
        </div>
      )}

      <Button type="submit" size="lg" fullWidth>
        Send to both teams
      </Button>
    </form>
  );
}
