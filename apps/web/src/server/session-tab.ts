/**
 * "Goes on the Tab" (design/DESIGN-AUDIT.md F4 / S2): one tap, for a PLAYED
 * session with a cost set, creates the Tab split among that session's
 * confirmed slot-holders. A third thing layered over two existing domains —
 * same shape as server/feed.ts (result posts) and server/circle-unread.ts
 * (chat) — rather than a mutation folded into either games-service.ts or
 * tab.ts: it reads a session + its standing game's cost (games-service.ts's
 * concern) and writes tab_entries via tab.ts's own addSplitEntry (tab.ts's
 * concern), so it belongs to neither.
 */
import { and, asc, eq } from "drizzle-orm";
import { circleMembers, tabEntries, type CuatroDb, type TabEntry } from "@cuatro/db";
import { getSessionSummary } from "./games-service";
import { addSplitEntry } from "./tab";

/** Mirrors server/tab.ts's addSplitEntry error union (see that file's AddSplitEntryOutcome) — spelled out rather than derived, since a non-generic conditional type over an already-substituted union doesn't distribute the way it looks like it would. */
type AddSplitEntryError = "not_a_circle_member" | "no_debtors" | "duplicate_debtor" | "payer_is_debtor" | "invalid_amount";

/** "court split · Tue 8 Jul" — every entry a session split creates gets the same description, so a debtor scrolling the Tab's activity feed weeks later still knows which court booking it was for (server/tab.ts's TabEntryView.descriptionLabel falls back to a plainer date-only label when this is ever absent, e.g. for entries created before this field existed). */
function formatSessionDateLabel(playedAt: Date): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(playedAt);
}

export type CreateTabSplitOutcome =
  | { ok: true; entries: TabEntry[]; payerShareMinor: number; alreadyExisted: boolean }
  | { ok: false; error: "session_not_found" | "not_played" | "no_cost_set" | AddSplitEntryError };

/** True if a Tab split has already been created for this session — the idempotency guard `createTabSplitForSession` itself relies on. */
export async function hasTabSplitForSession(db: CuatroDb, sessionId: string): Promise<boolean> {
  const [row] = await db.select({ id: tabEntries.id }).from(tabEntries).where(eq(tabEntries.sessionId, sessionId));
  return !!row;
}

async function isCircleMember(db: CuatroDb, circleId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: circleMembers.userId })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)));
  return !!row;
}

/**
 * Idempotent: a repeat call once a split already exists for `sessionId`
 * returns the existing entries with `alreadyExisted: true` rather than
 * creating a second split (guarded by checking tab_entries for this
 * session_id, per the brief — one split per session, ever).
 */
export async function createTabSplitForSession(
  db: CuatroDb,
  sessionId: string,
  requestingUserId: string,
): Promise<CreateTabSplitOutcome> {
  const summary = await getSessionSummary(db, sessionId, requestingUserId);
  if (!summary) return { ok: false, error: "session_not_found" };
  if (!(await isCircleMember(db, summary.circleId, requestingUserId))) return { ok: false, error: "not_a_circle_member" };
  if (summary.session.status !== "played") return { ok: false, error: "not_played" };
  if (summary.costMinor == null) return { ok: false, error: "no_cost_set" };

  const existing = await db.select().from(tabEntries).where(eq(tabEntries.sessionId, sessionId));
  if (existing.length > 0) {
    // payerShareMinor isn't stored on tab_entries (only what OTHERS owe the
    // payer is — see tab.ts's addSplitEntry header); recomputed here purely
    // for display parity with the fresh-creation return shape.
    const payerShareMinor = summary.costMinor - existing.reduce((sum, e) => sum + e.amountMinor, 0);
    return { ok: true, entries: existing, payerShareMinor, alreadyExisted: true };
  }

  const organiserRows = await db
    .select({ userId: circleMembers.userId, role: circleMembers.role })
    .from(circleMembers)
    .where(eq(circleMembers.circleId, summary.circleId))
    .orderBy(asc(circleMembers.joinedAt));
  const payerUserId = organiserRows.find((r) => r.role === "organiser")?.userId ?? organiserRows[0]?.userId;
  if (!payerUserId) return { ok: false, error: "not_a_circle_member" };

  const debtorIds = summary.confirmed.map((p) => p.userId).filter((id) => id !== payerUserId);

  const result = await addSplitEntry(db, {
    circleId: summary.circleId,
    payerUserId,
    debtorUserIds: debtorIds,
    totalAmountMinor: summary.costMinor,
    currency: summary.costCurrency,
    sessionId,
    // summary.session.startsAt is epoch-ms now; wrap for the formatter (a Date
    // passes through new Date() unchanged too, so this is robust either way).
    description: `court split · ${formatSessionDateLabel(new Date(summary.session.startsAt))}`,
  });
  if (!result.ok) return { ok: false, error: result.error };

  return { ok: true, entries: result.entries, payerShareMinor: result.payerShareMinor, alreadyExisted: false };
}
