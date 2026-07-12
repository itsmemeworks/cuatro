/**
 * The Tab — zero-platform-risk money (see DESIGN.md §2 "THE TAB"). Cuatro
 * never moves money; this module only ever records who owes whom and lets
 * the two sides confirm settlement between themselves. Backed by
 * @cuatro/db (drizzle + postgres-js) through the shared connection in
 * ./db.ts (see that file's header for why every server module shares one
 * connection).
 *
 * Style follows games-service.ts: every mutating function here is a plain
 * async function taking an already-open `CuatroDb` and running its critical
 * section inside a single `await db.transaction(async (tx) => ...)`. Postgres
 * MVCC does NOT serialize writers, so the read-then-write critical sections
 * (nudge-once, the two-step settle confirmation) take an explicit
 * `.for("update")` row lock on the tab_entries row before deciding — see the
 * LOCK comments on nudgeEntry and proposeOrConfirmSettle.
 *
 * This module reads `circle_members`/`users` directly (see
 * isCircleMember/listCircleMembers) rather than going through
 * server/circles.ts's store — the same choice games-service.ts already
 * made, and it avoids coupling to that module's abstraction while it's
 * being changed concurrently by another agent.
 */
import { and, eq } from "drizzle-orm";
import {
  circleMembers,
  circles,
  notifications,
  tabEntries,
  tabs,
  users,
  type CuatroDb,
  type Tab,
  type TabEntry,
} from "@cuatro/db";
import { insertNotification } from "./notify";
import { formatWeekdayLong, DEFAULT_TZ } from "@/lib/time";
import { emitCircleEvent, emitUserEvent } from "@/lib/realtime/broadcast";

// ---------------------------------------------------------------------------
// Pure money maths — no DB, unit-testable in isolation.
// ---------------------------------------------------------------------------

export interface EqualSplitResult {
  /** What each named debtor owes the payer (minor units). */
  shareMinor: number;
  /** The payer's own portion — never written as a ledger row, just returned for display. */
  payerShareMinor: number;
  numPeople: number;
}

/**
 * Splits `totalAmountMinor` evenly across the payer + every named debtor.
 *
 * Penny-remainder rule (documented and tested): every debtor's share is the
 * FLOOR of the even split; the payer keeps whatever pennies don't divide
 * evenly. This means no debtor is ever asked for a penny more than their
 * equal floor share — the person who already fronted the cash absorbs the
 * rounding, which is the generous-by-default direction for a product whose
 * whole pitch is "no fees, no sneaky lobs" (see HANDOFF.md's Onboarding
 * footer). It also guarantees no penny of the original amount is ever lost:
 * `shareMinor * debtorCount + payerShareMinor === totalAmountMinor` always.
 *
 * Example: £32.00 (3200p) across a payer + 2 debtors (3 people) —
 * shareMinor = floor(3200/3) = 1066p each debtor, payerShareMinor =
 * 3200 - 1066*2 = 1068p (the payer keeps the 2p that didn't divide evenly).
 */
export function computeEqualSplit(totalAmountMinor: number, debtorCount: number): EqualSplitResult {
  if (!Number.isInteger(totalAmountMinor) || totalAmountMinor <= 0) {
    throw new Error("computeEqualSplit: totalAmountMinor must be a positive integer (minor units)");
  }
  if (!Number.isInteger(debtorCount) || debtorCount <= 0) {
    throw new Error("computeEqualSplit: debtorCount must be a positive integer");
  }
  const numPeople = debtorCount + 1; // the payer + every named debtor
  const shareMinor = Math.floor(totalAmountMinor / numPeople);
  const payerShareMinor = totalAmountMinor - shareMinor * debtorCount;
  return { shareMinor, payerShareMinor, numPeople };
}

export interface TabEntryLike {
  payerUserId: string;
  debtorUserId: string;
  amountMinor: number;
  currency: string;
  status: "open" | "nudged" | "settled";
}

