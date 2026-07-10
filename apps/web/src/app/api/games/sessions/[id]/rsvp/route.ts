import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { markAvailable, markUnavailable, rsvpIn, rsvpOut } from "@/server/games-service";

// Plain games use "in"/"out" (hold/drop a slot). Rotation games pre-lock use
// "available"/"unavailable" (declare availability — the four are chosen at
// lock, not first-come). Post-lock a rotation game reverts to "in"/"out"
// semantics, so all four verbs share this one endpoint.
const ACTIONS = ["in", "out", "available", "unavailable"] as const;
type RsvpAction = (typeof ACTIONS)[number];

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

  if (!ACTIONS.includes(body.action as RsvpAction)) {
    return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
  }
  const action = body.action as RsvpAction;

  const { db } = await getGamesClient();
  const outcome =
    action === "in"
      ? rsvpIn(db, id, user.id)
      : action === "out"
        ? rsvpOut(db, id, user.id)
        : action === "available"
          ? markAvailable(db, id, user.id)
          : markUnavailable(db, id, user.id);

  if (!outcome.ok) {
    const status = outcome.error === "session_not_found" ? 404 : outcome.error === "not_a_circle_member" ? 403 : 400;
    return NextResponse.json({ ok: false, error: outcome.error }, { status });
  }
  return NextResponse.json({
    ok: true,
    status: outcome.status,
    promotedUserId: "promotedUserId" in outcome ? outcome.promotedUserId : undefined,
  });
}
