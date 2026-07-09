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
 * Sends via Realtime's broadcast REST endpoint (`POST
 * .../realtime/v1/api/broadcast`) rather than the classic
 * subscribe-then-send websocket path (RealtimeChannel#send after joining).
 * That older path was tried first and reliably failed in prod with "channel
 * join timed out": Realtime's per-project "tenant" process (the thing that
 * actually terminates a websocket's `phx_join`) shuts itself down after a
 * period with no connected clients and has to cold-start on the next join
 * — cheap on Supabase's local dev image (near-zero real traffic to begin
 * with) but, on this app's low-traffic prod project, the tenant is cold
 * more often than not, and a fresh server-side connect+join sometimes
 * outran the old code's hardcoded 5s client-side join timeout. The REST
 * broadcast endpoint has no such join handshake to race — it's a single
 * POST that Realtime accepts (202) once the broadcast is queued, cold
 * tenant or not, so a generous fetch timeout below comfortably absorbs a
 * cold start instead of a fixed join deadline gambling on one.
 *
 * This is the `{"messages": [...]}` broadcast shape (supported since
 * Realtime v2.37.0), not RealtimeChannel#httpSend's newer
 * per-topic-per-event REST shape (needs v2.97.0+, confirmed 404 on the
 * local dev stack's pinned v2.73.2 image — see `docker ps`). The messages
 * shape works unchanged against both: verified directly against the local
 * stack and the hosted prod project. Because this only ever needs
 * url+key, there's no @supabase/supabase-js/realtime-js dependency (and no
 * websocket transport, bundled or not) left in this module at all.
 */
import { circleChannel, sessionChannel, userChannel, type RealtimeEventType } from "./channels";

const BROADCAST_TIMEOUT_MS = 10000;

async function realSend(topic: string, type: string, fields: Record<string, unknown>): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("realtime broadcast: NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY are not configured");
  }

  const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: {
      apikey: key,
      // Required alongside apikey — Realtime's AuthTenant plug pattern-matches
      // the Authorization header regardless of apikey being present, and 500s
      // (not 401s) if it's missing.
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [{ topic, event: type, payload: { type, ts: Date.now(), ...fields } }],
    }),
    signal: AbortSignal.timeout(BROADCAST_TIMEOUT_MS),
  });

  if (res.status !== 202) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.error ?? body.message ?? detail;
    } catch {
      // Non-JSON error body — fall back to statusText already captured above.
    }
    throw new Error(`broadcast rejected (${res.status}): ${detail}`);
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
