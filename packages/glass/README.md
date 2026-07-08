# @cuatro/glass

The GLASS rating engine for CUATRO. A pure, dependency-free TypeScript library:
give it player states and a verified match, get back new player states and a
human-readable Ledger entry for each player. No I/O, no system clock, no
randomness — every engine function is deterministic given its inputs.

See `../../DESIGN.md` section 2 ("GLASS") for the product spec this implements.

## Install / test

```bash
cd packages/glass
npm install
npm test        # vitest run
npm run build   # tsc -> dist/
npm run typecheck
```

## Public API

```ts
import { createPlayer, processMatch, playerStatus } from "@cuatro/glass";

const alice = createPlayer("alice");                       // Unrated, rating 3.00
const bob = createPlayer("bob", { placementPrior: 3.4 });  // seeded from an imported level

const result = processMatch({
  match: {
    matchId: "m1",
    playedAt: Date.now(),       // caller supplies time — the engine never reads the clock
    teamA: ["alice", "carol"],
    teamB: ["bob", "dave"],
    winner: "A",
    gamesWonA: 12,
    gamesWonB: 7,
    verified: true,             // both teams confirmed the score
  },
  players: { alice, bob, carol, dave },
  recentFixtures: [],           // prior verified matches, for Echo Damping
});

if (result.status === "applied") {
  result.updatedPlayers;  // new PlayerState per player
  result.ledgerEvents;    // one LedgerEvent per player, ready to display
}
```

`processMatch` is the only function that mutates rating state (by returning
new state — nothing is mutated in place). Everything else in the package is a
building block it uses internally and that's also exported for testing/UI use:
`winExpectancy`, `marginMultiplier`, `kFor`, `confidenceMultiplier`,
`echoDamping`, `buildExplanation`.

## The math

### Team rating and win expectancy

A team's rating is the simple average of its two players' hidden ratings.
Win expectancy is standard Elo on that team average:

```
P(A) = 1 / (1 + 10^(-(Ra - Rb) / 0.5))
```

The `0.5` divisor is specified in DESIGN.md and is deliberately steep: a
0.10 rating-point gap already gives ~61.3% win probability (the DESIGN.md
worked example), and a full 1.0-point gap implies ~99%. This matches
Playtomic-style intuition — two teams a full level apart on a 1-7 scale
should have a very predictable outcome — but it also means individual
rating *gaps* larger than about 1.0-1.5 points carry almost no further
statistical information (see "Simulation design" below for why this matters).

### Margin multiplier

```
margin = 1 + (winningTeamGamesShare - 0.5)
```

where `winningTeamGamesShare` is the winning team's share of total games
played in the match (e.g. 12 of 19 → 0.632 → margin ≈ 1.13).

**Design decision — margin is computed once per match and applied to both
teams**, not recomputed per-team from each side's own games-won share. Using
each team's own share would mean a blowout loser's *own* share (e.g. 0.37)
produces a *smaller* multiplier than an even match, which would shrink the
losing team's penalty on a blowout — backwards. A single match-wide margin
means a decisive result amplifies both the winner's gain and the loser's
loss symmetrically, which is what DESIGN.md's own worked example implies
(the same 1.13 margin is used for the winning side; we extend that same
value to the losing side rather than recomputing it).

### K-factor (Placement vs Stable)

- `K = 0.12` for a player's first 3 verified matches (the **Placement
  Trio** — DESIGN.md is explicit that this is exactly 3 matches, not "until
  confidence is high").
- `K = 0.04` from the 4th verified match onward, for life. No resets.

K is per-player, not per-team or per-match: if a Placement player is teamed
with a long-established player, their deltas from the same match differ,
because each is scaled by their own K.

### Confidence and its multiplier

Confidence starts at 0% and grows **+8% per brand-new unique verified
opponent** (not per match — playing the same two opponents twice adds
nothing), capped at 95%.

**Design decision — a continuous confidence-based delta multiplier**, on top
of the Placement/Stable K split. DESIGN.md asks for "K scaled by confidence
and margin" and separately asks (in this build's task brief) that low-
confidence players' ratings move more, with an explicit documented formula.
We use:

```
confidenceMultiplier(confidence) = 1 + (1 - confidence/100) * 0.25
```

At 0% confidence this is 1.25× (a brand-new player's already-elevated
Placement K movements get a further 25% boost); at the 95% cap it's
1.0125× (effectively a no-op). This is deliberately a *small* range —
large enough to matter for a player who's stuck facing only repeat
opponents (still-low confidence after Placement ends), small enough that
it doesn't distort the DESIGN.md worked example, which still rounds to
the spec's own "+0.02" once this multiplier is included (see
`test/engine.test.ts`, "the DESIGN.md worked example").

### Echo Damping

A **fixture** is the same four players on court, regardless of which two
are teamed against which two. Within a trailing 30-day window (relative to
the match being processed — all caller-supplied timestamps, no wall clock),
repeat fixtures decay:

```
multiplier = 0.6 ^ (occurrence - 1)
```

1st meeting = ×1 (full weight), 2nd = ×0.6, 3rd = ×0.36, and so on. The
decay compounds with matchesPlayed/K and confidence — a repeat fixture is
usually *also* a zero-new-opponent match, so it's doubly flagged as
low-information both in the delta and in the (frozen) confidence.

### Rounding and clamping

Every rating is clamped to `[1.00, 7.00]` and rounded to 2 decimal places
after each match. The Ledger's `delta` is defined as
`round2(ratingAfter) - ratingBefore`, computed *after* rounding and
clamping — not the raw unrounded Elo delta — so `ratingBefore + delta`
always exactly equals `ratingAfter`, even at the scale boundaries. This is
asserted directly in the test suite.

