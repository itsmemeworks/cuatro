import { NextResponse } from "next/server";
import { getGamesClient } from "@/server/games-db";
import { getGuestUserId } from "@/server/guest";
import { rsvpIn, rsvpOut } from "@/server/games-service";
import { getGuestToken } from "@/lib/guest-session";

const STATUS_FOR_ERROR: Record<string, number> = {
  session_not_found: 404,
  not_a_circle_member: 403,
  window_not_open: 409,
  session_started: 410,
};

/**
 * A guest circle member RSVPs to the circle's next game — cookie-identified,
 * never a signed-in session, so guests stay out of the (app)/* routes their
 * gate forbids. The guest is a real circle_members row (joinGuestCircle), so
 * rsvpIn/rsvpOut's own isCircleMember check is the authorization: a cookie
 * that resolves to a guest who isn't a member of the session's circle gets
 * `not_a_circle_member`, exactly as a non-member signed-in user would.
 */
export async function POST(request: Request) {
  let body: { sessionId?: string; direction?: "in" | "out" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const { sessionId, direction = "in" } = body;
  if (!sessionId) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const token = await getGuestToken();
  if (!token) return NextResponse.json({ ok: false, error: "no_guest_session" }, { status: 401 });

  const { db } = await getGamesClient();
  const guestUserId = getGuestUserId(db, token);
  if (!guestUserId) return NextResponse.json({ ok: false, error: "no_guest_session" }, { status: 401 });

  const outcome = direction === "out" ? rsvpOut(db, sessionId, guestUserId) : rsvpIn(db, sessionId, guestUserId);
  if (!outcome.ok) {
    return NextResponse.json({ ok: false, error: outcome.error }, { status: STATUS_FOR_ERROR[outcome.error] ?? 400 });
  }

  return NextResponse.json({ ok: true, status: outcome.status });
}
