import { describe, expect, it, vi } from "vitest";
import {
  attachPresenceCount,
  attachPresenceTracker,
  generateEphemeralViewerId,
  resolveViewerId,
  type PresenceLikeChannel,
} from "@/lib/realtime/presence";

/**
 * These test the pure helpers presence.ts's hooks are thin useEffect/
 * useState wrappers around — this project's vitest setup runs in the
 * "node" environment with no DOM/testing-library configured (see
 * vitest.config.ts), so the hooks themselves can't be rendered here. The
 * helpers below own every bit of actual logic (channel wiring, count
 * derivation, exclusion, id generation), so exercising them directly
 * against a mocked channel covers the same behaviour a rendered-hook test
 * would.
 */

function makeMockChannel(initialState: Record<string, unknown[]> = {}) {
  const handlers: Record<string, (payload: unknown) => void> = {};
  let state = initialState;
  const channel: PresenceLikeChannel & { setState: (s: Record<string, unknown[]>) => void } = {
    on: vi.fn((_type, filter, cb) => {
      handlers[filter.event] = cb;
      return channel;
    }),
    presenceState: vi.fn(() => state),
    subscribe: vi.fn((cb) => {
      if (cb) cb("SUBSCRIBED");
      return channel;
    }),
    track: vi.fn(async () => "ok"),
    setState(s) {
      state = s;
      handlers.sync?.(undefined);
    },
  };
  return channel;
}

describe("resolveViewerId / generateEphemeralViewerId", () => {
  it("returns the given viewerId unchanged when one is provided (signed-in viewer)", () => {
    expect(resolveViewerId("user-42")).toBe("user-42");
  });

  it("mints a fresh ephemeral id when no viewerId is given, different every call (new id per mount)", () => {
    const a = resolveViewerId(null);
    const b = resolveViewerId(undefined);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it("generateEphemeralViewerId never repeats and never carries an identity — just an opaque token", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateEphemeralViewerId()));
    expect(ids.size).toBe(20);
    for (const id of ids) {
      expect(id).not.toMatch(/user|email|@/i);
    }
  });
});

describe("attachPresenceTracker", () => {
  it("tracks once the channel reports SUBSCRIBED, and not before", () => {
    const channel = makeMockChannel();
    attachPresenceTracker(channel);
    expect(channel.subscribe).toHaveBeenCalled();
    expect(channel.track).toHaveBeenCalledTimes(1);
    expect(channel.track).toHaveBeenCalledWith(expect.objectContaining({ online_at: expect.any(Number) }));
  });

  it("does not track on a non-SUBSCRIBED status", () => {
    const handlers: Record<string, (payload: unknown) => void> = {};
    const channel: PresenceLikeChannel = {
      on: vi.fn(),
      presenceState: vi.fn(() => ({})),
      subscribe: vi.fn((cb) => {
        cb?.("CHANNEL_ERROR", new Error("boom"));
        return channel;
      }),
      track: vi.fn(async () => "ok"),
    };
    void handlers;
    attachPresenceTracker(channel);
    expect(channel.track).not.toHaveBeenCalled();
  });
});

describe("attachPresenceCount", () => {
  it("reports 0 immediately against an empty presence state", () => {
    const channel = makeMockChannel({});
    const onChange = vi.fn();
    attachPresenceCount(channel, null, onChange);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("updates the count on join (sync fires with the new state)", () => {
    const channel = makeMockChannel({});
    const onChange = vi.fn();
    attachPresenceCount(channel, null, onChange);

    channel.setState({ "viewer-1": [{}], "viewer-2": [{}] });
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it("updates the count on leave (sync fires with a shrunk state)", () => {
    const channel = makeMockChannel({ "viewer-1": [{}], "viewer-2": [{}] });
    const onChange = vi.fn();
    attachPresenceCount(channel, null, onChange);
    expect(onChange).toHaveBeenLastCalledWith(2);

    channel.setState({ "viewer-1": [{}] });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("excludes the organiser's own id from the count even if they're present", () => {
    const channel = makeMockChannel({ "organiser-1": [{}], "viewer-2": [{}], "viewer-3": [{}] });
    const onChange = vi.fn();
    attachPresenceCount(channel, "organiser-1", onChange);
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it("with no excludeId, counts every tracked viewer", () => {
    const channel = makeMockChannel({ "viewer-1": [{}], "viewer-2": [{}] });
    const onChange = vi.fn();
    attachPresenceCount(channel, undefined, onChange);
    expect(onChange).toHaveBeenLastCalledWith(2);
  });
});
