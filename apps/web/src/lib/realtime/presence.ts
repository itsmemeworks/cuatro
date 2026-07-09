"use client";

/**
 * Live "viewing" signal for the Fourth Call send screen (design/HANDOFF.md
 * screen 6: "2 viewing…"), built on Supabase Realtime Presence over the
 * same per-session topic broadcast.ts/hooks.ts already use for chat/rsvp
 * events (`cuatro:session:{id}` — see channels.ts's sessionChannel).
 * Presence and broadcast are independent Phoenix features multiplexed onto
 * one topic, so both can subscribe on it without interfering with each
 * other — confirmed live against the pinned local dev stack (Realtime
 * image v2.73.2, see supabase/config.toml and broadcast.ts's header) with a
 * two-client join/sync/leave round trip. Presence predates the REST/
 * httpSend surface that image is missing (the reason broadcast.ts stays on
 * the classic websocket send path), so no heartbeat fallback was needed
 * here.
 *
 * Every viewer tracks under an ephemeral, identity-free key by default —
 * generateEphemeralViewerId mints a fresh one per hook mount, never
 * persisted (no storage, no derivation from anything identifying) — so an
 * observer only ever learns a count, never who. A signed-in viewer (the
 * Fourth Call receive screen) may instead pass their real user id, which
 * lets the organiser-side count exclude a specific id (see
 * usePresenceCount's excludeId) on the off chance the organiser opens
 * their own invite.
 *
 * The pure helpers below (resolveViewerId / attachPresenceTracker /
 * attachPresenceCount) do the actual channel wiring against a small
 * duck-typed channel interface and are unit-tested directly against a
 * mocked channel; the two exported hooks are thin useEffect/useState glue
 * with no logic of their own. (This project's vitest setup runs in the
 * "node" environment with no DOM/testing-library — see vitest.config.ts —
 * so hook behaviour is verified at the helper layer rather than via a
 * rendered component.)
 */
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { sessionChannel } from "./channels";

export function generateEphemeralViewerId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `viewer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** `viewerId` wins when given (a signed-in viewer); otherwise mint a fresh ephemeral id. */
export function resolveViewerId(viewerId: string | null | undefined): string {
  return viewerId ?? generateEphemeralViewerId();
}

/** The slice of RealtimeChannel this module actually uses — kept narrow so tests can pass a plain mock. */
export interface PresenceLikeChannel {
  on(type: "presence", filter: { event: "sync" | "join" | "leave" }, callback: (payload: unknown) => void): unknown;
  presenceState(): Record<string, unknown[]>;
  subscribe(callback?: (status: string, err?: unknown) => void): unknown;
  track(payload: Record<string, unknown>): Promise<unknown>;
}

/** Announce presence once the channel finishes joining. */
export function attachPresenceTracker(channel: PresenceLikeChannel): void {
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      channel.track({ online_at: Date.now() });
    }
  });
}

/**
 * Wire a pure-observer channel's presence sync events to `onChange`,
 * excluding `excludeId` (the organiser's own key, if present) from the
 * count. Computes once immediately — covers the case the channel's state
 * is already populated before this attaches — and again on every
 * subsequent sync.
 */
export function attachPresenceCount(
  channel: PresenceLikeChannel,
  excludeId: string | null | undefined,
  onChange: (count: number) => void,
): void {
  const recompute = () => {
    const keys = Object.keys(channel.presenceState()).filter((key) => key !== excludeId);
    onChange(keys.length);
  };
  channel.on("presence", { event: "sync" }, recompute);
  recompute();
}

/**
 * Announces this browser tab as "viewing" a session for as long as the
 * component stays mounted — call from the Fourth Call receive screen and
 * the public /fc/[token] page (via the <PresenceTracker> component).
 * Pass `viewerId` when the viewer is signed in; omit it for anonymous
 * public-link viewers, who get a fresh ephemeral id every mount.
 */
export function usePresenceTracker(sessionId: string | null | undefined, viewerId?: string | null): void {
  const idRef = useRef<string | null>(null);
  if (idRef.current === null) idRef.current = resolveViewerId(viewerId);

  useEffect(() => {
    if (!sessionId) return;
    const supabase = createClient();
    const channel = supabase.channel(sessionChannel(sessionId), {
      config: { presence: { key: idRef.current! } },
    });
    attachPresenceTracker(channel);
    return () => {
      supabase.removeChannel(channel);
    };
    // Deliberately re-keyed only on sessionId: idRef is stable for the
    // component's lifetime (a real viewerId shouldn't change mid-session,
    // and an ephemeral id must not regenerate on unrelated re-renders).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
}

/**
 * Live count of distinct viewers currently tracked on a session's channel.
 * This side never tracks its own presence — it's the organiser-only send
 * screen, a pure observer — and excludes `excludeId` from the count if it
 * happens to be present (the organiser opening their own invite link).
 */
export function usePresenceCount(sessionId: string | null | undefined, excludeId?: string | null): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!sessionId) {
      setCount(0);
      return;
    }
    const supabase = createClient();
    const channel = supabase.channel(sessionChannel(sessionId), {
      config: { presence: { key: "" } },
    });
    attachPresenceCount(channel, excludeId, setCount);
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
      setCount(0);
    };
  }, [sessionId, excludeId]);

  return count;
}
