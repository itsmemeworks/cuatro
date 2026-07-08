/**
 * Shared, pure realtime primitives — topic naming and the event shape.
 * Imported by both server code (src/lib/realtime/broadcast.ts) and client
 * hooks (src/lib/realtime/hooks.ts), so this file must stay framework-free
 * (no supabase-js, no "use client") to avoid pulling either bundle into the
 * other.
 *
 * Every channel is a broadcast-only pub/sub bus, not a data source: events
 * carry {type, id fields, ts} and NEVER entity payloads (message bodies,
 * scores, money amounts, ...). That's what makes it safe to subscribe with
 * the public anon key from the browser — a leaked event tells an observer
 * "something changed on session X", never what changed. Clients always
 * re-fetch the real data through the authed Next API after receiving one.
 */

export function circleChannel(circleId: string): string {
  return `cuatro:circle:${circleId}`;
}

export function sessionChannel(sessionId: string): string {
  return `cuatro:session:${sessionId}`;
}

export function userChannel(userId: string): string {
  return `cuatro:user:${userId}`;
}

/**
 * The event catalogue. Every `type` below is broadcast on at least one of
 * circle/session/user channels — see broadcast.ts's emit* call sites for the
 * exact fan-out per mutation. `reconnect` is synthetic: hooks.ts fires it
 * locally after a dropped-then-restored subscription, so a page that missed
 * broadcasts while offline still gets a chance to resync.
 */
export type RealtimeEventType =
  | "message"
  | "rsvp"
  | "fourth_call"
  | "match"
  | "tab"
  | "notification"
  | "reconnect";

export interface RealtimeEvent {
  type: RealtimeEventType;
  ts: number;
  [field: string]: unknown;
}
