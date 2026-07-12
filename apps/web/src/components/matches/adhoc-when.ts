/**
 * Shared played-when helpers for the ad-hoc record flows (issue #28) — the
 * wide overlay's "When did you play?" step and the phone entry card both
 * resolve the recorder's choice ("just now" / earlier today / yesterday)
 * into an epoch-ms played-at the same way.
 */

export type WhenChoice = { mode: "now" | "today" | "yesterday"; time: string };

/**
 * The chosen played-at as epoch ms, computed in the recorder's device
 * timezone (the best signal we have for where they just played). A time
 * later today clamps to now so "20:00 today" picked at 19:50 can't land in
 * the future; matches-db enforces the same bound server-side.
 */
export function playedAtFromChoice(when: WhenChoice): number {
  if (when.mode === "now") return Date.now();
  const [h, m] = when.time.split(":").map(Number);
  const d = new Date();
  if (when.mode === "yesterday") d.setDate(d.getDate() - 1);
  d.setHours(Number.isFinite(h) ? h! : 20, Number.isFinite(m) ? m! : 0, 0, 0);
  return Math.min(d.getTime(), Date.now());
}

/** Default time-of-day per played-when mode: a couple of hours back for "earlier today", padel prime time for "yesterday". */
export function defaultTimeFor(mode: "today" | "yesterday"): string {
  if (mode === "yesterday") return "20:00";
  const h = Math.max(0, new Date().getHours() - 2);
  return `${String(h).padStart(2, "0")}:00`;
}
