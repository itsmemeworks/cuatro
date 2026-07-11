"use client";

import { useMemo, useState } from "react";
import { Avatar, Card, Fact, SubmitButton } from "@/components/ui";
import { formatGlass } from "@/lib/design";
import { recordMatchAction } from "@/server/matches-actions";

export interface ResultEntryPlayer {
  id: string;
  displayName: string;
  /** Null when the player is still unrated (Placement Trio not complete) — averages fall back gracefully. */
  rating: number | null;
  avatarUrl?: string | null;
  /** True for a guest with no device to confirm on — an existing guest row OR a `pending` sub. Used to flag a team that can't seal the result. */
  isGuest?: boolean;
  /** A named substitute with no `users` row yet — `id` is a client-side token, resolved into a real guest by recordMatch. Carried to the server in the `guests` field. */
  pending?: boolean;
}

type TeamPair = [string, string];
type SetScore = { a: string; b: string }; // teamA's / teamB's games — the wire format recordMatchAction expects, regardless of which team the viewer is on

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

/** A pairing slot rendered as plain bold name text that's still a real `<select>` underneath (native picker on tap) — the reassign-partner functionality the prototype's fixed mock doesn't need, kept but visually quiet rather than a full form control (design/DESIGN-AUDIT.md R1). */
function PairingSelect({
  value,
  onChange,
  players,
  viewerId,
  muted,
}: {
  value: string;
  onChange: (id: string) => void;
  players: ResultEntryPlayer[];
  viewerId: string;
  muted?: boolean;
}) {
  return (
    // Dotted underline + a small ▾ so it reads as an editable picker, not
    // static text — users who need to fix an auto-assigned pairing have to
    // realise it's tappable (design/DESIGN-AUDIT.md R1).
    <span className="inline-flex items-center gap-0.5">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`bg-transparent border-none p-0 appearance-none font-bold text-cu-body underline decoration-dotted decoration-ink-hairline-4 underline-offset-[3px] ${muted ? "text-ink-muted" : "text-ink"}`}
      >
        {players.map((p) => (
          <option key={p.id} value={p.id}>
            {p.id === viewerId ? "You" : p.displayName}
          </option>
        ))}
      </select>
      <span aria-hidden className="text-[9px] text-ink-muted leading-none">▾</span>
    </span>
  );
}

