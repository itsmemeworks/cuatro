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
  glass: {
    term: "Glass",
    plain: "Your padel rating, on a 1.00–7.00 scale — like a Playtomic level, but every point of it is explained.",
    why: "Nothing's ever a guess: tap any result in the Ledger to see exactly why your number moved — not just that it went up or down.",
  },
  confidence: {
    term: "Confidence",
    plain: "How sure Glass is about your number.",
    why: "It climbs as you play different opponents, not just more games — variety tells us more than volume.",
  },
  reliability: {
    term: "Reliability",
    plain: "How often you turn up after saying you're in — it's about showing up, not your rating; how sure Glass is about your number is called 'confidence'.",
    why: "Cancelling inside 24h dents it; cancelling early is free — it's social proof, not surveillance.",
  },
  placementTrio: {
    term: "Placement Trio",
    plain: "Your first 3 confirmed games.",
    why: "Play them and your Glass number appears — no sign-up quiz, no guessing.",
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
    why: "The scoreline counts, but only a little — a win is a win first.",
  },
  ratingStep: {
    term: "Rating step",
    plain: "How far a single result can move your Glass.",
    why: "Bigger while you're new and still being placed, smaller once your number has settled.",
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
