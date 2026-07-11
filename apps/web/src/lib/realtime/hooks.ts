"use client";

/**
 * Client-side realtime subscriptions. Every hook call registers a handler
 * with the module-wide SharedChannelPool (./shared-channels.ts), which
 * multiplexes ANY number of consumers of the same topic over exactly ONE
 * Supabase Realtime websocket channel (via the singleton browser client in
 * ../supabase/client — same anon key already used for auth). That
 * one-channel-per-topic invariant is Wave D's docked-chat requirement: the
 * dock, the Chat tab, the unread-badge watcher and LiveRefresh can all be
 * alive for one circle and the socket still carries a single subscription.
 * The channel listens for every broadcast on its topic (`{ event: "*" }`
 * matches any event name — see node_modules/@supabase/realtime-js's channel
 * matching: a `*` filter short-circuits the event-name comparison).
 *
 * Reconnect: supabase-js's RealtimeClient already retries the underlying
 * websocket and rejoins channels on its own. What it can't do is tell a
 * consumer "you may have missed broadcasts while disconnected" — so the
 * pool tracks whether a channel has seen SUBSCRIBED before, and on every
 * *subsequent* SUBSCRIBED (i.e. a rejoin after a drop) it synthesizes a
 * `{ type: "reconnect" }` event through every registered handler. Pages
 * treat that exactly like a real event — for chat that means "backfill in
 * case a message arrived while offline"; for a page with no special
 * handling it just becomes another router.refresh(). A consumer that joins
 * an ALREADY-live channel gets no synthetic event — mount-time catch-up is
 * each consumer's own job (CircleChat backfills on mount).
 *
 * Cleanup: unmount/id-change releases the handler; the pool closes the
 * channel only when the topic's LAST consumer is gone, so a page that
 * navigates through several circles/sessions doesn't accumulate open
 * subscriptions.
 */
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { circleChannel, sessionChannel, userChannel, type RealtimeEvent } from "./channels";
import { createSharedChannelPool, type SharedChannelPool } from "./shared-channels";

let pool: SharedChannelPool | null = null;

function getPool(): SharedChannelPool {
  if (!pool) {
    pool = createSharedChannelPool({
      open: (topic) => createClient().channel(topic),
      // The pool types channels structurally; give removeChannel its real type back.
      close: (channel) => createClient().removeChannel(channel as unknown as RealtimeChannel),
    });
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      // Dev-only proof handle (E2E-CHARTER realtime bar): count live topics/
      // handlers and raw socket channels from the console.
      (window as unknown as Record<string, unknown>).__cuatroRealtime = {
        pool,
        client: createClient(),
      };
    }
  }
  return pool;
}

function useRealtimeChannel(topic: string | null, onEvent?: (event: RealtimeEvent) => void): void {
  const router = useRouter();
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!topic) return;
    return getPool().acquire(topic, (event) => {
      if (handlerRef.current) handlerRef.current(event);
      else router.refresh();
    });
    // `router` is stable across renders (Next's useRouter identity), and
    // `onEvent` is read through the ref above so a caller passing an inline
    // closure doesn't force a resubscribe every render — only a real change
    // of `topic` should release and re-acquire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);
}

export function useCircleLive(circleId: string | null | undefined, onEvent?: (event: RealtimeEvent) => void): void {
  useRealtimeChannel(circleId ? circleChannel(circleId) : null, onEvent);
}

export function useSessionLive(sessionId: string | null | undefined, onEvent?: (event: RealtimeEvent) => void): void {
  useRealtimeChannel(sessionId ? sessionChannel(sessionId) : null, onEvent);
}

export function useUserLive(userId: string | null | undefined, onEvent?: (event: RealtimeEvent) => void): void {
  useRealtimeChannel(userId ? userChannel(userId) : null, onEvent);
}
