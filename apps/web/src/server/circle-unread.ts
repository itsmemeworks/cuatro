/**
 * Chat unread tracking (design/DESIGN-AUDIT.md F3): `circle_members.last_read_at`
 * is the one column this owns. Kept apart from server/circles.ts — same
 * "avoid coupling to a module being changed concurrently" reasoning
 * server/tab.ts's header already gives for reading circle_members directly
 * rather than going through that store — and it's the same third-thing
 * shape as server/feed.ts: a read model (+ one small write) layered over
 * tables another module owns the CRUD for.
 */
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { circleMembers, circleMessages, type CuatroDb } from "@cuatro/db";

/** Stamps `now` (epoch ms) as the last time `userId` opened `circleId`'s chat. False if they aren't a member (the update matches no row — detected via `.returning()`). */
export async function markCircleRead(db: CuatroDb, circleId: string, userId: string, now: number = Date.now()): Promise<boolean> {
  const updated = await db
    .update(circleMembers)
    .set({ lastReadAt: now })
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)))
    .returning({ userId: circleMembers.userId });
  return updated.length > 0;
}

/**
 * Messages in `circleId` newer than the viewer's `last_read_at`, excluding
 * their own — a viewer's own messages never count as unread for them. A
 * null `last_read_at` (never opened the chat) means every other member's
 * message counts. Returns 0 for a non-member rather than throwing — mirrors
 * hasOpenEntriesAgainstViewer's (tab.ts) "quietly nothing" posture for a
 * read model that's fed into a nav badge, not a gated mutation.
 */
export async function getUnreadCountForCircle(db: CuatroDb, circleId: string, userId: string): Promise<number> {
  const [membership] = await db
    .select({ lastReadAt: circleMembers.lastReadAt })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)));
  if (!membership) return 0;

  const conditions = [eq(circleMessages.circleId, circleId), ne(circleMessages.userId, userId)];
  if (membership.lastReadAt) conditions.push(gt(circleMessages.createdAt, membership.lastReadAt));

  const [row] = await db.select({ n: sql<number>`cast(count(*) as int)` }).from(circleMessages).where(and(...conditions));
  return row?.n ?? 0;
}

/** Per-circle unread counts for every circle in `circleIds` the viewer belongs to. */
export async function getUnreadCountsForCircles(db: CuatroDb, circleIds: string[], userId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const circleId of circleIds) {
    counts[circleId] = await getUnreadCountForCircle(db, circleId, userId);
  }
  return counts;
}

/** True if the viewer has an unread message in ANY of `circleIds` — powers the nav Circle-item dot (design/DESIGN-AUDIT.md N2). */
export async function hasUnreadMessages(db: CuatroDb, circleIds: string[], userId: string): Promise<boolean> {
  for (const circleId of circleIds) {
    if ((await getUnreadCountForCircle(db, circleId, userId)) > 0) return true;
  }
  return false;
}
