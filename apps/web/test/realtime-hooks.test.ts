import { describe, expect, it } from "vitest";
import { createRejoinTracker, isChatBackfillEvent } from "@/lib/realtime/channels";

// These back lib/realtime/hooks.ts's reconnect synthesis and
// circle-chat.tsx's backfill routing. Both are exercised here as pure
// functions rather than through a mounted component / real websocket —
// there's no jsdom configured for this suite (vitest.config.ts runs
// environment: "node"), and simulating an actual network drop/restore isn't
// practical in CI, which is exactly why the E2E pass escalated this instead
// of re-testing it live.
describe("createRejoinTracker — reconnect detection", () => {
  it("does not fire on the channel's first successful subscribe", () => {
    const isRejoin = createRejoinTracker();
    expect(isRejoin("SUBSCRIBED")).toBe(false);
  });

  it("fires on every subsequent SUBSCRIBED after the first (a rejoin post-drop)", () => {
    const isRejoin = createRejoinTracker();
    expect(isRejoin("SUBSCRIBED")).toBe(false); // initial join
    expect(isRejoin("SUBSCRIBED")).toBe(true); // rejoin #1
    expect(isRejoin("SUBSCRIBED")).toBe(true); // rejoin #2
  });

  it("ignores non-SUBSCRIBED statuses entirely — they neither fire nor count as a join", () => {
    const isRejoin = createRejoinTracker();
    expect(isRejoin("CHANNEL_ERROR")).toBe(false);
    expect(isRejoin("TIMED_OUT")).toBe(false);
    expect(isRejoin("CLOSED")).toBe(false);
    // Still the *first* SUBSCRIBED — none of the above counted as a join.
    expect(isRejoin("SUBSCRIBED")).toBe(false);
  });

  it("models a realistic drop/restore sequence: join, drop, rejoin", () => {
    const isRejoin = createRejoinTracker();
    const transitions = ["SUBSCRIBED", "CLOSED", "CHANNEL_ERROR", "SUBSCRIBED"];
    const fired = transitions.map(isRejoin);
    expect(fired).toEqual([false, false, false, true]);
  });

  it("tracks independently per instance — one channel's history never leaks into another's", () => {
    const a = createRejoinTracker();
    const b = createRejoinTracker();
    a("SUBSCRIBED");
    a("SUBSCRIBED"); // a has now rejoined once
    expect(b("SUBSCRIBED")).toBe(false); // b's first join, unaffected by a
  });
});

describe("isChatBackfillEvent — chat's realtime routing", () => {
  it("triggers backfill for a genuine new message", () => {
    expect(isChatBackfillEvent({ type: "message" })).toBe(true);
  });

  it("triggers backfill for a synthesized reconnect (catch-up on whatever was missed)", () => {
    expect(isChatBackfillEvent({ type: "reconnect" })).toBe(true);
  });

  it("does not trigger backfill for other circle-channel events (rsvp, match, tab, ...)", () => {
    expect(isChatBackfillEvent({ type: "rsvp" })).toBe(false);
    expect(isChatBackfillEvent({ type: "fourth_call" })).toBe(false);
    expect(isChatBackfillEvent({ type: "match" })).toBe(false);
    expect(isChatBackfillEvent({ type: "tab" })).toBe(false);
    expect(isChatBackfillEvent({ type: "notification" })).toBe(false);
    expect(isChatBackfillEvent({ type: "reaction" })).toBe(false);
  });
});
