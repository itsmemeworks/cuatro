import type { GuestFlowInitial } from "@/components/entry/guest-claim-flow";
import { GUEST_PLACEHOLDER_NAME } from "@/server/guest";

/** The slice of a roster row the resume decision needs (a PlayerRef, structurally). */
export type GuestRosterEntry = { displayName: string; avatarUrl?: string | null };

/**
 * Which step the anonymous /fc/[token] landing starts on — extracted pure so
 * the full-session truth rule is testable (QA6: a 4/4 session must land on
 * the honest "Beaten to it" state up front, never a live "I can play" CTA).
 *
 * Resume order matters: a guest who already holds a spot (or a reserve slot)
 * on THIS session resumes into their own state even when the session is full —
 * their claim is part of why it's full.
 */
export function resolveGuestFlowInitial({
  isFull,
  confirmed,
  reserved,
}: {
  /** confirmed count >= slots at render time. */
  isFull: boolean;
  /** This device's guest row among the session's confirmed players, if any. */
  confirmed: GuestRosterEntry | undefined;
  /** This device's guest row on the session's reserve queue, if any. */
  reserved: GuestRosterEntry | undefined;
}): GuestFlowInitial {
  const guestPlayer = confirmed ?? reserved;

  if (!guestPlayer) {
    return isFull ? { step: "beaten" } : { step: "claim" };
  }
  if (guestPlayer.displayName === GUEST_PLACEHOLDER_NAME) {
    return { step: "name", status: confirmed ? "in" : "reserve" };
  }
  return {
    step: "done",
    status: confirmed ? "in" : "reserve",
    displayName: guestPlayer.displayName,
    avatarUrl: guestPlayer.avatarUrl,
  };
}