## The Ledger and explanations

Every applied match emits one `LedgerEvent` per player:

```ts
{
  playerId, matchId, delta, ratingBefore, ratingAfter,
  confidenceBefore, confidenceAfter,
  factors: { expectancy, margin, echoDamping, kUsed },
  explanation: "+0.02 · beat a slightly weaker pair, comfortable margin · vs b1, b2 (first meeting — full weight)",
}
```

`explanation` is generated by `buildExplanation` (`src/explanation.ts`) from
phrasing buckets:

- **Strength** (opponent avg rating vs your own): evenly-matched (<0.05
  gap) / slightly stronger-or-weaker (<0.3) / stronger-or-weaker (<0.6) /
  much stronger-or-weaker.
- **Margin** (your own team's games-won share): dominant (≥0.8) /
  comfortable (≥0.6) / narrow, when you won; heavy (≤0.2) / narrow (≤0.4) /
  close defeat, when you lost. These thresholds are calibrated so DESIGN.md's
  own "6-3 6-4 = comfortable margin" example holds exactly.
- **Echo**: "first meeting — full weight", or "Nth meeting within 30 days —
  X% weight".

**Design decision — the strength direction is computed honestly from the
rating gap, not copied verbatim from DESIGN.md's flavor text.** DESIGN.md's
own worked example (team A avg 3.90 beats team B avg 3.80) is followed by
sample Ledger copy that reads "beat a slightly *stronger* pair" — but team B
was rated *lower*, i.e. slightly weaker. That's an internal inconsistency in
the spec's illustrative prose, not a deliberate design signal, so this
implementation reports the mathematically honest direction ("slightly
weaker" for that exact scenario) rather than reproducing the contradiction.
See `test/explanation.test.ts`.

## Walkover / retired match policy

Not specified precisely by DESIGN.md, so this build defines and documents
one, enforced by `processMatch`:

| `outcome` | Games played | Result |
|---|---|---|
| `"completed"` (default) | 0 | skipped, `reason: "no-games-played"` |
| `"completed"` | >0 | applied normally |
| `"walkover"` | any | always skipped, `reason: "walkover"` — a no-show is a Reliability signal, not a Glass signal |
| `"retired"` | 0 | skipped, `reason: "retired-no-games"` |
| `"retired"` | >0 | applied normally, using the partial score as the final one — real on-court signal shouldn't be discarded just because the match ended early |

Additionally: `verified: false` always skips with `reason: "unverified"`
before anything else is evaluated — this is the enforcement point for "only
verified matches move ratings." Structurally invalid input (a player
appearing on both teams, negative games, a referenced player with no
matching state) throws, since that's a caller bug, not a business-as-usual
skip.

## Simulation test — design notes

`test/simulation.test.ts` runs 10,000 synthetic matches across 100 agents
with known true skills (1.5-6.5) and asserts two things: (1) ratings
converge to within ±0.2 of true skill on average, and (2) a sandbagger who
only ever plays the same fixed, weak four gains materially less rating than
an honest player of identical true skill who plays a normal, varied match
diet.

Getting (1) to hold required two choices, both explained in long-form in the
test file's header comment and summarized here:

- **Matches are drawn from a "Glass band"** around a random anchor player's
  *current* rating (±0.5, widening only if the local pool is too thin) —
  this is literally DESIGN.md's own Fourth Call level 2 matchmaking rule,
  not an artificial simplification. Fully random pairing across the whole
  1.5-6.5 range produces mostly-saturated matchups (see the win-expectancy
  note above) that stop moving ratings almost immediately.
- **95 of the 100 agents start from a placement prior** (`true skill +
  noise`) rather than a blank 3.00 default — mirroring DESIGN.md's own
  "one-time Playtomic level import" v0 feature. Given how steep the
  specified Elo divisor is, no realistic number of matches lets a
  from-scratch population spread across a full 5-point range using this
  formula; real products solve this with an imported prior, so the
  simulation does too.

The 5 agents used for the sandbagging check (a sandbagger, its 3 fixed weak
partners, and its "honest twin" of identical true skill) deliberately start
blank instead, so there's real distance to climb and the gain comparison is
meaningful: in the seeded run this repo ships, the honest twin climbs from
3.00 to ~5.05 (its true skill is 5.00) while the sandbagger — capped at 3
lifetime unique opponents and crushed by Echo Damping after only a handful
of repeat fixtures — gains about a tenth as much and its confidence caps at
24% (3 opponents × 8%) versus the honest twin's 95%.

The whole simulation uses one seeded PRNG (`test/support/prng.ts`, a small
mulberry32 implementation — not part of the public package, since the
engine itself is never randomized) so results are bit-for-bit reproducible.

## Other tests

- `test/rating-math.test.ts` — expectancy, margin, K selection, the
  confidence multiplier, Echo Damping's occurrence counting and 30-day
  window boundary, fixture-key order-independence.
- `test/explanation.test.ts` — every phrasing bucket, the DESIGN.md worked
  example's exact wording, ordinal formatting for repeat meetings, custom
  display names.
- `test/engine.test.ts` — the DESIGN.md worked example reproduced end to
  end (+0.02 / -0.02), Placement→Stable K transition at exactly the 4th
  match, Unrated→Rated transition at exactly the 3rd match, confidence
  growth and its cap, Echo Damping applied through `processMatch` (not just
  the underlying math function), the walkover/retired policy table above,
  rating clamps at both ends of the scale, and that `processMatch` never
  mutates its input.
