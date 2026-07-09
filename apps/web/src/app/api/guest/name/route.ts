import { NextResponse } from "next/server";
import { getGamesClient } from "@/server/games-db";
import { getGuestUserId, lockGuestName } from "@/server/guest";
import { getGuestToken } from "@/lib/guest-session";

const STATUS_FOR_ERROR: Record<string, number> = {
  invalid_name: 400,
  not_found: 404,
  slot_lost: 409,
};

/**
 * The name step: "Spot held. Who should we say is coming?" -> "Lock it in".
 * Identifies the caller purely via the `cuatro_guest` device cookie set by
 * /api/guest/claim or /api/guest/reserve — there's no session token to pass
 * from the client, which is the whole point of the guest flow.
 */
export async function POST(request: Request) {
  let body: { sessionId?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const { sessionId, name } = body;
  if (!sessionId || typeof name !== "string") return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const token = await getGuestToken();
  if (!token) return NextResponse.json({ ok: false, error: "no_guest_session" }, { status: 401 });

  const { db } = await getGamesClient();
  const guestUserId = getGuestUserId(db, token);
  if (!guestUserId) return NextResponse.json({ ok: false, error: "no_guest_session" }, { status: 401 });

  const outcome = lockGuestName(db, guestUserId, sessionId, name);
  if (!outcome.ok) {
    return NextResponse.json({ ok: false, error: outcome.error }, { status: STATUS_FOR_ERROR[outcome.error] ?? 400 });
  }

  return NextResponse.json({ ok: true, displayName: outcome.displayName });
}
