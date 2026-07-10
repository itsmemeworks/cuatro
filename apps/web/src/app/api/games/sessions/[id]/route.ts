import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { checkFourthCallLevel1, getSessionSummary, isFourthCallActive, lockRotationIfDue, offerRotationSlotIfNeeded } from "@/server/games-service";

/** Session detail — also a lazy trigger point for the rotation lock + Fourth Call level-1 check (no cron in v0). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const { db } = await getGamesClient();
  // Lock a due rotation game before reading, so the response carries the locked
  // lineup (no-op otherwise) — same lazy-on-view contract as the Fourth Call.
  lockRotationIfDue(db, id);
  const summary = getSessionSummary(db, id, user.id);
  if (!summary) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const offer = offerRotationSlotIfNeeded(db, id);
  if (offer.state === "exhausted" || offer.state === "not_applicable") checkFourthCallLevel1(db, id);

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
    rotation: summary.rotation,
    rsvpWindowOpensAt: summary.rsvpWindowOpensAt,
    fourthCallActive: isFourthCallActive(summary),
  });
}
