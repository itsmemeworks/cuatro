/**
 * The wide overlay's "what happens if this seals" hint (design step 4's
 * coral-bordered block). It runs @cuatro/glass's OWN processMatch on a
 * synthetic four — never a reimplementation of any rule — and reads the
 * viewer's ledger event out of the result. The other three players' hidden
 * state (confidence, matches played, opponents faced) doesn't influence the
 * viewer's own delta, so public ratings are all it needs for them; the
 * viewer's real state arrives from the server as RosterContext.viewerGlass.
 *
 * Honesty gates — returns null (no preview, never a made-up number) when:
 * - the viewer, or anyone on court, has no PUBLIC Glass rating yet (the
 *   hidden mid-Trio rating never leaves the server), or
 * - the entered score doesn't determine a winner, or
 * - the engine itself would skip the match (no games played).
 * The preview is still "about": a sub swapped in after the preview renders
 * can change the fixture, and the seal recomputes everything server-side.
 */
import { processMatch, PLACEMENT_TRIO_SIZE, type FixtureOccurrence, type PlayerState } from "@cuatro/glass";

export interface PreviewPlayer {
  id: string;
  /** PUBLIC rating (null until the Placement Trio completes). */
  rating: number | null;
}

export interface PreviewViewerGlass {
  rating: number | null;
  confidencePct: number;
  verifiedMatchCount: number;
  opponentsFaced: readonly string[];
  recentFixtures: readonly FixtureOccurrence[];
}

export interface SealPreviewInput {
  viewerId: string;
  viewerGlass: PreviewViewerGlass;
  teamA: readonly [PreviewPlayer, PreviewPlayer];
  teamB: readonly [PreviewPlayer, PreviewPlayer];
  sets: readonly { a: number; b: number }[];
  /** The session's start time (epoch ms) — what recordMatch stamps as playedAt, so Echo Damping previews on the same clock. */
  playedAtMs: number;
}

export interface SealPreview {
  expectedWinPct: number;
  delta: number;
  ratingAfter: number;
  confidenceBeforePct: number;
  confidenceAfterPct: number;
  won: boolean;
}

/** Same set/games tie-break order as matches-db's computeWinner, minus its 0-0 fallback (a preview never guesses). */
function previewWinner(sets: readonly { a: number; b: number }[]): "A" | "B" | null {
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
  if (setsA !== setsB) return setsA > setsB ? "A" : "B";
  if (gamesA !== gamesB) return gamesA > gamesB ? "A" : "B";
  return null;
}

export function previewSeal(input: SealPreviewInput): SealPreview | null {
  const four = [...input.teamA, ...input.teamB];
  if (new Set(four.map((p) => p.id)).size !== 4) return null;
  if (four.some((p) => p.rating == null)) return null;
  if (input.viewerGlass.rating == null) return null;

  const viewerTeam: "A" | "B" | null = input.teamA.some((p) => p.id === input.viewerId)
    ? "A"
    : input.teamB.some((p) => p.id === input.viewerId)
      ? "B"
      : null;
  if (!viewerTeam) return null;

  const winner = previewWinner(input.sets);
  if (!winner) return null;

  let gamesWonA = 0;
  let gamesWonB = 0;
  for (const s of input.sets) {
    gamesWonA += s.a;
    gamesWonB += s.b;
  }

  const players: Record<string, PlayerState> = {};
  for (const p of four) {
    players[p.id] =
      p.id === input.viewerId
        ? {
            playerId: p.id,
            rating: input.viewerGlass.rating,
            confidence: input.viewerGlass.confidencePct,
            matchesPlayed: input.viewerGlass.verifiedMatchCount,
            opponentsFaced: [...input.viewerGlass.opponentsFaced],
          }
        : {
            // Their rating is public and shapes the team averages; their
            // confidence/history only shape THEIR delta, which the preview
            // never shows — placeholders keep the engine happy without
            // pretending to know anything hidden.
            playerId: p.id,
            rating: p.rating!,
            confidence: 50,
            matchesPlayed: PLACEMENT_TRIO_SIZE,
            opponentsFaced: [],
          };
  }

  const result = processMatch({
    match: {
      matchId: "seal-preview",
      playedAt: input.playedAtMs,
      teamA: [input.teamA[0].id, input.teamA[1].id],
      teamB: [input.teamB[0].id, input.teamB[1].id],
      winner,
      gamesWonA,
      gamesWonB,
      verified: true,
      outcome: "completed",
    },
    players,
    recentFixtures: [...input.viewerGlass.recentFixtures],
  });
  if (result.status !== "applied") return null;

  const ev = result.ledgerEvents!.find((e) => e.playerId === input.viewerId);
  if (!ev) return null;

  return {
    // The event is the viewer's own, so its expectancy is already their team's.
    expectedWinPct: Math.round(ev.factors.expectancy * 100),
    delta: ev.delta,
    ratingAfter: ev.ratingAfter,
    confidenceBeforePct: Math.round(ev.confidenceBefore),
    confidenceAfterPct: Math.round(ev.confidenceAfter),
    won: winner === viewerTeam,
  };
}

/** The design's one-line phrasing: "Expected win 38%. A win here moves you about +0.05, confidence 78% to 80%". */
export function sealPreviewLine(p: SealPreview): string {
  const delta = `${p.delta >= 0 ? "+" : ""}${p.delta.toFixed(2)}`;
  const verb = p.won ? "A win here moves you about" : "This one moves you about";
  return `Expected win ${p.expectedWinPct}%. ${verb} ${delta}, confidence ${p.confidenceBeforePct}% to ${p.confidenceAfterPct}%`;
}
