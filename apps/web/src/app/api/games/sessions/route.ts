import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { createOneOffSession } from "@/server/games-service";

/** Creates a one-off session (no standing_game_id) — organiser-only, like Standing Game CRUD. */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  if (typeof body.circleId !== "string" || typeof body.startsAt !== "string") {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  const startsAt = new Date(body.startsAt);
  if (Number.isNaN(startsAt.getTime())) {
    return NextResponse.json({ ok: false, error: "invalid_starts_at" }, { status: 400 });
  }

  const { db } = await getGamesClient();
  const result = await createOneOffSession(db, user.id, {
    circleId: body.circleId,
    startsAt,
    venueId: typeof body.venueId === "string" ? body.venueId : null,
    venueName: typeof body.venueName === "string" ? body.venueName : null,
    gameType: body.gameType === "friendly" ? "friendly" : body.gameType === "competitive" ? "competitive" : undefined,
  });

  if (!result.ok) {
    const status = result.error === "not_an_organiser" ? 403 : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, session: result.value });
}
