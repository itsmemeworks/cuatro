import type { LedgerEntryView } from "@/server/matches-db";

/**
 * Pure derivations for the Profile stat row (design/HANDOFF.md screen 8's
 * "W–L / streak / best-win stat row ... compute from existing match history
 * data"). Every Ledger row carries `won`, derived server-side from the
 * match's actual winner (matches-db.ts getLedger) — NEVER classify from the
 * delta's sign here: the engine round2s deltas, so a fully Echo-damped
 * narrow loss lands as 0.00 and a sign check calls it a win (QA5 finding 1).
 * The rows also carry the exact inputs the rating engine used, so nothing
 * here needs a new server query.
 */

export interface StreakInfo {
  kind: "W" | "L" | null;
  count: number;
}

/** `entriesNewestFirst` must be sorted newest-first — the shape store.getLedger() already returns. */
export function computeStreak(entriesNewestFirst: LedgerEntryView[]): StreakInfo {
  if (entriesNewestFirst.length === 0) return { kind: null, count: 0 };
  const kind: "W" | "L" = entriesNewestFirst[0]!.won ? "W" : "L";
  let count = 0;
  for (const e of entriesNewestFirst) {
    if (e.won !== (kind === "W")) break;
    count++;
  }
  return { kind, count };
}

/**
 * The strongest opponent average a player has beaten, run in reverse from
 * @cuatro/glass's win-expectancy formula: expectedWin = 1/(1+10^(-(Rself -
 * Ropp)/0.5)), so Ropp = Rself + 0.5*log10(1/expectedWin - 1). Every
 * winning Ledger row already stores both `factors.expectedWin` and the
 * player's own `ratingBefore` — the same two numbers the engine used to
 * size the win — so the opponent's rating at match time falls straight out
 * of the algebra. Returns null if there's no eligible win (a first-ever
 * event has no `ratingBefore` to anchor the inversion on).
 */
export function computeBestWin(entries: LedgerEntryView[]): number | null {
  let best: number | null = null;
  for (const e of entries) {
    if (!e.won || e.ratingBefore == null) continue;
    const p = e.factors.expectedWin;
    if (p <= 0 || p >= 1) continue;
    const opponentRating = e.ratingBefore + 0.5 * Math.log10(1 / p - 1);
    if (best === null || opponentRating > best) best = opponentRating;
  }
  return best;
}