export interface CounterpartyBalance {
  counterpartyUserId: string;
  currency: string;
  /** Positive: the counterparty owes `userId`. Negative: `userId` owes the counterparty. Zero balances are never returned — that pair is "all square" in this currency. */
  netMinor: number;
}

/**
 * Every unsettled balance `userId` has with each other person they share an
 * entry with, netted per currency. Currency isolation: a GBP debt and a EUR
 * debt between the same two people are never combined into one number —
 * they're two separate rows, always. Settled entries don't count (money has
 * already changed hands for those).
 */
export function computeCounterpartyBalances(entries: TabEntryLike[], userId: string): CounterpartyBalance[] {
  const totals = new Map<string, number>(); // key: `${counterpartyId}\x00${currency}`
  for (const e of entries) {
    if (e.status === "settled") continue;
    if (e.payerUserId === userId) {
      const key = `${e.debtorUserId}\x00${e.currency}`;
      totals.set(key, (totals.get(key) ?? 0) + e.amountMinor);
    } else if (e.debtorUserId === userId) {
      const key = `${e.payerUserId}\x00${e.currency}`;
      totals.set(key, (totals.get(key) ?? 0) - e.amountMinor);
    }
  }

  const balances: CounterpartyBalance[] = [];
  for (const [key, netMinor] of totals) {
    if (netMinor === 0) continue;
    const [counterpartyUserId, currency] = key.split("\x00");
    balances.push({ counterpartyUserId, currency, netMinor });
  }
  return balances;
}

/** `userId`'s overall net position, per currency — the sum of computeCounterpartyBalances. Positive: owed money, net. Negative: owes money, net. A currency with no unsettled entries never appears (not zero — absent). */
export function computeNetPosition(entries: TabEntryLike[], userId: string): Record<string, number> {
  const byCurrency: Record<string, number> = {};
  for (const b of computeCounterpartyBalances(entries, userId)) {
    byCurrency[b.currency] = (byCurrency[b.currency] ?? 0) + b.netMinor;
  }
  return byCurrency;
}

export interface MemberNetPosition {
  userId: string;
  currency: string;
  /** Positive: owed money, net. Negative: owes money, net. */
  netMinor: number;
}

/** Every member's overall net position across a whole Circle's unsettled entries, per currency — the same currency-isolation rule as computeCounterpartyBalances applies. */
export function computeMemberNetPositions(entries: TabEntryLike[]): MemberNetPosition[] {
  const totals = new Map<string, number>();
  for (const e of entries) {
    if (e.status === "settled") continue;
    const payerKey = `${e.payerUserId}\x00${e.currency}`;
    const debtorKey = `${e.debtorUserId}\x00${e.currency}`;
    totals.set(payerKey, (totals.get(payerKey) ?? 0) + e.amountMinor);
    totals.set(debtorKey, (totals.get(debtorKey) ?? 0) - e.amountMinor);
  }
  return [...totals.entries()].map(([key, netMinor]) => {
    const [userId, currency] = key.split("\x00");
    return { userId, currency, netMinor };
  });
}

// ---------------------------------------------------------------------------
// Membership helpers (read circle_members/users directly — see file header)
// ---------------------------------------------------------------------------

async function isCircleMember(db: CuatroDb, circleId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: circleMembers.userId })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)));
  return !!row;
}

export interface MemberRef {
  userId: string;
  displayName: string;
}

export function listCircleMembers(db: CuatroDb, circleId: string): Promise<MemberRef[]> {
  return db
    .select({ userId: users.id, displayName: users.displayName })
    .from(circleMembers)
    .innerJoin(users, eq(circleMembers.userId, users.id))
    .where(eq(circleMembers.circleId, circleId));
}

// ---------------------------------------------------------------------------
// Tab lifecycle
// ---------------------------------------------------------------------------

async function getOrCreateTabTx(tx: CuatroDb, circleId: string): Promise<Tab> {
  const [existing] = await tx.select().from(tabs).where(eq(tabs.circleId, circleId));
  if (existing) return existing;
  const [created] = await tx.insert(tabs).values({ circleId }).returning();
  return created;
}

