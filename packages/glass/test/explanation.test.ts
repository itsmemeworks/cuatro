import { describe, expect, it } from "vitest";
import { buildExplanation } from "../src/explanation.js";

const base = {
  delta: 0.02,
  won: true,
  ownTeamRatingAvg: 3.9,
  oppTeamRatingAvg: 3.8,
  ownShare: 12 / 19,
  occurrence: 1,
  dampingMultiplier: 1,
  opponentIds: ["b1", "b2"] as [string, string],
};

describe("buildExplanation", () => {
  it("formats the sign, delta, and clause separators", () => {
    const text = buildExplanation(base);
    expect(text).toMatch(/^\+0\.02 · /);
    expect(text.split(" · ")).toHaveLength(3);
  });

  it("describes a comfortable win against a slightly weaker pair, first meeting", () => {
    const text = buildExplanation(base);
    expect(text).toBe("+0.02 · beat a slightly weaker pair, comfortable margin · vs b1, b2 (first meeting — full weight)");
  });

  it("uses display names when provided", () => {
    const text = buildExplanation({ ...base, opponentNames: { b1: "Jess", b2: "Kim" } });
    expect(text).toContain("vs Jess, Kim");
  });

  it("describes a negative delta with no leading plus sign", () => {
    const text = buildExplanation({ ...base, delta: -0.02, won: false, ownShare: 7 / 19 });
    expect(text.startsWith("-0.02")).toBe(true);
  });

  describe("strength buckets", () => {
    it("calls a near-identical pair evenly-matched", () => {
      const text = buildExplanation({ ...base, ownTeamRatingAvg: 4.0, oppTeamRatingAvg: 4.02 });
      expect(text).toContain("an evenly-matched pair");
    });

    it("calls a big gap 'much stronger' when the opponent is far ahead", () => {
      const text = buildExplanation({ ...base, won: false, ownShare: 0.3, ownTeamRatingAvg: 3.0, oppTeamRatingAvg: 4.5 });
      expect(text).toContain("much stronger pair");
    });

    it("calls a big gap 'much weaker' when the opponent is far behind", () => {
      const text = buildExplanation({ ...base, ownTeamRatingAvg: 5.5, oppTeamRatingAvg: 4.0 });
      expect(text).toContain("much weaker pair");
    });

    it("calls a moderate gap 'stronger'/'weaker' without a qualifier", () => {
      const text = buildExplanation({ ...base, ownTeamRatingAvg: 4.0, oppTeamRatingAvg: 4.45 });
      expect(text).toContain("a stronger pair");
    });
  });

  describe("margin buckets", () => {
    it("calls a near-whitewash win dominant", () => {
      const text = buildExplanation({ ...base, ownShare: 0.9 });
      expect(text).toContain("dominant margin");
    });

    it("calls a close win narrow", () => {
      const text = buildExplanation({ ...base, ownShare: 0.55 });
      expect(text).toContain("narrow margin");
    });

    it("calls a heavy loss a heavy defeat", () => {
      const text = buildExplanation({ ...base, won: false, ownShare: 0.1 });
      expect(text).toContain("heavy defeat");
    });

    it("calls a middling loss a close defeat", () => {
      const text = buildExplanation({ ...base, won: false, ownShare: 0.45 });
      expect(text).toContain("close defeat");
    });
  });

  describe("echo damping phrasing", () => {
    it("labels a first meeting as full weight", () => {
      const text = buildExplanation({ ...base, occurrence: 1, dampingMultiplier: 1 });
      expect(text).toContain("(first meeting — full weight)");
    });

    it("labels a second meeting with its ordinal and percentage", () => {
      const text = buildExplanation({ ...base, occurrence: 2, dampingMultiplier: 0.6 });
      expect(text).toContain("(2nd meeting within 30 days — 60% weight)");
    });

    it("labels a third meeting correctly", () => {
      const text = buildExplanation({ ...base, occurrence: 3, dampingMultiplier: 0.36 });
      expect(text).toContain("(3rd meeting within 30 days — 36% weight)");
    });

    it("labels an eleventh meeting with the correct 'th' ordinal", () => {
      const text = buildExplanation({ ...base, occurrence: 11, dampingMultiplier: 0.006 });
      expect(text).toContain("11th meeting");
    });
  });
});
