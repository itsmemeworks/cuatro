/**
 * REAL-POSTGRES concurrency proof for the MONEY/RESULTS locks.
 *
 * PGlite (the unit-test driver) is a single in-process connection and
 * serialises everything, so it can NEVER exhibit — nor disprove — the
 * double-apply the `.for('update')` locks in matches-db.ts / tab.ts exist to
 * prevent. This runs against the local Supabase stack's real Postgres, where
 * two transactions on two pooled connections genuinely contend for the same
 * row.
 *
 * Two races are proven:
 *  1. Match double-seal (matches-db.confirmMatch): team A auto-confirms at
 *     record time, then BOTH members of team B confirm at the same instant.
 *     Without the FOR UPDATE lock on the match row both transactions read
 *     status='pending_confirmation', both see "both teams confirmed", and both
 *     run applyGlassAndPersist — 8 rating_events instead of 4, and Reliability
 *     double-counted (the verified-live 109%-reliability incident the guard
 *     exists for). With it, exactly one seals; the other reads 'verified' and
 *     is a no-op.
 *  2. Tab settle double-confirm (tab.proposeOrConfirmSettle): the payer and
 *     the debtor both mark the same entry settled at once. Without the lock
 *     both read settledConfirmedBy=null and each stash their own id, so the
 *     entry NEVER finalises (lost settlement). With it, one proposes and the
 *     other finalises — the entry ends 'settled'.
 *
 * CI has no Postgres stack, so this is skip-guarded on PG_RACE. Run locally:
 *   PG_RACE=1 npx vitest run test/money-results-race.pg.test.ts
 * (the local stack must be up: `supabase start` from the repo root).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  createClient,
  circleMembers,
  circles,
  matchConfirmations,
  matches,
  notifications,
  ratingEvents,
  rsvps,
  sessions,
  tabEntries,
  tabs,
  users,
  type CuatroClient,
} from "@cuatro/db";
import { createMatchesStoreFromClient, type MatchesStore } from "@/server/matches-db";
import { addSplitEntry, proposeOrConfirmSettle } from "@/server/tab";

const PG_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54422/postgres";

describe.skipIf(!process.env.PG_RACE)("money/results locks (real Postgres)", () => {
  let client: CuatroClient;
  let store: MatchesStore;
  const userIds: string[] = [];
  let circleId = "";

  beforeEach(async () => {
    client = await createClient(PG_URL);
    store = createMatchesStoreFromClient(client);
    userIds.length = 0;
    circleId = "";
  });

  afterEach(async () => {
    const { db } = client;
    // FK order: children first. Scope every delete to the rows we made.
    if (userIds.length) {
      const matchRows = await db.select({ id: matches.id }).from(matches).where(inArray(matches.teamAPlayer1Id, userIds));
      const matchIds = matchRows.map((m) => m.id);
      if (matchIds.length) {
        await db.delete(ratingEvents).where(inArray(ratingEvents.matchId, matchIds));
        await db.delete(matchConfirmations).where(inArray(matchConfirmations.matchId, matchIds));
        await db.delete(matches).where(inArray(matches.id, matchIds));
      }
      await db.delete(notifications).where(inArray(notifications.userId, userIds));
      if (circleId) {
        const tabRows = await db.select({ id: tabs.id }).from(tabs).where(eq(tabs.circleId, circleId));
        const tabIds = tabRows.map((t) => t.id);
        if (tabIds.length) await db.delete(tabEntries).where(inArray(tabEntries.tabId, tabIds));
        await db.delete(tabs).where(eq(tabs.circleId, circleId));
        await db.delete(rsvps).where(inArray(rsvps.userId, userIds));
        await db.delete(sessions).where(eq(sessions.circleId, circleId));
        await db.delete(circleMembers).where(eq(circleMembers.circleId, circleId));
        await db.delete(circles).where(eq(circles.id, circleId));
      }
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await store.close();
  });

  async function seedUser(tag: string) {
    const { db } = client;
    const [u] = await db.insert(users).values({ email: `${tag}-${crypto.randomUUID()}@example.com`, displayName: tag }).returning();
    userIds.push(u.id);
    return u;
  }

  it("match double-seal: two team-B members confirming at once apply Glass exactly once", async () => {
    const { db } = client;
    const a = await seedUser("racemA");
    const b = await seedUser("racemB");
    const c = await seedUser("racemC");
    const d = await seedUser("racemD");
    const [circle] = await db
      .insert(circles)
      .values({ name: "Seal Race", timezone: "Europe/London", inviteCode: `SEAL-${crypto.randomUUID().slice(0, 8)}`, createdBy: a.id })
      .returning();
    circleId = circle.id;
    const [session] = await db
      .insert(sessions)
      .values({ circleId: circle.id, startsAt: Date.now() - 60 * 60 * 1000, status: "played" })
      .returning();

    const { matchId } = await store.recordMatch({
      sessionId: session.id,
      reporterId: a.id,
      teamA: [a.id, b.id],
      teamB: [c.id, d.id],
      sets: [{ a: 6, b: 3 }],
    });

    // Both team-B members seal at the same instant — each confirmMatch opens
    // its own transaction => genuine two-connection contention on the match row.
    await Promise.all([store.confirmMatch(matchId, c.id), store.confirmMatch(matchId, d.id)]);

    // Exactly one seal: 4 rating_events (not 8), match verified once, and every
    // player's verifiedMatchCount moved by exactly 1.
    const events = await db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId));
    expect(events).toHaveLength(4);

    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(m!.status).toBe("verified");

    const rows = await db.select().from(users).where(inArray(users.id, [a.id, b.id, c.id, d.id]));
    for (const r of rows) expect(r.verifiedMatchCount).toBe(1);
  });

  it("tab settle double-confirm: payer and debtor marking at once finalise the entry once", async () => {
    const { db } = client;
    const payer = await seedUser("racetP");
    const debtor = await seedUser("racetD");
    const [circle] = await db
      .insert(circles)
      .values({ name: "Settle Race", timezone: "Europe/London", inviteCode: `SETL-${crypto.randomUUID().slice(0, 8)}`, createdBy: payer.id })
      .returning();
    circleId = circle.id;
    await db.insert(circleMembers).values([
      { circleId: circle.id, userId: payer.id, role: "organiser" },
      { circleId: circle.id, userId: debtor.id, role: "member" },
    ]);

    const created = await addSplitEntry(db, {
      circleId: circle.id,
      payerUserId: payer.id,
      debtorUserIds: [debtor.id],
      totalAmountMinor: 1000,
    });
    if (!created.ok) throw new Error("unreachable");
    const entryId = created.entries[0]!.id;

    // Both parties mark settled at the same instant. With the FOR UPDATE lock
    // one proposes and the other finalises; without it both would stash their
    // own id and the entry would never settle.
    const outcomes = await Promise.all([
      proposeOrConfirmSettle(db, entryId, payer.id),
      proposeOrConfirmSettle(db, entryId, debtor.id),
    ]);

    const settledOutcomes = outcomes.filter((o) => o.ok && o.status === "settled");
    expect(settledOutcomes).toHaveLength(1);

    const [entry] = await db.select().from(tabEntries).where(eq(tabEntries.id, entryId));
    expect(entry!.status).toBe("settled");
  });
});
