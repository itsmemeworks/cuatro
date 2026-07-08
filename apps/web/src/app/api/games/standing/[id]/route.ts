import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { getStandingGame, updateStandingGame } from "@/server/standing-games-service";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const { db } = await getGamesClient();
  const standingGame = getStandingGame(db, id);
  if (!standingGame) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  return NextResponse.json({ ok: true, standingGame });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const { db } = await getGamesClient();
  const result = updateStandingGame(db, user.id, id, {
    weekday: body.weekday !== undefined ? Number(body.weekday) : undefined,
    startTime: typeof body.startTime === "string" ? body.startTime : undefined,
    durationMinutes: body.durationMinutes !== undefined ? Number(body.durationMinutes) : undefined,
    slots: body.slots !== undefined ? Number(body.slots) : undefined,
    rsvpWindowDays: body.rsvpWindowDays !== undefined ? Number(body.rsvpWindowDays) : undefined,
    venueId: typeof body.venueId === "string" ? body.venueId : undefined,
    venueName: typeof body.venueName === "string" ? body.venueName : undefined,
    active: typeof body.active === "boolean" ? body.active : undefined,
  });

  if (!result.ok) {
    const status = result.error === "not_an_organiser" ? 403 : result.error === "not_found" ? 404 : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, standingGame: result.value });
}
