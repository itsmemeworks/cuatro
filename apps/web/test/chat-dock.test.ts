import { describe, expect, it } from "vitest";
import { dockPrefFromStorage } from "@/lib/chat-dock";

// The dock preference's parsing rule (lib/chat-dock.ts): docked is the
// default state (the design's first-run desktop shows the dock), so ONLY an
// explicit opt-out undocks. The React wiring around it is hydration-order
// dependent and is verified live instead (no jsdom in this suite).
describe("dockPrefFromStorage", () => {
  it("defaults to docked when nothing is stored", () => {
    expect(dockPrefFromStorage(null)).toBe(true);
  });

  it("stays docked for the stored opt-in", () => {
    expect(dockPrefFromStorage("1")).toBe(true);
  });

  it("undocks only on the explicit opt-out", () => {
    expect(dockPrefFromStorage("0")).toBe(false);
  });

  it("treats garbage as the docked default rather than guessing", () => {
    expect(dockPrefFromStorage("yes please")).toBe(true);
    expect(dockPrefFromStorage("")).toBe(true);
  });
});
