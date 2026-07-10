import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { createStandingGame, listStandingGamesForCircle } from "@/server/standing-games-service";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const circleId = request.nextUrl.searchParams.get("circleId");
  if (!circleId) return NextResponse.json({ ok: false, error: "missing_circle_id" }, { status: 400 });

  const { db } = await getGamesClient();
  const games = await listStandingGamesForCircle(db, circleId);
  return NextResponse.json({ ok: true, standingGames: games });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  if (typeof body.circleId !== "string" || typeof body.startTime !== "string") {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const { db } = await getGamesClient();
  const result = await createStandingGame(db, user.id, {
    circleId: body.circleId,
    weekday: Number(body.weekday),
    startTime: body.startTime,
    durationMinutes: body.durationMinutes !== undefined ? Number(body.durationMinutes) : undefined,
    slots: body.slots !== undefined ? Number(body.slots) : undefined,
    rsvpWindowDays: body.rsvpWindowDays !== undefined ? Number(body.rsvpWindowDays) : undefined,
    venueId: typeof body.venueId === "string" ? body.venueId : null,
    venueName: typeof body.venueName === "string" ? body.venueName : null,
  });

  if (!result.ok) {
    const status = result.error === "not_an_organiser" ? 403 : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, standingGame: result.value });
}
