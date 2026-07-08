import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { rsvpIn, rsvpOut } from "@/server/games-service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  if (body.action !== "in" && body.action !== "out") {
    return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
  }

  const { db } = await getGamesClient();
  const outcome = body.action === "in" ? rsvpIn(db, id, user.id) : rsvpOut(db, id, user.id);

  if (!outcome.ok) {
    const status = outcome.error === "session_not_found" ? 404 : outcome.error === "not_a_circle_member" ? 403 : 400;
    return NextResponse.json({ ok: false, error: outcome.error }, { status });
  }
  return NextResponse.json({ ok: true, status: outcome.status, promotedUserId: outcome.promotedUserId });
}
