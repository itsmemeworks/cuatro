import { describe, expect, it } from "vitest";
import { HEADER_KEYS } from "@/lib/circle-headers";
import { EMBLEM_PRESETS, HEADER_LABELS } from "@/components/circles/presets";

function graphemeCount(value: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].length;
}

describe("circle presets (Circle v2 presentation)", () => {
  it("every curated header key has a human label", () => {
    for (const key of HEADER_KEYS) {
      expect(HEADER_LABELS[key]).toBeTruthy();
      expect(HEADER_LABELS[key].length).toBeGreaterThan(0);
    }
    // No labels for keys that don't exist.
    expect(Object.keys(HEADER_LABELS).sort()).toEqual([...HEADER_KEYS].sort());
  });

  it("emoji emblem presets are a handful of single-grapheme marks", () => {
    expect(EMBLEM_PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(EMBLEM_PRESETS.length).toBeLessThanOrEqual(12);
    for (const emoji of EMBLEM_PRESETS) {
      // One user-perceived emoji — the "one emoji is plenty" rule the picker enforces.
      expect(graphemeCount(emoji)).toBe(1);
    }
    // Distinct marks, no accidental duplicates.
    expect(new Set(EMBLEM_PRESETS).size).toBe(EMBLEM_PRESETS.length);
  });
});
