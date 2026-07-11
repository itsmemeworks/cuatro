/**
 * The one data-aware piece of shell context resolution (Wave C punch item):
 * /games/[sessionId] renders inside the session's CIRCLE context, and the
 * session→circle edge lives in the DB. One indexed read, nothing else — kept
 * apart from server/shell.ts (same "avoid coupling to a module being changed
 * concurrently" posture as server/circle-unread.ts). Lead-owned shell file.
 */
import { eq } from "drizzle-orm";
import { sessions, type CuatroDb } from "@cuatro/db";

/** The circle a session belongs to, or null when the session doesn't exist. Membership is the caller's check — the (app) layout already holds the viewer's circle list. */
export async function circleIdForSession(db: CuatroDb, sessionId: string): Promise<string | null> {
  const [row] = await db
    .select({ circleId: sessions.circleId })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  return row?.circleId ?? null;
}
