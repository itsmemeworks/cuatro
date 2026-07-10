/**
 * Pure RSVP-window phase for the feed's pinned game bar.
 *
 * The bug (v1 audit, journeys finding 2): the feed's "I'm in" pill rendered an
 * active coral button before the RSVP window opened, so tapping it silently
 * no-oped on a `window_not_open` rejection. The fix gates the button on the
 * window being genuinely open; this function is the single source of that
 * decision so it can be tested without a DOM. The session page (SessionCard)
 * derives the same three phases inline — keep them in step.
 *
 * Invariant across the app: opensMs < startsMs (a window always opens before
 * the session starts). Boundaries are half-open: the window is open at exactly
 * opensMs and closed at exactly startsMs.
 */
export type RsvpWindowPhase = "before" | "open" | "started";

export function rsvpWindowPhase(now: number, opensMs: number, startsMs: number): RsvpWindowPhase {
  if (now >= startsMs) return "started";
  if (now >= opensMs) return "open";
  return "before";
}
