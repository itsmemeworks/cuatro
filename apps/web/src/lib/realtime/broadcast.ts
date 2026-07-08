/**
 * Server-side realtime emitter. Every call site (server/*.ts mutations)
 * fires one of the emit* helpers below AFTER its write transaction has
 * committed — never from inside a `db.transaction(...)` callback, so a
 * client never learns about a change before it's actually durable and
 * readable via the authed API it will refetch through. This is enforced by
 * convention at each call site, not by this module (which has no idea
 * whether a transaction is open).
 *
 * Delivery is fire-and-forget: `emitRealtime` does not return the send
 * promise. A broadcast failure (Realtime unreachable, misconfigured env)
 * must never fail — or even delay — the mutation that triggered it; the
 * worst case is a client staying stale until its next visit/poll, which is
 * the same UX as today. Every failure is swallowed and logged with
 * `console.warn`.
 *
 * Sends over the classic subscribe-then-broadcast websocket path
 * (RealtimeChannel#send after joining), not RealtimeChannel#httpSend's REST
 * endpoint — httpSend requires Realtime server v2.97.0+, and the local dev
 * stack (supabase/config.toml's pinned image, currently v2.73.2 — see
 * `docker ps`) is older, so httpSend 404s in dev even though it may well
 * work against hosted Supabase in prod. The subscribe+send path has existed
 * since broadcast shipped and works on both, at the cost of a short-lived
 * websocket per call instead of a single REST POST — acceptable at this
 * app's v0 mutation volume (SQLite on one Fly machine).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { circleChannel, sessionChannel, userChannel, type RealtimeEventType } from "./channels";

let cachedClient: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!cachedClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error("realtime broadcast: NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY are not configured");
    }
    cachedClient = createClient(url, key);
  }
  return cachedClient;
}

const JOIN_TIMEOUT_MS = 5000;

async function realSend(topic: string, type: string, fields: Record<string, unknown>): Promise<void> {
  const supabase = getClient();
  const channel = supabase.channel(topic);
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("channel join timed out")), JOIN_TIMEOUT_MS);
      channel.subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          reject(err ?? new Error(`channel join failed: ${status}`));
        }
      });
    });

    const result = await channel.send({ type: "broadcast", event: type, payload: { type, ts: Date.now(), ...fields } });
    if (result !== "ok") {
      console.warn(`[realtime] broadcast rejected: ${topic}/${type}`, result);
    }
  } finally {
    await supabase.removeChannel(channel);
  }
}

type Sender = (topic: string, type: string, fields: Record<string, unknown>) => Promise<void>;

async function noopSend(): Promise<void> {
  // The suite-wide default (see test/setup.ts) — most tests exercise a
  // mutation for its DB effect and don't care that it also tries to
  // broadcast; without this they'd all hit realSend's "env not configured"
  // error path (harmless — swallowed by emitRealtime — but noisy).
}

let sendImpl: Sender = realSend;

/**
 * Test-only: swap the delivery mechanism. Pass a spy to assert "this
 * mutation broadcast on this topic with this type"; pass `null` to fall
 * back to a silent no-op (NOT the real sender — tests should never make a
 * live network call here, see test/setup.ts's suite-wide default).
 */
export function __setRealtimeSenderForTests(fn: Sender | null): void {
  sendImpl = fn ?? noopSend;
}

/** Fire-and-forget broadcast on an arbitrary topic. Prefer emitCircleEvent/emitSessionEvent/emitUserEvent below. */
export function emitRealtime(topic: string, type: RealtimeEventType, fields: Record<string, unknown> = {}): void {
  sendImpl(topic, type, fields).catch((err) => {
    console.warn(`[realtime] broadcast failed: ${topic}/${type}`, err);
  });
}

export function emitCircleEvent(circleId: string, type: RealtimeEventType, fields: Record<string, unknown> = {}): void {
  emitRealtime(circleChannel(circleId), type, { circleId, ...fields });
}

export function emitSessionEvent(sessionId: string, type: RealtimeEventType, fields: Record<string, unknown> = {}): void {
  emitRealtime(sessionChannel(sessionId), type, { sessionId, ...fields });
}

export function emitUserEvent(userId: string, type: RealtimeEventType, fields: Record<string, unknown> = {}): void {
  emitRealtime(userChannel(userId), type, { userId, ...fields });
}
