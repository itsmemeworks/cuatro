import { describe, expect, it } from "vitest";
import { rsvpWindowPhase } from "@/components/circle-screens/pinned-game-view";

/**
 * Backs the feed pinned-game bar's decision to show an active "I'm in" pill
 * ONLY while the RSVP window is open (v1 audit, journeys finding 2). Before the
 * fix the coral button rendered before the window opened and silently no-oped
 * on a `window_not_open` rejection; the bar now gates the button on this phase
 * and shows an honest "RSVPs open ..." line otherwise. Half-open boundaries:
 * open at exactly opensMs, closed at exactly startsMs.
 */
describe("rsvpWindowPhase", () => {
  const opensMs = 1_000_000;
  const startsMs = 2_000_000;

  it("is 'before' until the window opens — no active RSVP button", () => {
    expect(rsvpWindowPhase(opensMs - 1, opensMs, startsMs)).toBe("before");
    expect(rsvpWindowPhase(0, opensMs, startsMs)).toBe("before");
  });

  it("is 'open' from the instant the window opens up to (not including) kickoff", () => {
    expect(rsvpWindowPhase(opensMs, opensMs, startsMs)).toBe("open");
    expect(rsvpWindowPhase(opensMs + 500_000, opensMs, startsMs)).toBe("open");
    expect(rsvpWindowPhase(startsMs - 1, opensMs, startsMs)).toBe("open");
  });

  it("is 'started' from kickoff onward — the RSVP action is closed, no button", () => {
    expect(rsvpWindowPhase(startsMs, opensMs, startsMs)).toBe("started");
    expect(rsvpWindowPhase(startsMs + 1, opensMs, startsMs)).toBe("started");
  });
});
