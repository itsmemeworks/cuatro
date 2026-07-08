import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { sessions } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { isOrganiser } from "@/server/standing-games-service";
import { checkFourthCallLevel2 } from "@/server/fourth-call";

/** Organiser-triggered escalation to Fourth Call level 2 — skips the 20-minutes-after-level-1 wait. */
export async function POST(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { sessionId } = await params;
  const { db } = await getGamesClient();

  const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!session) return NextResponse.json({ ok: false, error: "session_not_found" }, { status: 404 });
  if (!isOrganiser(db, session.circleId, user.id)) {
    return NextResponse.json({ ok: false, error: "not_an_organiser" }, { status: 403 });
  }

  const result = checkFourthCallLevel2(db, sessionId, new Date(), { forceEscalate: true });
  return NextResponse.json({ ok: true, result });
}
