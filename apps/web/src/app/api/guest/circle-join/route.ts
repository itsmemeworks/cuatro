import { NextResponse } from "next/server";
import { getGamesClient } from "@/server/games-db";
import { getGuestUserId, joinGuestCircle } from "@/server/guest";
import { getGuestToken, setGuestCookie } from "@/lib/guest-session";

const STATUS_FOR_ERROR: Record<string, number> = {
  invalid_name: 400,
  circle_not_found: 404,
  circle_full: 409,
};

/**
 * The circle-invite counterpart to /api/guest/claim — a logged-out visitor on
 * /join/[code] joins the Circle as a guest with just a name, no sign-in (the
 * growth-loop 10-second promise). No credential beyond the invite code in the
 * body: an invite code IS the authority to join (same trust model as the
 * signed-in join action, which only needs the code too). If the caller's
 * device cookie already resolves to a guest identity, joinGuestCircle reuses
 * it (one device, one guest) and returns token=null, so we leave the cookie
 * alone; otherwise a fresh guest row + device token is minted and set here.
 */
export async function POST(request: Request) {
  let body: { code?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const { code, name } = body;
  if (!code || typeof name !== "string") {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const { db } = await getGamesClient();
  const existingToken = await getGuestToken();
  const existingGuestUserId = existingToken ? await getGuestUserId(db, existingToken) : null;

  const outcome = await joinGuestCircle(db, { inviteCode: code, rawName: name, existingGuestUserId });
  if (!outcome.ok) {
    return NextResponse.json({ ok: false, error: outcome.error }, { status: STATUS_FOR_ERROR[outcome.error] ?? 400 });
  }

  if (outcome.token) await setGuestCookie(outcome.token);
  return NextResponse.json({ ok: true, circleId: outcome.circleId, displayName: outcome.displayName });
}
