/**
 * Pure decisions for Home's game affordances (fix-wave F4, QA8 findings 43/44).
 *
 * THE ROTATION rule (DESIGN.md): on a rotation game the weekly answer is a
 * declaration of availability, never a slot grab — the fairness function picks
 * the four. Pre-lock there are therefore no "spots" to be "open" and nobody is
 * "in": Home must never show bare RSVP chrome ("I'm in", "N spots open") for a
 * pre-lock rotation game, or the same tile can contradict itself (QA8: chip
 * said "You're in ✓" while the slot grid showed four dashed slots, because the
 * provisional lineup derives from 'available' rows only).
 *
 * Kept as pure functions (house test style: node environment, no DOM) and
 * shared by page.tsx's GameRow + the NeedsAnswerCard.
 */
import { formatTime, formatWeekday } from "@/lib/time";

/**
 * Should this session be Home's featured "needs your answer" card?
 * A rotation player who already said "I'm available" holds no committed slot
 * (viewerStatus stays null server-side), but they HAVE answered — never re-ask.
 */
export function needsAnswer(
  s: {
    viewerStatus: "in" | "reserve" | "out" | null;
    rotation: { lockedAt: Date | null; viewerAvailable: boolean } | null;
    rsvpWindowOpensAt: Date;
    startsAtMs: number;
  },
  now: number,
): boolean {
  if (s.viewerStatus !== null) return false;
  if (s.rotation && s.rotation.lockedAt == null && s.rotation.viewerAvailable) return false;
  return now >= s.rsvpWindowOpensAt.getTime() && now < s.startsAtMs;
}

/**
 * The status line + viewer chip for a Home GameRow.
 * - Pre-lock rotation: availability framing, NEVER "N spots open". The chip
 *   also treats a (legacy) committed 'in' as available so the tile can't say
 *   "You're in" next to an empty provisional lineup (QA8's contradiction).
 * - Locked rotation / plain games: slots are literal again, chrome unchanged.
 */
export function gameRowStatus(session: {
  slots: number;
  confirmedCount: number;
  reserveCount: number;
  viewerStatus: "in" | "reserve" | "out" | null;
  rotation?: { locked: boolean; viewerAvailable: boolean; availableCount: number } | null;
}): { line: string; chip: { label: string; kind: "in" | "available" } | null } {
  if (session.rotation && !session.rotation.locked) {
    const n = session.rotation.availableCount;
    return {
      // Count first: the row's status line truncates next to the chip at
      // phone width, and the number is the fact that must survive.
      line: n === 0 ? "rotation on · no one in the mix yet" : `${n} available · rotation picks the four`,
      chip:
        session.rotation.viewerAvailable || session.viewerStatus === "in"
          ? { label: "You're available ✓", kind: "available" }
          : null,
    };
  }
  const open = Math.max(0, session.slots - session.confirmedCount);
  const line =
    (open === 0 ? "court booked" : `${open} spot${open === 1 ? "" : "s"} open`) +
    (session.reserveCount > 0 ? ` · ${session.reserveCount} waiting` : "");
  return {
    line,
    chip: session.viewerStatus === "in" ? { label: "You're in ✓", kind: "in" } : null,
  };
}

/** GameRow's day/time cell, timezone-explicit (QA8: "TUE 19:00" for a 20:00 BST game came from a UTC render on Fly). */
export function gameRowTimeLabels(startsAt: Date | number, timezone: string): { day: string; time: string } {
  return { day: formatWeekday(startsAt, timezone).toUpperCase(), time: formatTime(startsAt, timezone) };
}

/**
 * Which answer the NeedsAnswerCard collects. On a gathering rotation game the
 * yes is "I'm available" (rsvp action `available`), the no is `unavailable`;
 * everywhere else it stays the plain slot RSVP.
 */
export function needsAnswerMode(rotation: { availableCount: number } | null | undefined): {
  yesAction: "in" | "available";
  noAction: "out" | "unavailable";
  yesLabel: string;
  confirmedLabel: string;
  /** "is in" / "is available" — the names line verb. */
  verb: "in" | "available";
} {
  if (rotation) {
    return {
      yesAction: "available",
      noAction: "unavailable",
      yesLabel: "I'm available",
      confirmedLabel: "You're available ✓ · in the mix",
      verb: "available",
    };
  }
  return {
    yesAction: "in",
    noAction: "out",
    yesLabel: "I'm in",
    confirmedLabel: "You're in ✓ · game on",
    verb: "in",
  };
}
