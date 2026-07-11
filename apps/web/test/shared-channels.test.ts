import { describe, expect, it } from "vitest";
import { createSharedChannelPool, type BroadcastChannelLike } from "@/lib/realtime/shared-channels";
import type { RealtimeEvent } from "@/lib/realtime/channels";

/**
 * The ref-counted channel pool behind lib/realtime/hooks.ts — Wave D's
 * one-subscription-per-topic guarantee for the docked chat. Exercised with
 * a fake channel + controllable close promises (no websocket, no React),
 * which is exactly why the pool is dependency-injected.
 */

class FakeChannel implements BroadcastChannelLike {
  broadcasts: ((message: { payload: unknown }) => void)[] = [];
  statusCallback: ((status: string) => void) | null = null;

  constructor(public topic: string) {}

  on(_type: "broadcast", _filter: { event: string }, callback: (message: { payload: unknown }) => void): this {
    this.broadcasts.push(callback);
    return this;
  }

  subscribe(callback: (status: string) => void): this {
    this.statusCallback = callback;
    callback("SUBSCRIBED");
    return this;
  }

  emit(event: RealtimeEvent): void {
    for (const cb of this.broadcasts) cb({ payload: event });
  }

  dropAndRejoin(): void {
    this.statusCallback?.("CHANNEL_ERROR");
    this.statusCallback?.("SUBSCRIBED");
  }
}

function harness(opts?: { deferClose?: boolean }) {
  const opened: FakeChannel[] = [];
  const closed: FakeChannel[] = [];
  const pendingCloses: (() => void)[] = [];
  const pool = createSharedChannelPool({
    open: (topic) => {
      const channel = new FakeChannel(topic);
      opened.push(channel);
      return channel;
    },
    close: (channel) => {
      closed.push(channel as FakeChannel);
      if (!opts?.deferClose) return;
      return new Promise<void>((resolve) => pendingCloses.push(resolve));
    },
  });
  const resolveClose = () => pendingCloses.splice(0).forEach((resolve) => resolve());
  return { pool, opened, closed, resolveClose };
}

const msg = (ts = 1): RealtimeEvent => ({ type: "message", ts });