/** One set's score from the viewer's-team-first perspective, e.g. "7–5" — two small inline number inputs so it composes into the prototype's "7–5 · 6–4" Archivo-800 look while staying real, editable inputs. */
function SetScoreInput({
  yourGames,
  theirGames,
  onYourChange,
  onTheirChange,
}: {
  yourGames: string;
  theirGames: string;
  onYourChange: (v: string) => void;
  onTheirChange: (v: string) => void;
}) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <input
        type="number"
        min={0}
        max={99}
        value={yourGames}
        onChange={(e) => onYourChange(e.target.value)}
        placeholder="–"
        className="w-[18px] shrink-0 text-center bg-transparent border-none p-0 font-extrabold text-[22px] text-ink tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <span className="font-extrabold text-[22px] text-ink">–</span>
      <input
        type="number"
        min={0}
        max={99}
        value={theirGames}
        onChange={(e) => onTheirChange(e.target.value)}
        placeholder="–"
        className="w-[18px] shrink-0 text-center bg-transparent border-none p-0 font-extrabold text-[22px] text-ink tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </span>
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
  const [sets, setSets] = useState<SetScore[]>([
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
  // Your team is whichever holds the viewer — defaults to A if the viewer
  // somehow isn't in either (shouldn't happen: the four are the session's
  // own confirmed slot-holders), so the row order never breaks.
  const viewerTeam: "A" | "B" = teamB.includes(viewerId) && !teamA.includes(viewerId) ? "B" : "A";
  const viewerAvg = viewerTeam === "A" ? avgA : avgB;
  const opponentAvg = viewerTeam === "A" ? avgB : avgA;
  const showEncouragement = winner === viewerTeam && viewerAvg != null && opponentAvg != null && opponentAvg > viewerAvg;

  const yourPair = viewerTeam === "A" ? teamA : teamB;
  const oppPair = viewerTeam === "A" ? teamB : teamA;

  // The reporter auto-confirms their own team, so the seal only stalls if the
  // OTHER team has nobody with an account to confirm — both slots are guests
  // (existing guest rows or just-added subs). Recording is still allowed (the
  // match sits pending, no Glass moves until it's confirmed); this only warns.
  const oppNeedsAccount = oppPair.every((id) => byId.get(id)?.isGuest);

  // Substitutes with no account yet travel to the server as their client
  // token in the team slots, paired with their name here so recordMatch can
  // mint the guest rows in the same transaction that writes the match.
  const pendingGuests = players.filter((p) => p.pending).map((p) => ({ token: p.id, name: p.displayName }));

  function updateSet(index: number, side: "your" | "their", value: string) {
    setSets((prev) =>
      prev.map((s, idx) => {
        if (idx !== index) return s;
        const aIsYours = viewerTeam === "A";
        if (side === "your") return aIsYours ? { ...s, a: value } : { ...s, b: value };
        return aIsYours ? { ...s, b: value } : { ...s, a: value };
      }),
    );
  }

  function setPairSlot(team: "A" | "B", slot: 0 | 1, id: string) {
    const setter = team === "A" ? setTeamA : setTeamB;
    setter((prev) => prev.map((v, i) => (i === slot ? id : v)) as TeamPair);
  }

  return (
    <form action={recordMatchAction} className="flex flex-col gap-4">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="teamA1" value={teamA[0]} />
      <input type="hidden" name="teamA2" value={teamA[1]} />
      <input type="hidden" name="teamB1" value={teamB[0]} />
      <input type="hidden" name="teamB2" value={teamB[1]} />
      {pendingGuests.length > 0 && <input type="hidden" name="guests" value={JSON.stringify(pendingGuests)} />}
      {sets.map((s, i) => (
        <span key={i}>
          <input type="hidden" name={`set${i + 1}_a`} value={s.a} />
          <input type="hidden" name={`set${i + 1}_b`} value={s.b} />
        </span>
      ))}

      <Card className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <div className="flex">
              {yourPair.map((id, i) => {
                const p = byId.get(id);
                return <Avatar key={i} src={p?.avatarUrl} name={id === viewerId ? "You" : (p?.displayName ?? "?")} size="sm" ring="surface" overlap={i > 0} />;
              })}
            </div>
            <span className="flex-1 flex items-center gap-1 text-cu-body font-bold text-ink min-w-0">
              <PairingSelect value={yourPair[0]} onChange={(id) => setPairSlot(viewerTeam, 0, id)} players={players} viewerId={viewerId} />
              <span>&amp;</span>
              <PairingSelect value={yourPair[1]} onChange={(id) => setPairSlot(viewerTeam, 1, id)} players={players} viewerId={viewerId} />
            </span>
          </div>
          <div className="flex justify-end">
            {sets.map((_, i) => (
              <span key={i} className="flex items-center">
                {i > 0 && <span className="mx-1 text-ink-muted text-[15px]">·</span>}
                <SetScoreInput
                  yourGames={viewerTeam === "A" ? sets[i]!.a : sets[i]!.b}
                  theirGames={viewerTeam === "A" ? sets[i]!.b : sets[i]!.a}
                  onYourChange={(v) => updateSet(i, "your", v)}
                  onTheirChange={(v) => updateSet(i, "their", v)}
                />
              </span>
            ))}
          </div>
        </div>

        <div className="h-px bg-ink-hairline-1" />

        <div className="flex items-center gap-2.5">
          <div className="flex">
            {oppPair.map((id, i) => {
              const p = byId.get(id);
              return <Avatar key={i} src={p?.avatarUrl} name={p?.displayName ?? "?"} size="sm" ring="surface" overlap={i > 0} />;
            })}
          </div>
          <span className="flex-1 flex items-center gap-1 text-cu-body font-bold text-ink-muted">
            <PairingSelect
              value={oppPair[0]}
              onChange={(id) => setPairSlot(viewerTeam === "A" ? "B" : "A", 0, id)}
              players={players}
              viewerId={viewerId}
              muted
            />
            <span>&amp;</span>
            <PairingSelect
              value={oppPair[1]}
              onChange={(id) => setPairSlot(viewerTeam === "A" ? "B" : "A", 1, id)}
              players={players}
              viewerId={viewerId}
              muted
            />
          </span>
          <Fact size="sm" tone="muted">
            avg {formatGlass(opponentAvg)}
          </Fact>
        </div>

        {showEncouragement && (
          <div className="rounded-button bg-win-tint text-win text-center py-2.5 px-3 text-cu-body font-semibold">
            You beat a stronger pair
          </div>
        )}

        <label className="flex items-center gap-2 text-cu-secondary text-ink-muted mt-1">
          <input type="checkbox" name="retired" value="retired" checked={retired} onChange={(e) => setRetired(e.target.checked)} className="h-4 w-4" />
          Match was retired early (injury, ran out of time, etc.)
        </label>
      </Card>

      {oppNeedsAccount && (
        <p className="text-cu-meta text-ink-muted text-center px-4">
          No one on the other team has a Cuatro account yet, so they can&apos;t confirm this. You can still send it, it
          waits until someone on their side joins, or swap one of them for a regular player above.
        </p>
      )}

      {/* Guard the empty submit: recordMatchAction silently no-ops with no
          sets and no retired flag, so keep the button disabled until there's
          something real to send. */}
      {/* SubmitButton shows the in-flight spinner (no silent clicks, Pete 2026-07-11). */}
      <SubmitButton variant="strong" size="lg" fullWidth disabled={filledSets.length === 0 && !retired}>
        Send to both teams
      </SubmitButton>
      {filledSets.length === 0 && !retired && (
        <p className="text-cu-meta text-ink-muted text-center">Enter at least one set, or mark it retired.</p>
      )}
    </form>
  );
}
