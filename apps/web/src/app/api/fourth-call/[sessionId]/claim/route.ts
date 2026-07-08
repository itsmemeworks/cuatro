import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { claimFourthCallSlot } from "@/server/fourth-call";

/** An invitee taps "I can play" from a Fourth Call notification — fills the slot without requiring circle membership. */
export async function POST(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { sessionId } = await params;
  const { db } = await getGamesClient();

  const outcome = claimFourthCallSlot(db, sessionId, user.id);
  if (!outcome.ok) {
    const status = outcome.error === "session_not_found" ? 404 : outcome.error === "no_fourth_call_invite" ? 403 : 400;
    return NextResponse.json({ ok: false, error: outcome.error }, { status });
  }
  return NextResponse.json({ ok: true, status: outcome.status, alreadyIn: outcome.alreadyIn });
}
