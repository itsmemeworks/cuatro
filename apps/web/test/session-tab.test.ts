import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { rsvps, sessions, standingGames, tabEntries, users, type CuatroDb } from "@cuatro/db";
import { seedCircle, type Fixture } from "./support/games-fixtures";
import { createTabSplitForSession, hasTabSplitForSession } from "@/server/session-tab";

const DAY_MS = 24 * 60 * 60 * 1000;

let fixture: Fixture | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

/** A played session for `fixture`'s standing game, with `confirmedUserIds` holding 'in' RSVPs. */
async function playedSession(db: CuatroDb, fixture: Fixture, confirmedUserIds: string[]) {
  const [session] = await db
    .insert(sessions)
    .values({
      standingGameId: fixture.standingGameId,
      circleId: fixture.circleId,
      venueId: fixture.venueId,
      startsAt: Date.now() - DAY_MS,
      status: "played",
    })
    .returning();
  for (const userId of confirmedUserIds) {
    await db.insert(rsvps).values({ sessionId: session.id, userId, status: "in", respondedAt: Date.now() });
  }
  return session;
}

async function withCost(fixture: Fixture, costMinor: number, costCurrency = "GBP") {
  await fixture.db.update(standingGames).set({ costMinor, costCurrency }).where(eq(standingGames.id, fixture.standingGameId!));
}

describe("createTabSplitForSession", () => {
  it("splits the cost among confirmed slot-holders, organiser as payer, matching tab.ts's floor + remainder-to-payer rule", async () => {
    fixture = await seedCircle({ memberCount: 3, standingGame: { weekday: 2, startTime: "20:00", slots: 4 } });
    await withCost(fixture, 3200); // £32
    const [d1, d2, d3] = fixture.memberIds;
    const session = await playedSession(fixture.db, fixture, [fixture.organiserId, d1, d2, d3]);

    const result = await createTabSplitForSession(fixture.db, session.id, fixture.organiserId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.alreadyExisted).toBe(false);
    expect(result.entries).toHaveLength(3);
    for (const e of result.entries) {
      expect(e.payerUserId).toBe(fixture.organiserId);
      expect(e.amountMinor).toBe(800); // 3200 / 4 divides evenly
      expect(e.sessionId).toBe(session.id);
    }
    expect(result.payerShareMinor).toBe(800);
  });

  it("writes a 'court split · {session date}' description on every entry it creates", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00", slots: 2 } });
    await withCost(fixture, 2000);
    const [d1] = fixture.memberIds;
    const session = await playedSession(fixture.db, fixture, [fixture.organiserId, d1]);

    const result = await createTabSplitForSession(fixture.db, session.id, fixture.organiserId);
    if (!result.ok) throw new Error("unreachable");

    const expectedDateLabel = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(session.startsAt);
    for (const e of result.entries) {
      expect(e.description).toBe(`court split · ${expectedDateLabel}`);
    }
  });

  it("is idempotent — a second call returns the existing split rather than creating a duplicate", async () => {
    fixture = await seedCircle({ memberCount: 2, standingGame: { weekday: 2, startTime: "20:00", slots: 3 } });
    await withCost(fixture, 3200); // £32 across 2 debtors + payer -> 1066/1066, payer keeps 1068
    const [d1, d2] = fixture.memberIds;
    const session = await playedSession(fixture.db, fixture, [fixture.organiserId, d1, d2]);

    const first = await createTabSplitForSession(fixture.db, session.id, fixture.organiserId);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");
    expect(first.entries.map((e) => e.amountMinor)).toEqual([1066, 1066]);

    const second = await createTabSplitForSession(fixture.db, session.id, d1);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.alreadyExisted).toBe(true);
    expect(second.entries).toHaveLength(2);

    const allEntries = await fixture.db.select().from(tabEntries).where(eq(tabEntries.sessionId, session.id));
    expect(allEntries).toHaveLength(2); // never doubled
  });

  it("rejects a session that hasn't been played yet", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    await withCost(fixture, 3200);
    const [session] = await fixture.db
      .insert(sessions)
      .values({ standingGameId: fixture.standingGameId, circleId: fixture.circleId, startsAt: Date.now() + DAY_MS, status: "upcoming" })
      .returning();

    expect(await createTabSplitForSession(fixture.db, session.id, fixture.organiserId)).toEqual({ ok: false, error: "not_played" });
  });

  it("rejects a played session with no cost set", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    const session = await playedSession(fixture.db, fixture, [fixture.organiserId]);

    expect(await createTabSplitForSession(fixture.db, session.id, fixture.organiserId)).toEqual({ ok: false, error: "no_cost_set" });
  });

  it("rejects a non-member", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    await withCost(fixture, 3200);
    const session = await playedSession(fixture.db, fixture, [fixture.organiserId]);
    const [outsider] = await fixture.db.insert(users).values({ email: "outsider@example.com", displayName: "Outsider" }).returning();

    expect(await createTabSplitForSession(fixture.db, session.id, outsider.id)).toEqual({ ok: false, error: "not_a_circle_member" });
  });

  it("hasTabSplitForSession reflects whether a split exists for that session", async () => {
    fixture = await seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    await withCost(fixture, 3200);
    const [d1] = fixture.memberIds;
    const session = await playedSession(fixture.db, fixture, [fixture.organiserId, d1]);

    expect(await hasTabSplitForSession(fixture.db, session.id)).toBe(false);
    await createTabSplitForSession(fixture.db, session.id, fixture.organiserId);
    expect(await hasTabSplitForSession(fixture.db, session.id)).toBe(true);
  });
});
