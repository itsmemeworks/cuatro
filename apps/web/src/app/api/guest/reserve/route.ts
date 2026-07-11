import { NextResponse } from "next/server";
import { getGamesClient } from "@/server/games-db";
import { joinGuestReserveQueue } from "@/server/guest";
import { setGuestCookie } from "@/lib/guest-session";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";

const STATUS_FOR_ERROR: Record<string, number> = {
  session_not_found: 404,
  invalid_link: 403,
  session_started: 410,
};

// Shared per-IP budget across all guest endpoints — see api/guest/claim.
const GUEST_LIMIT = { max: 30, windowMs: 5 * 60_000 };

/**
 * Race-loser path: "X beat you to it" -> "Join the reserve queue", one tap,
 * still no account. Mirrors /api/guest/claim's shape but always succeeds
 * (barring an invalid/expired link) since a reserve queue has no capacity
 * cap.
 */
export async function POST(request: Request) {
  const limited = enforceRateLimit([{ key: `guest:${clientIp(request)}`, ...GUEST_LIMIT }]);
  if (limited) return limited;

  let body: { sessionId?: string; token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const { sessionId, token } = body;
  if (!sessionId || !token) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const { db } = await getGamesClient();
  const outcome = await joinGuestReserveQueue(db, sessionId, token);
  if (!outcome.ok) {
    return NextResponse.json({ ok: false, error: outcome.error }, { status: STATUS_FOR_ERROR[outcome.error] ?? 400 });
  }

  await setGuestCookie(outcome.token);
  return NextResponse.json({ ok: true, status: outcome.status, position: outcome.position });
}
