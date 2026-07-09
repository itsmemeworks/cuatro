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

function isMember(db: CuatroDb, circleId: string, userId: string): boolean {
  return !!db
    .select({ userId: circleMembers.userId })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)))
    .get();
}

/** Loads the match + its circle, applying the shared verified+member gate. Returns the gate error, or the match and circleId on success. */
function loadGated(
  db: CuatroDb,
  matchId: string,
  userId: string,
): { ok: true; match: Match; circleId: string } | { ok: false; error: CommentGateError } {
  const match = db.select().from(matches).where(eq(matches.id, matchId)).get();
  if (!match) return { ok: false, error: "match_not_found" };
  if (match.status !== "verified") return { ok: false, error: "match_not_verified" };

  const session = db.select({ circleId: sessions.circleId }).from(sessions).where(eq(sessions.id, match.sessionId)).get();
  if (!session) return { ok: false, error: "match_not_found" };

  if (!isMember(db, session.circleId, userId)) return { ok: false, error: "not_a_circle_member" };
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
export function addComment(db: CuatroDb, matchId: string, userId: string, body: string): AddCommentOutcome {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "empty_body" };
  if (trimmed.length > MAX_COMMENT_LENGTH) return { ok: false, error: "too_long" };

  const gated = loadGated(db, matchId, userId);
  if (!gated.ok) return gated;
  const { match, circleId } = gated;

  const outcome = db.transaction((tx) => {
    const existingCount = tx.select({ id: matchComments.id }).from(matchComments).where(eq(matchComments.matchId, matchId)).all().length;

    const row = tx.insert(matchComments).values({ matchId, userId, body: trimmed }).returning().get();
    const author = tx.select({ displayName: users.displayName, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, userId)).get();

    if (existingCount === 0) {
      for (const participantId of fourPlayerIds(match)) {
        if (participantId === userId) continue;
        insertNotification(tx, { userId: participantId, type: "match_comment", payload: { matchId, commenterId: userId } });
      }
    }

    const comment: CommentView = {
      id: row.id,
      matchId: row.matchId,
      userId: row.userId,
      displayName: author?.displayName ?? "Unknown",
      avatarUrl: author?.avatarUrl ?? null,
      body: row.body,
      createdAt: row.createdAt,
    };
    return { ok: true as const, comment, count: existingCount + 1 };
  });

  emitCircleEvent(circleId, "comment", { matchId });
  return outcome;
}

export type ListCommentsOutcome = { ok: true; comments: CommentView[] } | { ok: false; error: CommentGateError };

/** The full thread for a match's result post, oldest first (composer appends at the bottom). */
export function listComments(db: CuatroDb, matchId: string, viewerUserId: string): ListCommentsOutcome {
  const gated = loadGated(db, matchId, viewerUserId);
  if (!gated.ok) return gated;

  const rows = db
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
    .orderBy(asc(matchComments.createdAt))
    .all();

  return { ok: true, comments: rows };
}

/**
 * Batched comment counts for a set of matches — the Feed's 💬N chip (see
 * server/feed.ts), same shape as that module's own reactionsByMatch
 * aggregation over match_reactions.
 */
export function getCommentCounts(db: CuatroDb, matchIds: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  if (matchIds.length === 0) return counts;

  const rows = db.select({ matchId: matchComments.matchId }).from(matchComments).where(inArray(matchComments.matchId, matchIds)).all();
  for (const row of rows) {
    counts.set(row.matchId, (counts.get(row.matchId) ?? 0) + 1);
  }
  return counts;
}
