/**
 * Fourth Call side hint copy (GitHub issue #21): the organiser may add an
 * optional "ideally a left-sider" nudge to a Fourth Call. It is DISPLAY COPY
 * ONLY — the hint never filters who sees the call and never gates who can
 * claim (the ladder circle -> played-with -> Local Ring -> public link is
 * untouched by it). Vocab comes from lib/player-attrs.ts so the padel lingo
 * (right = drive, left = backhand) stays single-sourced.
 *
 * Pure strings, no "use client": imported by server pages (fc landing) and
 * client cards alike.
 */
import { courtSide } from "@/lib/player-attrs";

export type FourthCallSideHint = "left" | "right";

export function isFourthCallSideHint(value: unknown): value is FourthCallSideHint {
  return value === "left" || value === "right";
}

/** Short form for card meta lines, e.g. "ideally a left-sider". */
export function sideHintShort(hint: FourthCallSideHint): string {
  return `ideally a ${hint}-sider`;
}

/** Full line for the receive screen and the public /fc landing, e.g. "ideally a left-sider (backhand) · anyone can still claim". */
export function sideHintLine(hint: FourthCallSideHint): string {
  const lingo = courtSide(hint)?.lingo;
  return `${sideHintShort(hint)}${lingo ? ` (${lingo})` : ""} · anyone can still claim`;
}
