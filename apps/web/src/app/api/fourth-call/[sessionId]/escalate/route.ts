import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { sessions } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { isOrganiser } from "@/server/standing-games-service";
import { checkFourthCallLocalRing } from "@/server/games-service";
import { getRing3ClaimLink } from "@/server/fourth-call";

/**
 * Organiser-triggered escalation. Default (no body, or `{ level: 2 }`) opens
 * the Local Ring — reaches nearby, level-matched players — skipping the
 * 20-minutes-after-ring-1 wait. `{ level: 3 }` mints/re-derives the ring-3
 * public claim link instead (see getRing3ClaimLink — pure function of
 * sessionId+kickoff time, so there's nothing to "fire" or mark as already-sent).
 */
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { sessionId } = await params;
  const { db } = await getGamesClient();

  const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!session) return NextResponse.json({ ok: false, error: "session_not_found" }, { status: 404 });
  if (!isOrganiser(db, session.circleId, user.id)) {
    return NextResponse.json({ ok: false, error: "not_an_organiser" }, { status: 403 });
  }

  let level: 2 | 3 = 2;
  try {
    const body = await request.json();
    if (body && typeof body === "object" && body.level === 3) level = 3;
  } catch {
    // No body (or non-JSON) — the pre-existing caller (ring 2's "Escalate
    // now") never sent one; default to level 2 unchanged.
  }

  if (level === 3) {
    const linkResult = getRing3ClaimLink(db, sessionId, new Date());
    if (!linkResult.ok) {
      return NextResponse.json({ ok: false, error: linkResult.error }, { status: linkResult.error === "session_not_found" ? 404 : 400 });
    }
    return NextResponse.json({ ok: true, level: 3, path: linkResult.value.path, expiresAt: linkResult.value.expiresAt.toISOString() });
  }

  const result = await checkFourthCallLocalRing(db, sessionId, new Date(), { forceEscalate: true });
  return NextResponse.json({ ok: true, level: 2, result });
}
