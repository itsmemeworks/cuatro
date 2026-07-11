"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Sheet } from "./sheet";

/**
 * Layer-A progressive disclosure (see the UX-writing audit §2): a branded
 * term rendered inline with a hairline **dotted underline in ink-muted** —
 * never coral, so it can never read as the screen's action — that opens a
 * bottom Sheet explaining the term in plain language. One plain line, one
 * "why it's built this way" line, no CTA. Wrap only the FIRST occurrence of a
 * term on a screen; the Ledger already proved players like transparency on
 * tap, not walls of text.
 *
 * Copy for each term lives in GLOSSARY below so it stays consistent (and
 * translatable) everywhere the term appears.
 */
export interface GlossaryEntry {
  /** Sheet title — the term spelled out in full (e.g. "Confidence", not "conf"). */
  term: string;
  /** One plain-language line: what it is. */
  plain: string;
  /** One line in the brand's transparent voice: why it's built this way. */
  why: string;
}

export const GLOSSARY = {
  friendly: {
    term: "Friendly",
    plain: "A friendly game still records the score and confirms like any other, and it counts for your Reliability and who you've played with. It just never moves anyone's Glass rating.",
    why: "Some circles want to keep score without the pressure of a rating on the line. Friendly is that switch, set per game, so a knockabout stays a knockabout.",
  },
  rotation: {
    term: "The Rotation",
    plain: "When it's on, you tap 'I'm available' instead of grabbing a slot, and CUATRO picks a fair four each week, rotating who sits out.",
    why: "Working out who sits out is the quiet weekly puzzle in every five-strong group. This makes it automatic and explainable, so it's never personal: fewest recent games plays first.",
  },
  playedWith: {
    term: "Played with",
    plain: "The people you've shared a court with in a confirmed game. When your Circle is short, the Fourth Call reaches them before it looks any wider.",
    why: "The four you already know comes first. Only games both teams confirmed count, so it's people you've genuinely played with, not passing strangers.",
  },
  localRing: {
    term: "Local Ring",
    plain: "When your Circle can't fill a game, the Fourth Call reaches nearby players at your level who've said they're up for games.",
    why: "The game finds the player, not the other way round. Level-matched, venue-based, and only people who opted to be findable.",
  },
  board: {
    term: "The Board",
    plain: "Open slots in games near you, like a club notice board.",
    why: "Distances are rough on purpose and it only shows games from Circles that chose to post. No strangers scraping your schedule.",
  },
  openDoor: {
    term: "Open Door",
    plain: "How findable your Circle is near other players. Open means anyone nearby can find you and knock, Invite only means you still show up and your open games take asks but joining is by invite link, and Private means you're hidden from discovery.",
    why: "You decide how far the door opens, and a Private Circle never appears at all. Nothing beyond a few public facts is shared until someone's actually in.",
  },
  glass: {
    term: "Glass",
    plain: "Your padel rating, on a 1.00–7.00 scale, like a Playtomic level, but every point of it is explained.",
    why: "Nothing's ever a guess: tap any result in the Ledger to see exactly why your number moved, not just that it went up or down.",
  },
  confidence: {
    term: "Confidence",
    plain: "How sure Glass is about your number.",
    why: "It climbs as you play different opponents, not just more games. Variety tells us more than volume.",
  },
  reliability: {
    term: "Reliability",
    plain: "How often you turn up after saying you're in. It's about showing up, not your rating; how sure Glass is about your number is called 'confidence'.",
    why: "Cancelling inside 24h dents it; cancelling early is free. It's social proof, not surveillance.",
  },
  placementTrio: {
    term: "Placement Trio",
    plain: "Your first 3 confirmed games.",
    why: "Play them and your Glass number appears. No sign-up quiz, no guessing.",
  },
  echoDamping: {
    term: "Echo Damping",
    plain: "Playing the same four again counts for a little less each time.",
    why: "So nobody can farm an easy rating by rematching the same beatable opponents.",
  },
  winExpectancy: {
    term: "Win expectancy",
    plain: "How likely Glass thought your pair was to win, before the match.",
    why: "Beating a pair you were expected to lose to moves your number more than beating one you should have.",
  },
  marginWeight: {
    term: "Margin weight",
    plain: "Winning big moves your Glass a little more than scraping through.",
    why: "The scoreline counts, but only a little. A win is a win first.",
  },
  ratingStep: {
    term: "Rating step",
    plain: "How far a single result can move your Glass.",
    why: "Bigger while you're new and still being placed, smaller once your number has settled.",
  },
  glassPoured: {
    term: "Glass poured",
    plain: "The moment your Placement Trio completes and your Glass rating is revealed, with the confidence it starts at.",
    why: "A rating should arrive as a moment, not leak out as a guess. Poured means it's real: earned on court, explained in your Ledger from day one.",
  },
  bookedOn: {
    term: "Booked on",
    plain: "Where the court booking and payment actually live, Playtomic, a club site, wherever. CUATRO points at it and stays out of the money.",
    why: "A booked-on game never touches the Tab. The split only appears when an organiser adds a court cost instead.",
  },
  bench: {
    term: "The Bench",
    plain: "Sitting out this week. The bench banks priority, whoever sits goes first next week.",
    why: "If a spot opens it is offered down the bench one at a time, consent only. Nobody gets pulled into a game they didn't say yes to.",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

export function InfoTerm({
  term,
  label,
  className = "",
}: {
  /** Which glossary entry to explain. */
  term: GlossaryKey;
  /** Visible text override (e.g. the "GLASS" eyebrow, or the "conf" abbreviation). Defaults to the full term. */
  label?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const g = GLOSSARY[term];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`What is ${g.term}?`}
        className={`underline decoration-dotted decoration-1 underline-offset-[3px] cursor-pointer ${className}`}
        style={{ textDecorationColor: "var(--color-ink-muted)" }}
      >
        {label ?? g.term}
        <span aria-hidden className="ml-0.5 text-[0.85em] text-ink-muted align-baseline">
          &#9432;
        </span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={g.term}>
        <p className="text-cu-body text-ink">{g.plain}</p>
        <p className="text-cu-secondary text-ink-muted mt-2">{g.why}</p>
      </Sheet>
    </>
  );
}
