import { NextResponse } from "next/server";
import { getGamesClient } from "@/server/games-db";
import { getSessionSummary } from "@/server/games-service";
import { parseRing3ClaimToken } from "@/server/fourth-call";
import { buildIcsEvent } from "@/lib/ics";

/**
 * The guest done screen's "Add to calendar" chip. Same public trust model
 * as the /fc/[token] page itself (getSessionSummary has no membership
 * gate) — the ring-3 token is the only credential needed, so this stays
 * unauthenticated rather than requiring the guest cookie too.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = parseRing3ClaimToken(token);
  if (!parsed) return new NextResponse("Not found", { status: 404 });

  const { db } = await getGamesClient();
  const summary = getSessionSummary(db, parsed.sessionId, "");
  if (!summary) return new NextResponse("Not found", { status: 404 });

  const durationMinutes = summary.standingGame?.durationMinutes ?? 90;
  const endsAt = new Date(summary.session.startsAt.getTime() + durationMinutes * 60_000);
  const ics = buildIcsEvent({
    uid: `cuatro-session-${summary.session.id}@cuatro.app`,
    title: `${summary.circleName} · CUATRO`,
    location: summary.venue?.name ?? undefined,
    startsAt: summary.session.startsAt,
    endsAt,
  });

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="cuatro-game.ics"',
    },
  });
}
