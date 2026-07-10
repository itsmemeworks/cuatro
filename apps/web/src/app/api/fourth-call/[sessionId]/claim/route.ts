import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { claimFourthCallSlot } from "@/server/fourth-call";

/**
 * An invitee taps "I can play" — from a Fourth Call notification (level 1
 * or 2), or from a ring-3 public link (level 3), which posts here with
 * `{ token }` instead of relying on a notification. Either way this fills
 * the slot without requiring circle membership.
 */
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { sessionId } = await params;
  const { db } = await getGamesClient();

  let ring3Token: string | undefined;
  try {
    const body = await request.json();
    if (body && typeof body.token === "string") ring3Token = body.token;
  } catch {
    // No body — the pre-existing notification-based claim never sent one.
  }

  const outcome = await claimFourthCallSlot(db, sessionId, user.id, new Date(), { ring3Token });
  if (!outcome.ok) {
    const status = outcome.error === "session_not_found" ? 404 : outcome.error === "no_fourth_call_invite" ? 403 : 400;
    return NextResponse.json({ ok: false, error: outcome.error }, { status });
  }
  return NextResponse.json({ ok: true, status: outcome.status, alreadyIn: outcome.alreadyIn });
}
