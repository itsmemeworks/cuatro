/**
 * CUATRO design system — JS/TS-side constants that mirror the CSS custom
 * properties defined in `src/app/globals.css`. Source of truth for values is
 * `design/HANDOFF.md`; keep these two files in sync by hand (CSS vars can't
 * be read cheaply on the server, so anything needed in JS — server actions,
 * OG image generation, timers — lives here too).
 */

/**
 * The 8 curated Circle colours. A Circle (a group of regulars) picks one to
 * identify itself across avatars, badges and chat headers. Circle colours
 * never carry actions (that's coral's job) — markers/initials render white
 * on top of them. Order is not meaningful; treat as a palette to assign from.
 */
export const CIRCLE_COLORS = [
  "#3E7BFA",
  "#2FA05A",
  "#E8A33D",
  "#C4562C",
  "#8C6BF0",
  "#3BB8CE",
  "#D65A9E",
  "#8A8578",
] as const;

export type CircleColor = (typeof CIRCLE_COLORS)[number];

/** Deterministically assigns a Circle colour from an id/name so the same Circle always renders the same colour. */
export function circleColorFor(seed: string): CircleColor {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return CIRCLE_COLORS[hash % CIRCLE_COLORS.length];
}

/**
 * Motion durations, mirrored from the `--motion-*` CSS custom properties.
 * Use these in JS when a timer needs to match an animation (e.g. removing a
 * toast from the DOM after its transition finishes).
 */
export const MOTION = {
  /** Colour/copy morphs — RSVP toggle, chip state flips. */
  stateChangeMs: 250,
  /** Things landing — avatar springing into a slot. */
  arriveMs: 380,
  arriveEasing: "cubic-bezier(.34,1.56,.64,1)",
  /** Confirmations rising — both-teams-confirm seal card. */
  sealMs: 450,
  sealDelayMs: 120,
  sealEasing: "cubic-bezier(.22,1,.36,1)",
  /** The Glass pour after the Placement Trio. Reserved — not yet built. */
  revealMs: 1500,
} as const;

/** Toast is shown for 2.1s with a 300ms ease in/out — see `<Toast>` in `components/ui/toast.tsx`. */
export const TOAST_DURATION_MS = 2100;
export const TOAST_TRANSITION_MS = 300;

/** Glass ratings always render to 2 decimal places; unrated players show this. */
export const UNRATED_GLASS_DISPLAY = "?.??";

export function formatGlass(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(2) : UNRATED_GLASS_DISPLAY;
}
