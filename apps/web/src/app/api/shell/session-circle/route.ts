import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { circleMembers } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { circleIdForSession } from "@/server/shell-circle";

/**
 * GET /api/shell/session-circle?id=<sessionId> — the one data edge the shell's
 * CLIENT-side context derivation needs (fix wave F3, QA7's stale-chrome fix):
 * which circle a /games/[sessionId] page belongs to. Mirrors the (app)
 * layout's SSR override exactly — server/shell-circle.ts lookup, then a
 * membership check, so the answer for a non-member or an unknown session is
 * `circleId: null` (the chrome keeps home:week) and an outsider can't use
 * this endpoint to confirm a session→circle edge they're not part of.
 * Two indexed single-row reads; the client caches per sessionId.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const sessionId = request.nextUrl.searchParams.get("id");
  if (!sessionId) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const { db } = await getDb();
  const circleId = await circleIdForSession(db, sessionId);
  if (!circleId) return NextResponse.json({ ok: true, circleId: null });

  const [membership] = await db
    .select({ userId: circleMembers.userId })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, user.id)))
    .limit(1);

  return NextResponse.json({ ok: true, circleId: membership ? circleId : null });
}
