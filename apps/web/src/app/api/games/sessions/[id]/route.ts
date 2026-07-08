import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { checkFourthCallLevel1, getSessionSummary, isFourthCallActive } from "@/server/games-service";

/** Session detail — also the lazy trigger point for the Fourth Call level-1 check (no cron in v0). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const { db } = await getGamesClient();
  const summary = getSessionSummary(db, id, user.id);
  if (!summary) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  checkFourthCallLevel1(db, id);

  return NextResponse.json({
    ok: true,
    session: summary.session,
    circleId: summary.circleId,
    circleName: summary.circleName,
    venue: summary.venue,
    slots: summary.slots,
    confirmed: summary.confirmed,
    reserves: summary.reserves,
    viewerStatus: summary.viewerStatus,
    rsvpWindowOpensAt: summary.rsvpWindowOpensAt,
    fourthCallActive: isFourthCallActive(summary),
  });
}
