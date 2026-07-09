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
  | "reaction"
  | "comment"
  | "tab"
  | "notification"
  | "reconnect";

export interface RealtimeEvent {
  type: RealtimeEventType;
  ts: number;
  [field: string]: unknown;
}

/**
 * Pure rejoin-detection state machine backing hooks.ts's reconnect
 * synthesis: returns true iff a `SUBSCRIBED` status is a rejoin after an
 * earlier join on the same channel (not its first successful subscribe).
 * Kept here — framework-free, alongside the rest of this module — rather
 * than inline in the React effect, so the transition logic is unit-testable
 * without mounting a component or opening a real websocket (see
 * test/realtime-hooks.test.ts).
 */
export function createRejoinTracker(): (status: string) => boolean {
  let joinedOnce = false;
  return (status: string): boolean => {
    if (status !== "SUBSCRIBED") return false;
    const isRejoin = joinedOnce;
    joinedOnce = true;
    return isRejoin;
  };
}

/**
 * Which realtime events should trigger CircleChat's backfill fetch. The
 * circle channel's broadcasts never carry a message body (see this file's
 * header), so both a genuine new "message" and a resynced "reconnect" route
 * through the same GET .../messages?after= catch-up; everything else falls
 * through to a plain page refresh. Extracted so this routing decision is
 * unit-testable without mounting circle-chat.tsx (see
 * test/realtime-hooks.test.ts).
 */
export function isChatBackfillEvent(event: Pick<RealtimeEvent, "type">): boolean {
  return event.type === "message" || event.type === "reconnect";
}
