/**
 * Who is looking at this game? — the small read model behind the outsider view
 * of /games/[sessionId] (Pete, 2026-07-11: a signed-in NON-member can reach a
 * game page from Discover/The Board — game READS are ungated — but the page
 * used to assume a member: the back-link 404'd into the members-only circle
 * pages and member-only affordances leaked). One cheap context answers:
 *
 *  - `viewerIsMember`      — drives the back target (‹ Games vs ‹ Discover)
 *                            and gates every member-only affordance;
 *  - `circlePreviewEnabled`— may the circle's PUBLIC preview sheet open here?
 *                            Only discoverable Circles (open door OR Board on)
 *                            preview; a private Circle's roster never leaks
 *                            through a shared game link;
 *  - `viewerHasPendingSessionKnock` — the outsider ask affordance's initial
 *                            "Asked · withdraw" state (same knock the Board
 *                            card fires, /api/knocks/session).
 */
import { and, eq } from "drizzle-orm";
import { circleMembers, circles, knocks, type CuatroDb } from "@cuatro/db";

/**
 * Is this Circle publicly discoverable — open door OR posting its games to The
 * Board? This is the ONE rule for whether its public preview (aggregate facts +
 * roster, server/open-door.ts circlePreview) may be served to a non-member;
 * both flags off = private = never previewed. Shared by the preview API route
 * and the game page.
 */
export async function circleDiscoverable(db: CuatroDb, circleId: string): Promise<boolean> {
  const [row] = await db
    .select({ openDoor: circles.openDoor, boardEnabled: circles.boardEnabled })
    .from(circles)
    .where(eq(circles.id, circleId));
  return !!row && (row.openDoor || row.boardEnabled);
}

export interface SessionViewerContext {
  /** The viewer holds a circle_members row for the game's Circle (any role). */
  viewerIsMember: boolean;
  /** Non-member AND the Circle is discoverable → the public preview sheet may open. Always false for members (they just visit the Circle). */
  circlePreviewEnabled: boolean;
  /** The viewer already has an open ask on this session (outsider affordance shows "Asked"). */
  viewerHasPendingSessionKnock: boolean;
}

export async function getSessionViewerContext(
  db: CuatroDb,
  input: { circleId: string; sessionId: string; userId: string },
): Promise<SessionViewerContext> {
  const { circleId, sessionId, userId } = input;

  const [membership] = await db
    .select({ userId: circleMembers.userId })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)));
  const viewerIsMember = !!membership;

  // Members never need the preview; non-members only get it when the Circle is
  // discoverable (a private Circle's game link stays a shop window with the
  // blinds down on the roster).
  const circlePreviewEnabled = viewerIsMember ? false : await circleDiscoverable(db, circleId);

  let viewerHasPendingSessionKnock = false;
  if (!viewerIsMember) {
    const [pending] = await db
      .select({ id: knocks.id })
      .from(knocks)
      .where(
        and(eq(knocks.kind, "session"), eq(knocks.targetId, sessionId), eq(knocks.userId, userId), eq(knocks.status, "pending")),
      );
    viewerHasPendingSessionKnock = !!pending;
  }

  return { viewerIsMember, circlePreviewEnabled, viewerHasPendingSessionKnock };
}
