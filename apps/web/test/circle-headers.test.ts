import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HEADER_KEYS, headerFor, headerUrl, isHeaderKey, resolveHeaderUrl } from "@/lib/circle-headers";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "circle-headers");

describe("circle headers", () => {
  it("has a curated collection of 10–14 keys, each backed by a bundled JPG", () => {
    expect(HEADER_KEYS.length).toBeGreaterThanOrEqual(10);
    expect(HEADER_KEYS.length).toBeLessThanOrEqual(14);
    for (const key of HEADER_KEYS) {
      expect(existsSync(path.join(publicDir, `${key}.jpg`))).toBe(true);
    }
  });

  it("headerFor is deterministic and always yields a valid curated key", () => {
    for (const id of ["abc", "circle-1", crypto.randomUUID(), crypto.randomUUID()]) {
      const first = headerFor(id);
      expect(HEADER_KEYS).toContain(first);
      // Stable across repeated calls — same id, same header, no stored state.
      expect(headerFor(id)).toBe(first);
      expect(headerFor(id)).toBe(first);
    }
  });

  it("spreads assignments across the collection (not a constant)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(headerFor(crypto.randomUUID()));
    // A well-distributed hash should touch most of the 12 keys over 500 ids.
    expect(seen.size).toBeGreaterThanOrEqual(HEADER_KEYS.length - 2);
  });

  it("headerUrl points at a same-origin path (no hotlinking)", () => {
    expect(headerUrl("court-01")).toBe("/circle-headers/court-01.jpg");
    expect(headerUrl(HEADER_KEYS[0])).toMatch(/^\/circle-headers\/[a-z0-9-]+\.jpg$/);
  });

  it("isHeaderKey guards the curated set", () => {
    expect(isHeaderKey("court-01")).toBe(true);
    expect(isHeaderKey("https://evil.example/x.jpg")).toBe(false);
    expect(isHeaderKey(null)).toBe(false);
    expect(isHeaderKey("court-99")).toBe(false);
  });

  it("resolveHeaderUrl prefers an explicit valid key, else the deterministic default", () => {
    // Explicit valid key wins.
    expect(resolveHeaderUrl("any-id", "court-05")).toBe("/circle-headers/court-05.jpg");
    // Null / invalid falls back to the deterministic auto-assignment.
    expect(resolveHeaderUrl("any-id", null)).toBe(headerUrl(headerFor("any-id")));
    expect(resolveHeaderUrl("any-id", "not-a-key")).toBe(headerUrl(headerFor("any-id")));
  });
});
