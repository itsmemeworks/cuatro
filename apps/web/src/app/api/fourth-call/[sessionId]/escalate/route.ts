import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { sessions } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { isOrganiser } from "@/server/standing-games-service";
import { checkFourthCallLocalRing, checkFourthCallPlayedWith } from "@/server/games-service";
import { getRing3ClaimLink } from "@/server/fourth-call";

/**
 * Organiser-triggered escalation, one ring per call, following the Fourth Call
 * ladder: circle (ring 1, automatic) -> played-with (ring 2a) -> nearby (ring
 * 2b, the geo Local Ring) -> link (ring 3). Each manual step skips the
 * 20-minutes-after-ring-1 wait (forceEscalate).
 *
 *  - `{ ring: "played_with" }` invites everyone from the four's verified match
 *    history; `{ ring: "played_with", userId }` invites just that one person
 *    (the send screen's per-person "Invite" buttons). Never nags anyone twice.
 *  - `{ level: 2 }` or no body opens the geo Local Ring (the pre-existing
 *    "Reach nearby players" caller sends no body — kept working unchanged).
 *  - `{ level: 3 }` mints/re-derives the ring-3 public claim link (a pure
 *    function of sessionId+kickoff time, so there's nothing to "fire").
 */
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { sessionId } = await params;
  const { db } = await getGamesClient();

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session) return NextResponse.json({ ok: false, error: "session_not_found" }, { status: 404 });
  if (!(await isOrganiser(db, session.circleId, user.id))) {
    return NextResponse.json({ ok: false, error: "not_an_organiser" }, { status: 403 });
  }

  let level: 2 | 3 = 2;
  let ring: "played_with" | null = null;
  let onlyUserIds: string[] | undefined;
  try {
    const body = await request.json();
    if (body && typeof body === "object") {
      if (body.level === 3) level = 3;
      if (body.ring === "played_with") {
        ring = "played_with";
        if (typeof body.userId === "string") onlyUserIds = [body.userId];
      }
    }
  } catch {
    // No body (or non-JSON) — the pre-existing caller (ring 2b's "Reach nearby
    // players") never sent one; default to the geo ring unchanged.
  }

  if (ring === "played_with") {
    const result = await checkFourthCallPlayedWith(db, sessionId, new Date(), { forceEscalate: true, onlyUserIds });
    return NextResponse.json({ ok: true, ring: "played_with", result });
  }

  if (level === 3) {
    const linkResult = await getRing3ClaimLink(db, sessionId, new Date());
    if (!linkResult.ok) {
      return NextResponse.json({ ok: false, error: linkResult.error }, { status: linkResult.error === "session_not_found" ? 404 : 400 });
    }
    return NextResponse.json({ ok: true, level: 3, path: linkResult.value.path, expiresAt: linkResult.value.expiresAt.toISOString() });
  }

  const result = await checkFourthCallLocalRing(db, sessionId, new Date(), { forceEscalate: true });
  return NextResponse.json({ ok: true, level: 2, result });
}
