import type { PlayerId } from "./types.js";

export interface ExplanationInput {
  readonly delta: number;
  readonly won: boolean;
  /** This player's own team's average rating before the match. */
  readonly ownTeamRatingAvg: number;
  readonly oppTeamRatingAvg: number;
  /** This player's own team's share of total games won (not the winner's). */
  readonly ownShare: number;
  /** 1 = first meeting. */
  readonly occurrence: number;
  readonly dampingMultiplier: number;
  readonly opponentIds: readonly [PlayerId, PlayerId];
  readonly opponentNames?: Readonly<Record<PlayerId, string>>;
}

/** "a" before a consonant sound, "an" before a vowel sound. Good enough for our fixed phrase set. */
function article(phrase: string): string {
  return /^[aeiou]/i.test(phrase) ? "an" : "a";
}

function describeStrength(ownAvg: number, oppAvg: number): string {
  const gap = oppAvg - ownAvg; // positive => opponents were stronger
  const abs = Math.abs(gap);
  if (abs < 0.05) return "evenly-matched";
  const direction = gap > 0 ? "stronger" : "weaker";
  if (abs < 0.3) return `slightly ${direction}`;
  if (abs < 0.6) return direction;
  return `much ${direction}`;
}

// Thresholds calibrated against DESIGN.md's own worked example: a 6-3 6-4
// win (12/19 games, ~63%) is called a "comfortable margin" there.
function describeMargin(won: boolean, ownShare: number): string {
  if (won) {
    if (ownShare >= 0.8) return "dominant margin";
    if (ownShare >= 0.6) return "comfortable margin";
    return "narrow margin";
  }
  if (ownShare <= 0.2) return "heavy defeat";
  if (ownShare <= 0.4) return "narrow defeat";
  return "close defeat";
}

function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const remainder = n % 100;
  const suffix = suffixes[(remainder - 20) % 10] ?? suffixes[remainder] ?? suffixes[0];
  return `${n}${suffix}`;
}

function describeEcho(occurrence: number, multiplier: number): string {
  if (occurrence <= 1) return "first meeting — full weight";
  const pct = Math.round(multiplier * 100);
  return `${ordinal(occurrence)} meeting within 30 days — ${pct}% weight`;
}

function describeOpponents(ids: readonly [PlayerId, PlayerId], names?: Readonly<Record<PlayerId, string>>): string {
  const label = (id: PlayerId) => names?.[id] ?? id;
  return `${label(ids[0])}, ${label(ids[1])}`;
}

/**
 * Builds a Ledger-ready one-liner, e.g.
 * "+0.02 · beat a slightly stronger pair, comfortable margin · vs J, K (first meeting — full weight)"
 */
export function buildExplanation(input: ExplanationInput): string {
  const sign = input.delta >= 0 ? "+" : "";
  const deltaStr = `${sign}${input.delta.toFixed(2)}`;
  const strengthPhrase = describeStrength(input.ownTeamRatingAvg, input.oppTeamRatingAvg);
  const marginPhrase = describeMargin(input.won, input.ownShare);
  const verb = input.won ? "beat" : "lost to";
  const opponentLabel = describeOpponents(input.opponentIds, input.opponentNames);
  const echoPhrase = describeEcho(input.occurrence, input.dampingMultiplier);

  return `${deltaStr} · ${verb} ${article(strengthPhrase)} ${strengthPhrase} pair, ${marginPhrase} · vs ${opponentLabel} (${echoPhrase})`;
}