/** Lazily ensures the one Tab row for a Circle exists (tabs.circleId is unique — see packages/db/src/schema/tabs.ts). Idempotent. */
export function ensureTabForCircle(db: CuatroDb, circleId: string): Promise<Tab> {
  return db.transaction((tx) => getOrCreateTabTx(tx, circleId));
}

// ---------------------------------------------------------------------------
// Adding a split entry
// ---------------------------------------------------------------------------

/** A "what for" note exceeding this is truncated, not rejected — same low-stakes posture as guest.ts's MAX_GUEST_NAME_LENGTH, since this is a short display label, not a body of text like a comment. */
export const MAX_TAB_ENTRY_DESCRIPTION_LENGTH = 140;

export interface AddSplitEntryInput {
  circleId: string;
  payerUserId: string;
  debtorUserIds: string[];
  totalAmountMinor: number;
  /** ISO 4217. Defaults to GBP (UK-only launch — see DESIGN.md §5). */
  currency?: string;
  sessionId?: string | null;
  /** "court + new balls" (design's Tab screens) — trimmed and capped at MAX_TAB_ENTRY_DESCRIPTION_LENGTH; blank/whitespace-only collapses to null rather than storing an empty string. */
  description?: string | null;
}

export type AddSplitEntryOutcome =
  | { ok: true; entries: TabEntry[]; payerShareMinor: number }
  | {
      ok: false;
      error: "not_a_circle_member" | "no_debtors" | "duplicate_debtor" | "payer_is_debtor" | "invalid_amount";
    };

/**
 * Records a payer's paid-for-the-group cost as one tab_entries row per
 * named debtor (see computeEqualSplit for the penny-remainder rule). The
 * payer's own portion of the split is never written as a debt — only what
 * OTHER people owe the payer becomes a ledger row.
 */