/** Drain the whole microtask backlog (the pool's close/reopen chain is several .then()s deep). */
const flushAsync = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("createSharedChannelPool — one channel per topic", () => {
  it("opens one channel for many consumers of the same topic and fans events to all of them", () => {
    const { pool, opened } = harness();
    const seenA: RealtimeEvent[] = [];
    const seenB: RealtimeEvent[] = [];
    pool.acquire("cuatro:circle:c1", (e) => seenA.push(e));
    pool.acquire("cuatro:circle:c1", (e) => seenB.push(e));

    expect(opened).toHaveLength(1);
    opened[0].emit(msg());
    expect(seenA).toHaveLength(1);
    expect(seenB).toHaveLength(1);
  });

  it("a consumer joining an already-live channel receives subsequent events, not past ones", () => {
    const { pool, opened } = harness();
    pool.acquire("t", () => {});
    opened[0].emit(msg(1));

    const late: RealtimeEvent[] = [];
    pool.acquire("t", (e) => late.push(e));
    opened[0].emit(msg(2));

    expect(late).toEqual([{ type: "message", ts: 2 }]);
  });

  it("distinct topics get distinct channels", () => {
    const { pool, opened } = harness();
    pool.acquire("cuatro:circle:c1", () => {});
    pool.acquire("cuatro:session:s1", () => {});
    expect(opened.map((c) => c.topic)).toEqual(["cuatro:circle:c1", "cuatro:session:s1"]);
  });

  it("keeps the channel open until the LAST consumer releases (the dock/tab/badge overlap case)", () => {
    const { pool, opened, closed } = harness();
    const releaseChat = pool.acquire("t", () => {});
    const releaseBadge = pool.acquire("t", () => {});

    releaseChat();
    expect(closed).toHaveLength(0); // badge watcher still listening

    const survivor: RealtimeEvent[] = [];
    pool.acquire("t", (e) => survivor.push(e));
    opened[0].emit(msg());
    expect(survivor).toHaveLength(1);

    releaseBadge();
    expect(closed).toHaveLength(0);
  });

  it("closes the channel exactly once when the last consumer releases; release is idempotent", () => {
    const { pool, closed } = harness();
    const release = pool.acquire("t", () => {});
    release();
    release();
    expect(closed).toHaveLength(1);
  });

  it("a released handler stops receiving events even while others keep the channel", () => {
    const { pool, opened } = harness();
    const gone: RealtimeEvent[] = [];
    const release = pool.acquire("t", (e) => gone.push(e));
    pool.acquire("t", () => {});
    release();
    opened[0].emit(msg());
    expect(gone).toHaveLength(0);
  });

  it("two consumers registering the SAME handler function still count separately", () => {
    const { pool, opened, closed } = harness();
    const seen: RealtimeEvent[] = [];
    const handler = (e: RealtimeEvent) => seen.push(e);
    const r1 = pool.acquire("t", handler);
    pool.acquire("t", handler);
    r1();
    expect(closed).toHaveLength(0); // second registration still holds it
    opened[0].emit(msg());
    expect(seen).toHaveLength(1);
  });

  it("synthesizes reconnect to every handler on a rejoin, never on the first join", () => {
    const { pool, opened } = harness();
    const seenA: RealtimeEvent[] = [];
    const seenB: RealtimeEvent[] = [];
    pool.acquire("t", (e) => seenA.push(e));
    pool.acquire("t", (e) => seenB.push(e));
    expect(seenA).toHaveLength(0); // first SUBSCRIBED is silent

    opened[0].dropAndRejoin();
    expect(seenA.map((e) => e.type)).toEqual(["reconnect"]);
    expect(seenB.map((e) => e.type)).toEqual(["reconnect"]);
  });

  it("reports live topics and handler counts (the in-app proof surface)", () => {
    const { pool } = harness();
    const release = pool.acquire("a", () => {});
    pool.acquire("a", () => {});
    pool.acquire("b", () => {});
    expect(pool.topics()).toEqual([
      { topic: "a", handlers: 2 },
      { topic: "b", handlers: 1 },
    ]);
    release();
    expect(pool.topics()).toEqual([
      { topic: "a", handlers: 1 },
      { topic: "b", handlers: 1 },
    ]);
  });
});

describe("createSharedChannelPool — the async-close drain race", () => {
  it("defers reopening a topic until the previous channel's close has drained", async () => {
    const { pool, opened, resolveClose } = harness({ deferClose: true });
    const release = pool.acquire("t", () => {});
    release(); // close starts draining

    const seen: RealtimeEvent[] = [];
    pool.acquire("t", (e) => seen.push(e));
    expect(opened).toHaveLength(1); // NOT reopened yet — supabase would hand back the dying channel

    resolveClose();
    await flushAsync();
    expect(opened).toHaveLength(2);

    opened[1].emit(msg());
    expect(seen).toHaveLength(1);
  });

  it("does not reopen when the re-acquire is itself released before the drain finishes", async () => {
    const { pool, opened, resolveClose } = harness({ deferClose: true });
    pool.acquire("t", () => {})();

    const release = pool.acquire("t", () => {});
    release();

    resolveClose();
    await flushAsync();
    expect(opened).toHaveLength(1); // nobody left — stays closed
    expect(pool.topics()).toEqual([]);
  });

  it("handles unmount-remount churn (React StrictMode) without leaking or double-opening channels", async () => {
    const { pool, opened, closed, resolveClose } = harness({ deferClose: true });

    // StrictMode: mount -> immediate cleanup -> remount.
    const first = pool.acquire("t", () => {});
    first();
    const second = pool.acquire("t", () => {}); // lands while the close drains

    resolveClose();
    await flushAsync();

    // Exactly one live channel again, freshly opened after the drain.
    expect(opened).toHaveLength(2);
    expect(closed).toHaveLength(1);
    expect(pool.topics()).toEqual([{ topic: "t", handlers: 1 }]);

    second();
    await flushAsync();
    expect(closed).toHaveLength(2);
    expect(pool.topics()).toEqual([]);
  });
});
