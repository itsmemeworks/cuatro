"use client";

/**
 * Client-side realtime subscriptions. Each hook opens a Supabase Realtime
 * websocket channel (via the browser client in ../supabase/client — same
 * anon key already used for auth) and listens for every broadcast on that
 * topic (`{ event: "*" }` matches any event name — see
 * node_modules/@supabase/realtime-js's channel matching: a `*` filter
 * short-circuits the event-name comparison).
 *
 * Reconnect: supabase-js's RealtimeClient already retries the underlying
 * websocket and rejoins channels on its own. What it can't do is tell a
 * consumer "you may have missed broadcasts while disconnected" — so this
 * hook tracks whether it has seen SUBSCRIBED before, and on every
 * *subsequent* SUBSCRIBED (i.e. a rejoin after a drop) it synthesizes a
 * `{ type: "reconnect" }` event through the same handler. Pages treat that
 * exactly like a real event — for chat that means "backfill in case a
 * message arrived while offline"; for a page with no special handling it
 * just becomes another router.refresh().
 *
 * Cleanup: unsubscribing removes the channel from the shared client on
 * unmount/id-change so a page that navigates through several
 * circles/sessions doesn't accumulate open subscriptions.
 */
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { circleChannel, sessionChannel, userChannel, type RealtimeEvent } from "./channels";

function useRealtimeChannel(topic: string | null, onEvent?: (event: RealtimeEvent) => void): void {
  const router = useRouter();
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!topic) return;

    const supabase = createClient();
    const channel = supabase.channel(topic);
    let joinedOnce = false;

    const fire = (event: RealtimeEvent) => {
      if (handlerRef.current) handlerRef.current(event);
      else router.refresh();
    };

    channel
      .on("broadcast", { event: "*" }, (message) => {
        fire(message.payload as RealtimeEvent);
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        if (joinedOnce) fire({ type: "reconnect", ts: Date.now() });
        joinedOnce = true;
      });

    return () => {
      supabase.removeChannel(channel);
    };
    // `router` is stable across renders (Next's useRouter identity), and
    // `onEvent` is read through the ref above so a caller passing an inline
    // closure doesn't force a resubscribe every render — only a real change
    // of `topic` should tear down and rejoin the channel.
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
