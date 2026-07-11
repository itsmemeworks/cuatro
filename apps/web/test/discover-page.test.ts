import { describe, expect, it } from "vitest";
import { gameInViewerBand } from "@/server/discover-page";
import { GLASS_BAND } from "@/lib/geo";

describe("gameInViewerBand", () => {
  it("treats an unrated viewer as in-band (unrated matches any level)", () => {
    expect(gameInViewerBand(null, [2.0, 6.0])).toBe(true);
  });

  it("treats a game with no rated players as in-band (unknown, not excluded)", () => {
    expect(gameInViewerBand(4.1, [null, null])).toBe(true);
    expect(gameInViewerBand(4.1, [])).toBe(true);
  });

  it("is in-band when the game's rated range overlaps the viewer's ±band", () => {
    // viewer 4.1, band [4.1-0.75, 4.1+0.75] = [3.35, 4.85]
    expect(gameInViewerBand(4.1, [4.0, 4.5])).toBe(true); // wholly inside
    expect(gameInViewerBand(4.1, [3.0, 3.4])).toBe(true); // overlaps low edge
    expect(gameInViewerBand(4.1, [4.8, 5.5])).toBe(true); // overlaps high edge
  });

  it("is out-of-band only when the rated range lies wholly outside the viewer's band", () => {
    expect(gameInViewerBand(4.1, [5.0, 5.6])).toBe(false); // all above 4.85
    expect(gameInViewerBand(4.1, [2.0, 3.0])).toBe(false); // all below 3.35
  });

  it("uses exactly GLASS_BAND as the half-width at the boundary", () => {
    const r = 4.0;
    expect(gameInViewerBand(r, [r + GLASS_BAND])).toBe(true); // on the edge = in
    expect(gameInViewerBand(r, [r + GLASS_BAND + 0.01])).toBe(false); // just past = out
  });

  it("ignores unrated confirmed players when a rated range exists", () => {
    // the one rated player (5.6) is out of 4.1's band; the nulls don't rescue it
    expect(gameInViewerBand(4.1, [null, 5.6, null])).toBe(false);
  });
});
