import { describe, expect, it } from "vitest";
import { glassSkipNote, ratingStillHidden } from "@/components/matches/match-confirm-flow";

// Pure render-logic tests — no component mount / jsdom needed (see
// match-confirm-flow.tsx's own comment on why these two decisions are
// exported): both determine what the seal card says without touching React.
describe("glassSkipNote", () => {
  it("says nothing when the engine actually wrote Ledger rows", () => {
    expect(glassSkipNote("completed", 4)).toBeNull();
    expect(glassSkipNote("retired", 4)).toBeNull(); // retired-with-games applies Glass normally
  });

  it("flags a walkover as skipped even if it somehow carried ledger events (defensive)", () => {
    expect(glassSkipNote("walkover", 0)).toBe("Recorded as a walkover. Legs, weather, or life, no one's Glass rating moved and no story needed.");
  });

  it("flags a retired match with zero games played as skipped", () => {
    expect(glassSkipNote("retired", 0)).toBe("No games were played, so no one's Glass rating moved.");
  });

  it("falls back to the generic no-games note for a completed match with zero events (shouldn't happen, but stays neutral)", () => {
    expect(glassSkipNote("completed", 0)).toBe("No games were played, so no one's Glass rating moved.");
  });
});

describe("ratingStillHidden", () => {
  it("hides the number for a mid-Placement-Trio explanation", () => {
    expect(ratingStillHidden("Placement match 2 of 3, your Glass number stays hidden until the Trio completes")).toBe(true);
  });

  it("reveals the number once the Trio completes or for a normal post-placement match", () => {
    expect(ratingStillHidden("Placement Trio complete, welcome to the table")).toBe(false);
    expect(ratingStillHidden("You won comfortably against a higher-rated pair.")).toBe(false);
  });
});
