import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { circleMembers } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { listUpcomingSessionsForCircle } from "@/server/games-service";

/**
 * GET /api/circles/[id]/pinned-game — the circle's pinned game (its FIRST
 * upcoming session), compacted for the docked chat's pinned-game card
 * (issue #29, design "docked chat rail"). Same data source as the circle
 * pages' PinnedGameBar: listUpcomingSessionsForCircle's first summary —
 * loadCircleContext's exact pinned-game read, no new query — including its
 * lazy-on-view semantics (session materialise / rotation lock / Fourth Call
 * check), which are no-ops here in practice because the circle page the dock
 * rides beside ran the same read moments earlier.
 *
 * Membership-gated like /api/shell/session-circle: a non-member (or a
 * guessed id) gets 403 and can't read a circle's calendar. `game: null`
 * means nothing upcoming — the dock simply renders no card.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const { db } = await getGamesClient();

  const [membership] = await db
    .select({ userId: circleMembers.userId })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, id), eq(circleMembers.userId, user.id)))
    .limit(1);
  if (!membership) return NextResponse.json({ ok: false, error: "not_member" }, { status: 403 });

  const summaries = await listUpcomingSessionsForCircle(db, id, user.id);
  const primary = summaries[0] ?? null;
  if (!primary) return NextResponse.json({ ok: true, game: null });

  // Rotation games count the (provisional or locked) lineup, mirroring
  // load-circle.ts's sessionCards mapping — a bare RSVP count on a rotation
  // game would contradict the circle page beside the dock.
  const confirmed = primary.rotation ? primary.rotation.lineup : primary.confirmed;

  return NextResponse.json({
    ok: true,
    game: {
      sessionId: primary.session.id,
      startsAt: primary.session.startsAt,
      timezone: primary.timezone,
      venueName: primary.venue?.name ?? null,
      slots: primary.slots,
      confirmedCount: confirmed.length,
      booking: primary.moneyOptIn?.kind === "booking" ? primary.moneyOptIn.booking : null,
    },
  });
}
