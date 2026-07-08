import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __setRealtimeSenderForTests,
  emitCircleEvent,
  emitRealtime,
  emitSessionEvent,
  emitUserEvent,
} from "@/lib/realtime/broadcast";
import { circleChannel, sessionChannel, userChannel } from "@/lib/realtime/channels";

afterEach(() => {
  __setRealtimeSenderForTests(null); // back to the suite-wide silent no-op (see test/setup.ts)
  vi.restoreAllMocks();
});

describe("emitRealtime / emitCircleEvent / emitSessionEvent / emitUserEvent", () => {
  it("addresses the right topic and stamps type/ts/id fields for each helper", async () => {
    const calls: { topic: string; type: string; fields: Record<string, unknown> }[] = [];
    __setRealtimeSenderForTests(async (topic, type, fields) => {
      calls.push({ topic, type, fields });
    });

    emitCircleEvent("circle-1", "message", { messageId: "m1" });
    emitSessionEvent("session-1", "rsvp", { circleId: "circle-1" });
    emitUserEvent("user-1", "notification", { notificationId: "n1" });

    // emitRealtime/emitCircleEvent etc. are fire-and-forget — give the
    // microtask queue a tick so the (immediately-resolving) mock sender runs.
    await new Promise((resolve) => setImmediate(resolve));

    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({
      topic: circleChannel("circle-1"),
      type: "message",
      fields: { circleId: "circle-1", messageId: "m1" },
    });
    expect(calls[1]).toEqual({
      topic: sessionChannel("session-1"),
      type: "rsvp",
      fields: { sessionId: "session-1", circleId: "circle-1" },
    });
    expect(calls[2]).toEqual({
      topic: userChannel("user-1"),
      type: "notification",
      fields: { userId: "user-1", notificationId: "n1" },
    });
  });

  it("is fire-and-forget: a rejected sender never throws back to the caller", () => {
    __setRealtimeSenderForTests(async () => {
      throw new Error("network unreachable");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => emitRealtime("cuatro:circle:x", "message", { messageId: "m1" })).not.toThrow();

    return new Promise<void>((resolve) => {
      setImmediate(() => {
        expect(warnSpy).toHaveBeenCalled();
        resolve();
      });
    });
  });

  it("never blocks or awaits — the caller resumes before the sender resolves", () => {
    let resolved = false;
    __setRealtimeSenderForTests(async () => {
      await new Promise((r) => setTimeout(r, 5));
      resolved = true;
    });

    emitRealtime("cuatro:circle:x", "message", { messageId: "m1" });
    // Synchronously after the call, the async sender hasn't had a chance to run yet.
    expect(resolved).toBe(false);
  });
});