export async function addSplitEntry(db: CuatroDb, input: AddSplitEntryInput): Promise<AddSplitEntryOutcome> {
  const currency = input.currency ?? "GBP";
  if (!Number.isInteger(input.totalAmountMinor) || input.totalAmountMinor <= 0) {
    return { ok: false, error: "invalid_amount" };
  }

  const debtorIds = [...new Set(input.debtorUserIds)];
  if (debtorIds.length === 0) return { ok: false, error: "no_debtors" };
  if (debtorIds.length !== input.debtorUserIds.length) return { ok: false, error: "duplicate_debtor" };
  if (debtorIds.includes(input.payerUserId)) return { ok: false, error: "payer_is_debtor" };

  if (!(await isCircleMember(db, input.circleId, input.payerUserId))) return { ok: false, error: "not_a_circle_member" };
  for (const id of debtorIds) {
    if (!(await isCircleMember(db, input.circleId, id))) return { ok: false, error: "not_a_circle_member" };
  }

  const { shareMinor, payerShareMinor } = computeEqualSplit(input.totalAmountMinor, debtorIds.length);
  const trimmedDescription = input.description?.trim();
  const description = trimmedDescription ? trimmedDescription.slice(0, MAX_TAB_ENTRY_DESCRIPTION_LENGTH) : null;

  const outcome = await db.transaction(async (tx) => {
    const tab = await getOrCreateTabTx(tx, input.circleId);

    const entries: TabEntry[] = [];
    for (const debtorUserId of debtorIds) {
      const [entry] = await tx
        .insert(tabEntries)
        .values({
          tabId: tab.id,
          sessionId: input.sessionId ?? null,
          payerUserId: input.payerUserId,
          debtorUserId,
          amountMinor: shareMinor,
          currency,
          description,
        })
        .returning();
      entries.push(entry);
    }

    return { ok: true as const, entries, payerShareMinor };
  });

  for (const entry of outcome.entries) {
    emitCircleEvent(input.circleId, "tab", { entryId: entry.id });
    emitUserEvent(entry.debtorUserId, "tab", { entryId: entry.id, circleId: input.circleId });
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Nudge — fires once per entry, no repeat nags
// ---------------------------------------------------------------------------

export type NudgeOutcome =
  | { ok: true; status: "nudged" }
  | { ok: false; error: "not_found" | "not_the_payer" | "already_nudged" | "already_settled" };

/**
 * One-tap Nudge ("Oi. £8 for Tuesday's court 🎾" — see HANDOFF.md screen 10).
 * Enforced to fire once per entry via `nudgedAt`. Routed through
 * server/notify.ts's typed `tab_nudge` (rather than a raw `notifications`
 * insert) so the debtor gets the shared copy/deep-link/push/realtime
 * treatment every other notification type gets — the entry's Circle is
 * looked up via its Tab row so the notification carries `circleId` (needed
 * for deepLinkFor's `/circles/${circleId}` link; a raw insert here
 * previously had no way to supply it).
 */
export async function nudgeEntry(db: CuatroDb, entryId: string, requestingUserId: string, now: Date = new Date()): Promise<NudgeOutcome> {
  let circleId: string | undefined;
  let debtorUserId: string | undefined;

  const outcome = await db.transaction(async (tx): Promise<NudgeOutcome> => {
    // LOCK: nudge-once. Under Postgres MVCC two concurrent nudges on the same
    // entry could both read nudgedAt=null and both fire (double-nag, which
    // rule 3 forbids). FOR UPDATE on the entry row serializes them: the second
    // waits for the first to commit, then reads the now-set nudgedAt and bails
    // with already_nudged.
    const [entry] = await tx.select().from(tabEntries).where(eq(tabEntries.id, entryId)).for("update");
    if (!entry) return { ok: false, error: "not_found" };
    if (entry.payerUserId !== requestingUserId) return { ok: false, error: "not_the_payer" };
    if (entry.status === "settled") return { ok: false, error: "already_settled" };
    if (entry.nudgedAt) return { ok: false, error: "already_nudged" };

    const [tab] = await tx.select().from(tabs).where(eq(tabs.id, entry.tabId));
    circleId = tab?.circleId;
    debtorUserId = entry.debtorUserId;

    await tx.update(tabEntries).set({ status: "nudged", nudgedAt: now.getTime() }).where(eq(tabEntries.id, entryId));
    await insertNotification(tx, {
      userId: entry.debtorUserId,
      type: "tab_nudge",
      payload: { circleId: tab!.circleId, tabEntryId: entryId, amountMinor: entry.amountMinor, currency: entry.currency },
    });

    return { ok: true, status: "nudged" };
  });

  if (outcome.ok && circleId && debtorUserId) {
    emitCircleEvent(circleId, "tab", { entryId });
    emitUserEvent(debtorUserId, "tab", { entryId, circleId });
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Settle — two-step counterparty confirmation
// ---------------------------------------------------------------------------

export type SettleOutcome =
  | { ok: true; status: "pending"; proposedBy: string }
  | { ok: true; status: "settled"; confirmedBy: string; alreadyFinal: boolean }
  | { ok: false; error: "not_found" | "not_a_party" };

/**
 * Two-step settle: debtor OR payer marks settled, the counterparty's
 * confirmation finalises it (see DESIGN.md §2 "settlement is marked by
 * counterparty confirmation").
 *
 * The schema's `status` enum (open|nudged|settled — see
 * packages/db/src/schema/tabs.ts) has no fourth state for "claimed settled,
 * awaiting the other side" — so that in-between state is encoded without a
 * schema change: the first call from either party stashes ITS OWN userId in
 * `settled_confirmed_by` without touching `status`. An unset
 * `settled_confirmed_by` means "nobody has claimed settlement yet"; a set
 * one (while `status` isn't yet 'settled') means "claimed by this person,
 * awaiting the other party" — the entry still counts as unsettled for
 * balance purposes at this point, exactly as it should (nobody's money has
 * actually moved yet).
 *
 * The SECOND call — from the other party — is what finalises it: `status`
 * flips to 'settled', `settledAt` is stamped, and `settled_confirmed_by` is
 * overwritten with the confirming party's id. That's the literal reading of
 * the column name: who confirmed the settlement actually happened.
 *
 * A repeat call from the same person who already proposed is a no-op
 * (idempotent) — you can't settle a debt by confirming yourself.
 */
export async function proposeOrConfirmSettle(
  db: CuatroDb,
  entryId: string,
  requestingUserId: string,
  now: Date = new Date(),
): Promise<SettleOutcome> {
  let settledCircleId: string | undefined;
  let otherParty: string | undefined;

  const outcome = await db.transaction(async (tx): Promise<SettleOutcome> => {
    // LOCK: two-step settle. The decision here reads settledConfirmedBy/status
    // then writes based on them (propose vs. finalise). Postgres MVCC would let
    // both parties' concurrent confirms read the same "nobody proposed yet"
    // snapshot and each stash their own id (so neither finalises), or let a
    // double-confirm both flip to settled. FOR UPDATE on the entry row
    // serializes the two calls: the second sees the first's committed write
    // (either its own id -> idempotent pending, or the other party's ->
    // finalise) exactly once.
    const [entry] = await tx.select().from(tabEntries).where(eq(tabEntries.id, entryId)).for("update");
    if (!entry) return { ok: false, error: "not_found" };
    if (entry.payerUserId !== requestingUserId && entry.debtorUserId !== requestingUserId) {
      return { ok: false, error: "not_a_party" };
    }

    if (entry.status === "settled") {
      return { ok: true, status: "settled", confirmedBy: entry.settledConfirmedBy!, alreadyFinal: true };
    }

    if (!entry.settledConfirmedBy || entry.settledConfirmedBy === requestingUserId) {
      await tx.update(tabEntries).set({ settledConfirmedBy: requestingUserId }).where(eq(tabEntries.id, entryId));
      return { ok: true, status: "pending", proposedBy: requestingUserId };
    }

    // entry.settledConfirmedBy is set to the OTHER party — this call confirms it.
    await tx
      .update(tabEntries)
      .set({ status: "settled", settledAt: now.getTime(), settledConfirmedBy: requestingUserId })
      .where(eq(tabEntries.id, entryId));

    const otherPartyId = entry.payerUserId === requestingUserId ? entry.debtorUserId : entry.payerUserId;
    await insertNotification(tx, {
      userId: otherPartyId,
      type: "tab_settled",
      payload: { entryId, confirmedBy: requestingUserId },
    });

    const [tab] = await tx.select().from(tabs).where(eq(tabs.id, entry.tabId));
    settledCircleId = tab?.circleId;
    otherParty = otherPartyId;

    return { ok: true, status: "settled", confirmedBy: requestingUserId, alreadyFinal: false };
  });

  if (outcome.ok && outcome.status === "settled" && !outcome.alreadyFinal && settledCircleId) {
    emitCircleEvent(settledCircleId, "tab", { entryId });
    emitUserEvent(requestingUserId, "tab", { entryId, circleId: settledCircleId });
    if (otherParty) emitUserEvent(otherParty, "tab", { entryId, circleId: settledCircleId });
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Read model for the UI
// ---------------------------------------------------------------------------

export interface TabEntryView {
  id: string;
  payerUserId: string;
  payerName: string;
  debtorUserId: string;
  debtorName: string;
  amountMinor: number;
  currency: string;
  status: "open" | "nudged" | "settled";
  sessionId: string | null;
  createdAt: Date;
  nudgedAt: Date | null;
  settledAt: Date | null;
  /** The userId who has claimed settlement, while this entry is still unsettled — see proposeOrConfirmSettle. Null once settled or if nobody has proposed yet. */
  pendingSettleBy: string | null;
  /** The payer's own "what for" note, verbatim. Null when never set — see descriptionLabel for the display-ready version. */
  description: string | null;
  /**
   * `description` when set, else "{Weekday}'s court split" derived from
   * `createdAt` for a session-linked entry (the split is made right after
   * the session — same derivation the Tab page used before entries carried
   * their own description), else null for a manually-added entry with
   * neither. Computed once here so every surface that shows a Tab entry's
   * "what for" (the balance row, Home's settle row, the activity feed) reads
   * the same fallback rather than three separate copies of this rule.
   */
  descriptionLabel: string | null;
}

/** "Tuesday's court split" — the pre-description fallback for a session-linked entry, kept as the fallback now that entries can carry their own description (see TabEntryView.descriptionLabel). Weekday resolves in the Circle's timezone — the split lands right after the session, and a raw-UTC render names the WRONG day for a late-evening game (the QA4 class). */
function sessionDateFallbackLabel(createdAt: Date, timeZone: string): string {
  return `${formatWeekdayLong(createdAt, timeZone)}'s court split`;
}

export interface TabView {
  tabId: string;
  circleId: string;
  members: MemberRef[];
  /** The viewer's own net position, per currency — the Tab's mono ±£ header. */
  netPositionByCurrency: Record<string, number>;
  /** The viewer's unsettled balance with each other member they share an entry with — "all square" pairs are omitted. */
  balances: CounterpartyBalance[];
  /** Every entry (open, nudged, and settled), newest first — the activity ledger. */
  activity: TabEntryView[];
  /** The Circle's IANA timezone — pass to lib/time.ts formatters for every entry date this view renders (activity feed rows etc.). */
  timezone: string;
}

/** Null if `viewerUserId` isn't a member of the Circle (same "don't confirm existence to outsiders" posture as server/circles.ts). */
export async function getTabView(db: CuatroDb, circleId: string, viewerUserId: string): Promise<TabView | null> {
  if (!(await isCircleMember(db, circleId, viewerUserId))) return null;

  const tab = await ensureTabForCircle(db, circleId);
  const [circle] = await db.select({ timezone: circles.timezone }).from(circles).where(eq(circles.id, circleId));
  const timezone = circle?.timezone ?? DEFAULT_TZ;
  const members = await listCircleMembers(db, circleId);
  const nameById = new Map(members.map((m) => [m.userId, m.displayName]));

  const rows = await db.select().from(tabEntries).where(eq(tabEntries.tabId, tab.id));

  const activity: TabEntryView[] = rows
    .map((r) => {
      // *_at columns are epoch-ms (Postgres bigint) now — surface Dates to the
      // UI, the shape every Tab surface already formats.
      const createdAt = new Date(r.createdAt);
      return {
        id: r.id,
        payerUserId: r.payerUserId,
        payerName: nameById.get(r.payerUserId) ?? "Unknown",
        debtorUserId: r.debtorUserId,
        debtorName: nameById.get(r.debtorUserId) ?? "Unknown",
        amountMinor: r.amountMinor,
        currency: r.currency,
        status: r.status,
        sessionId: r.sessionId,
        createdAt,
        nudgedAt: r.nudgedAt == null ? null : new Date(r.nudgedAt),
        settledAt: r.settledAt == null ? null : new Date(r.settledAt),
        pendingSettleBy: r.status === "settled" ? null : r.settledConfirmedBy,
        description: r.description,
        descriptionLabel: r.description ?? (r.sessionId ? sessionDateFallbackLabel(createdAt, timezone) : null),
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const unsettled = rows.filter((r) => r.status !== "settled");

  return {
    tabId: tab.id,
    circleId,
    members,
    netPositionByCurrency: computeNetPosition(unsettled, viewerUserId),
    balances: computeCounterpartyBalances(unsettled, viewerUserId),
    activity,
    timezone,
  };
}

/**
 * True if `viewerUserId` owes money (an unsettled balance) in any of
 * `circleIds` — powers the coral dot on the Tab nav item (see
 * components/bottom-nav.tsx and design/CUATRO-Prototype-LATEST.dc.html's
 * `tabDotDisplay`). Reuses getTabView's membership + balance computation
 * rather than a new query shape.
 */
export async function hasOpenEntriesAgainstViewer(db: CuatroDb, circleIds: string[], viewerUserId: string): Promise<boolean> {
  for (const circleId of circleIds) {
    const view = await getTabView(db, circleId, viewerUserId);
    if (view?.balances.some((b) => b.netMinor < 0)) return true;
  }
  return false;
}
