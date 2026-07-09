"use client";

import { usePresenceTracker } from "@/lib/realtime/presence";

/**
 * Mount-and-forget: renders nothing, just announces "viewing" presence on
 * `sessionId`'s channel for as long as it stays mounted. Drop this into any
 * screen a viewer should be counted on — the Fourth Call receive screen and
 * the public /fc/[token] page both mount one. See lib/realtime/presence.ts
 * for the mechanism and fourth-call-send.tsx's usePresenceCount for the
 * organiser-side count this feeds.
 */
export function PresenceTracker({
  sessionId,
  viewerId,
}: {
  sessionId: string;
  /** The signed-in viewer's user id; omit for anonymous public-link viewers, who get a fresh ephemeral id per mount. */
  viewerId?: string | null;
}) {
  usePresenceTracker(sessionId, viewerId);
  return null;
}
