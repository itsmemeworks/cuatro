import { NextResponse } from "next/server";
import { getGamesClient } from "@/server/games-db";
import { claimGuestSlot } from "@/server/guest";
import { setGuestCookie } from "@/lib/guest-session";

const STATUS_FOR_ERROR: Record<string, number> = {
  session_not_found: 404,
  invalid_link: 403,
  session_started: 410,
  already_full: 409,
};

/**
 * Ring 3's guest claim — the anonymous counterpart to
 * /api/fourth-call/[sessionId]/claim. No sign-in: the ring-3 token itself
 * is the only credential (verified inside claimGuestSlot), so this is safe
 * to call from the public /fc/[token] page's "I can play — claim it" tap.
 * On success sets the `cuatro_guest` device cookie the rest of the flow
 * (name lock, avatar upload, deferred conversion) identifies this claimant
 * by.
 */
export async function POST(request: Request) {
  let body: { sessionId?: string; token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const { sessionId, token } = body;
  if (!sessionId || !token) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const { db } = await getGamesClient();
  const outcome = claimGuestSlot(db, sessionId, token);
  if (!outcome.ok) {
    return NextResponse.json({ ok: false, error: outcome.error }, { status: STATUS_FOR_ERROR[outcome.error] ?? 400 });
  }

  await setGuestCookie(outcome.token);
  return NextResponse.json({ ok: true, status: outcome.status, holdExpiresAt: outcome.holdExpiresAt.toISOString() });
}
