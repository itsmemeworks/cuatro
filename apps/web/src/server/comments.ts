/**
 * 💬 comments on a verified match's Feed result post (design/DESIGN-AUDIT.md
 * F1). Sibling to server/feed.ts (the Feed read model that surfaces the
 * count this module maintains) rather than folded into it — feed.ts's own
 * header already draws the line between "aggregation over already-verified
 * matches" and a mutation surface; this file is the mutation surface for
 * comments the same way server/tab.ts is for tab_entries.
 *
 * Gates mirror server/feed.ts's toggleRespect exactly: circle-membership
 * (derived via the match's session, since match_comments carries no
 * circle_id of its own) + the match must be verified — a comment thread on
 * a still-pending_confirmation match would be commenting on a score that
 * might yet flip to disputed/void.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  circleMembers,
  matchComments,
  matches,
  sessions,
  users,
  type CuatroDb,
  type Match,
} from "@cuatro/db";
import { insertNotification } from "./notify";
import { emitCircleEvent } from "@/lib/realtime/broadcast";

export const MAX_COMMENT_LENGTH = 1000;

export interface CommentView {
  id: string;
  matchId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  body: string;
  createdAt: Date;
}

export type CommentGateError = "match_not_found" | "match_not_verified" | "not_a_circle_member";

async function isMember(db: CuatroDb, circleId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: circleMembers.userId })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)));
  return !!row;
}

/** Loads the match + its circle, applying the shared verified+member gate. Returns the gate error, or the match and circleId on success. */
async function loadGated(
  db: CuatroDb,
  matchId: string,
  userId: string,
): Promise<{ ok: true; match: Match; circleId: string } | { ok: false; error: CommentGateError }> {
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) return { ok: false, error: "match_not_found" };
  if (match.status !== "verified") return { ok: false, error: "match_not_verified" };

  const [session] = await db.select({ circleId: sessions.circleId }).from(sessions).where(eq(sessions.id, match.sessionId));
  if (!session) return { ok: false, error: "match_not_found" };

  if (!(await isMember(db, session.circleId, userId))) return { ok: false, error: "not_a_circle_member" };
  return { ok: true, match, circleId: session.circleId };
}

function fourPlayerIds(match: Match): string[] {
  return [match.teamAPlayer1Id, match.teamAPlayer2Id, match.teamBPlayer1Id, match.teamBPlayer2Id];
}

export type AddCommentOutcome =
  | { ok: true; comment: CommentView; count: number }
  | { ok: false; error: CommentGateError | "empty_body" | "too_long" };

/**
 * Posts a comment on a verified match's result post. On the FIRST comment
 * ever on a match, notifies the OTHER participants (not the commenter) —
 * every comment after that is assumed already-watched territory for anyone
 * who's seen the thread notification once (mirrors tab.ts's nudgeEntry
 * "fires once" posture, just keyed on thread-empty rather than a column).
 */
export async function addComment(db: CuatroDb, matchId: string, userId: string, body: string): Promise<AddCommentOutcome> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "empty_body" };
  if (trimmed.length > MAX_COMMENT_LENGTH) return { ok: false, error: "too_long" };

  const gated = await loadGated(db, matchId, userId);
  if (!gated.ok) return gated;
  const { match, circleId } = gated;

  const outcome = await db.transaction(async (tx) => {
    // Lock the match row so the "first comment on this match" decision (which
    // fires the participant notifications) serializes — two racing first
    // comments must not both see an empty thread and double-notify.
    await tx.select({ id: matches.id }).from(matches).where(eq(matches.id, matchId)).for("update");

    const existing = await tx.select({ id: matchComments.id }).from(matchComments).where(eq(matchComments.matchId, matchId));
    const existingCount = existing.length;

    const [row] = await tx.insert(matchComments).values({ matchId, userId, body: trimmed }).returning();
    const [author] = await tx.select({ displayName: users.displayName, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, userId));

    if (existingCount === 0) {
      for (const participantId of fourPlayerIds(match)) {
        if (participantId === userId) continue;
        await insertNotification(tx, { userId: participantId, type: "match_comment", payload: { matchId, commenterId: userId } });
      }
    }

    const comment: CommentView = {
      id: row.id,
      matchId: row.matchId,
      userId: row.userId,
      displayName: author?.displayName ?? "Unknown",
      avatarUrl: author?.avatarUrl ?? null,
      body: row.body,
      createdAt: new Date(row.createdAt),
    };
    return { ok: true as const, comment, count: existingCount + 1 };
  });

  emitCircleEvent(circleId, "comment", { matchId });
  return outcome;
}

export type ListCommentsOutcome = { ok: true; comments: CommentView[] } | { ok: false; error: CommentGateError };

/** The full thread for a match's result post, oldest first (composer appends at the bottom). */
export async function listComments(db: CuatroDb, matchId: string, viewerUserId: string): Promise<ListCommentsOutcome> {
  const gated = await loadGated(db, matchId, viewerUserId);
  if (!gated.ok) return gated;

  const rows = await db
    .select({
      id: matchComments.id,
      matchId: matchComments.matchId,
      userId: matchComments.userId,
      body: matchComments.body,
      createdAt: matchComments.createdAt,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(matchComments)
    .innerJoin(users, eq(matchComments.userId, users.id))
    .where(eq(matchComments.matchId, matchId))
    // created_at then id: a stable order within the same millisecond (Postgres
    // has no rowid tiebreak). match_comments has no monotonic seq column.
    .orderBy(asc(matchComments.createdAt), asc(matchComments.id));

  return { ok: true, comments: rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt) })) };
}

/**
 * Batched comment counts for a set of matches — the Feed's 💬N chip (see
 * server/feed.ts), same shape as that module's own reactionsByMatch
 * aggregation over match_reactions.
 */
export async function getCommentCounts(db: CuatroDb, matchIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (matchIds.length === 0) return counts;

  const rows = await db.select({ matchId: matchComments.matchId }).from(matchComments).where(inArray(matchComments.matchId, matchIds));
  for (const row of rows) {
    counts.set(row.matchId, (counts.get(row.matchId) ?? 0) + 1);
  }
  return counts;
}
