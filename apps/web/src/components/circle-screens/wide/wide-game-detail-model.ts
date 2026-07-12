/**
 * Pure view rules for the game detail's membership-aware chrome (Pete,
 * 2026-07-11: game READS are ungated, so a signed-in NON-member lands here
 * from Discover/The Board — the page must read like a shop window for them,
 * never a members' room). Kept beside wide-game-detail.tsx as data-only
 * helpers (wide-rotation-model.ts precedent) so they unit-test without
 * mounting the component tree.
 */

export interface GameBackTarget {
  href: string;
  label: string;
}

/**
 * Where "‹ back" goes. Members return to their Circle's games; a non-member
 * gets Discover — /circles/[id]/* is members-only and 404s on outsiders, so
 * the old unconditional circle link was a trap door.
 */
export function gameBackTarget(viewerIsMember: boolean, circleId: string): GameBackTarget {
  return viewerIsMember ? { href: `/circles/${circleId}/games`, label: "‹ Games" } : { href: "/discover", label: "‹ Discover" };
}

/**
 * Should a non-member see the ask-to-join affordance? Mirrors
 * createSessionKnock's own gate (server/discovery.ts): upcoming, RSVP window
 * open, a spot actually open, and the viewer not already holding a slot or a
 * queue place (an accepted knocker / Fourth Call claimant is "in" without
 * membership). Members never see it — they RSVP directly.
 */
export function outsiderCanAsk(input: {
  viewerIsMember: boolean;
  upcoming: boolean;
  gameFull: boolean;
  rsvpWindowOpen: boolean;
  viewerStatus: "in" | "reserve" | "out" | null;
}): boolean {
  return (
    !input.viewerIsMember &&
    input.upcoming &&
    !input.gameFull &&
    input.rsvpWindowOpen &&
    input.viewerStatus !== "in" &&
    input.viewerStatus !== "reserve"
  );
}
