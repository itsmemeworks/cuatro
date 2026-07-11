/**
 * Ref-counted realtime channel pool — THE one-subscription-per-topic
 * guarantee (WEB-SHELL-SPEC.md Wave D, docked chat).
 *
 * Why: several components can legitimately care about the same topic at
 * once — the docked chat pane, the circle page's unread-badge watcher, a
 * LiveRefresh, transiently even two CircleChat mounts while the dock/tab
 * handoff settles. supabase-js's `client.channel(topic)` returns the
 * EXISTING channel object for a duplicate topic, so naive per-consumer
 * subscribe/removeChannel calls step on each other: the first consumer to
 * unmount tears the shared channel down under everyone else (this is
 * exactly why circle-tabs.tsx used to null-gate its watcher while the Chat
 * tab was open). The pool makes the invariant structural instead of
 * conventional: ONE live channel per topic, opened on the first consumer,
 * fanned out to every registered handler, closed only when the last
 * consumer releases.
 *
 * Framework-free and dependency-injected (open/close), so the whole
 * lifecycle — including the drain race below — is unit-testable without a
 * websocket or React (test/shared-channels.test.ts). lib/realtime/hooks.ts
 * owns the single browser instance wired to supabase-js.
 *
 * The drain race: closing a supabase channel is async (unsubscribe waits
 * for the server's leave ack), and while it drains, `client.channel(topic)`
 * would still hand back the dying instance. So when the last consumer
 * leaves, the pool records the in-flight close, and a re-acquire of that
 * topic defers opening the fresh channel until the old one has fully
 * drained. Events broadcast during that window are lost — same class of
 * gap as any disconnect, and covered the same way (consumers backfill on
 * mount; rejoins synthesize `reconnect`).
 */
import { createRejoinTracker, type RealtimeEvent } from "./channels";

/** The slice of supabase-js's RealtimeChannel the pool needs (structural, so tests can fake it). */
export interface BroadcastChannelLike {
  on(type: "broadcast", filter: { event: string }, callback: (message: { payload: unknown }) => void): unknown;
  subscribe(callback: (status: string) => void): unknown;
}

export type RealtimeHandler = (event: RealtimeEvent) => void;

export interface SharedChannelPool {
  /**
   * Register `handler` for every event on `topic`. Opens the underlying
   * channel iff this is the topic's first live consumer. Returns a release
   * function (idempotent); the last release closes the channel.
   */
  acquire(topic: string, handler: RealtimeHandler): () => void;
  /** Live topics with their consumer counts — tests + the in-app subscription-count proof. */
  topics(): { topic: string; handlers: number }[];
}

interface Subscriber {
  fire: RealtimeHandler;
}

interface Entry {
  /** null while this entry waits for a previous instance's close to drain. */
  channel: BroadcastChannelLike | null;
  subs: Set<Subscriber>;
}

export function createSharedChannelPool(io: {
  open: (topic: string) => BroadcastChannelLike;
  close: (channel: BroadcastChannelLike) => Promise<unknown> | void;
}): SharedChannelPool {
  const entries = new Map<string, Entry>();
  const draining = new Map<string, Promise<void>>();

  function fanOut(entry: Entry, event: RealtimeEvent): void {
    // Copy first — a handler may release() (unmount) mid-iteration.
    for (const sub of [...entry.subs]) sub.fire(event);
  }

  function attach(topic: string, entry: Entry): void {
    const channel = io.open(topic);
    entry.channel = channel;
    const isRejoin = createRejoinTracker();
    channel.on("broadcast", { event: "*" }, (message) => {
      fanOut(entry, message.payload as RealtimeEvent);
    });
    channel.subscribe((status) => {
      if (isRejoin(status)) fanOut(entry, { type: "reconnect", ts: Date.now() });
    });
  }

  return {
    acquire(topic, handler) {
      let entry = entries.get(topic);
      if (!entry) {
        const fresh: Entry = { channel: null, subs: new Set() };
        entries.set(topic, fresh);
        entry = fresh;
        const drain = draining.get(topic);
        if (drain) {
          drain.then(() => {
            // Still the live entry, still wanted, not attached by anyone else.
            if (entries.get(topic) === fresh && fresh.subs.size > 0 && fresh.channel === null) {
              attach(topic, fresh);
            }
          });
        } else {
          attach(topic, entry);
        }
      }
      const sub: Subscriber = { fire: handler };
      entry.subs.add(sub);

      let released = false;
      return () => {
        if (released) return;
        released = true;
        entry.subs.delete(sub);
        if (entry.subs.size > 0 || entries.get(topic) !== entry) return;
        entries.delete(topic);
        const channel = entry.channel;
        entry.channel = null;
        if (!channel) return; // never attached (released while a drain was pending)
        const drain = Promise.resolve(io.close(channel))
          .catch(() => {})
          .then(() => {
            if (draining.get(topic) === drain) draining.delete(topic);
          });
        draining.set(topic, drain);
      };
    },

    topics() {
      return [...entries.entries()].map(([topic, entry]) => ({ topic, handlers: entry.subs.size }));
    },
  };
}
