import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { rsvps, sessions, standingGames, tabEntries, users, type CuatroDb } from "@cuatro/db";
import { seedCircle, type Fixture } from "./support/games-fixtures";
import { createTabSplitForSession, hasTabSplitForSession } from "@/server/session-tab";

const DAY_MS = 24 * 60 * 60 * 1000;

let fixture: Fixture | undefined;
afterEach(() => {
  fixture?.close();
  fixture = undefined;
});

/** A played session for `fixture`'s standing game, with `confirmedUserIds` holding 'in' RSVPs. */
function playedSession(db: CuatroDb, fixture: Fixture, confirmedUserIds: string[]) {
  const session = db
    .insert(sessions)
    .values({
      standingGameId: fixture.standingGameId,
      circleId: fixture.circleId,
      venueId: fixture.venueId,
      startsAt: new Date(Date.now() - DAY_MS),
      status: "played",
    })
    .returning()
    .get();
  for (const userId of confirmedUserIds) {
    db.insert(rsvps).values({ sessionId: session.id, userId, status: "in", respondedAt: new Date() }).run();
  }
  return session;
}

function withCost(fixture: Fixture, costMinor: number, costCurrency = "GBP") {
  fixture.db.update(standingGames).set({ costMinor, costCurrency }).where(eq(standingGames.id, fixture.standingGameId!)).run();
}

describe("createTabSplitForSession", () => {
  it("splits the cost among confirmed slot-holders, organiser as payer, matching tab.ts's floor + remainder-to-payer rule", () => {
    fixture = seedCircle({ memberCount: 3, standingGame: { weekday: 2, startTime: "20:00", slots: 4 } });
    withCost(fixture, 3200); // £32
    const [d1, d2, d3] = fixture.memberIds;
    const session = playedSession(fixture.db, fixture, [fixture.organiserId, d1, d2, d3]);

    const result = createTabSplitForSession(fixture.db, session.id, fixture.organiserId);
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

  it("writes a 'court split · {session date}' description on every entry it creates", () => {
    fixture = seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00", slots: 2 } });
    withCost(fixture, 2000);
    const [d1] = fixture.memberIds;
    const session = playedSession(fixture.db, fixture, [fixture.organiserId, d1]);

    const result = createTabSplitForSession(fixture.db, session.id, fixture.organiserId);
    if (!result.ok) throw new Error("unreachable");

    const expectedDateLabel = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(session.startsAt);
    for (const e of result.entries) {
      expect(e.description).toBe(`court split · ${expectedDateLabel}`);
    }
  });

  it("is idempotent — a second call returns the existing split rather than creating a duplicate", () => {
    fixture = seedCircle({ memberCount: 2, standingGame: { weekday: 2, startTime: "20:00", slots: 3 } });
    withCost(fixture, 3200); // £32 across 2 debtors + payer -> 1066/1066, payer keeps 1068
    const [d1, d2] = fixture.memberIds;
    const session = playedSession(fixture.db, fixture, [fixture.organiserId, d1, d2]);

    const first = createTabSplitForSession(fixture.db, session.id, fixture.organiserId);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");
    expect(first.entries.map((e) => e.amountMinor)).toEqual([1066, 1066]);

    const second = createTabSplitForSession(fixture.db, session.id, d1);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.alreadyExisted).toBe(true);
    expect(second.entries).toHaveLength(2);

    const allEntries = fixture.db.select().from(tabEntries).where(eq(tabEntries.sessionId, session.id)).all();
    expect(allEntries).toHaveLength(2); // never doubled
  });

  it("rejects a session that hasn't been played yet", () => {
    fixture = seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    withCost(fixture, 3200);
    const session = fixture.db
      .insert(sessions)
      .values({ standingGameId: fixture.standingGameId, circleId: fixture.circleId, startsAt: new Date(Date.now() + DAY_MS), status: "upcoming" })
      .returning()
      .get();

    expect(createTabSplitForSession(fixture.db, session.id, fixture.organiserId)).toEqual({ ok: false, error: "not_played" });
  });

  it("rejects a played session with no cost set", () => {
    fixture = seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    const session = playedSession(fixture.db, fixture, [fixture.organiserId]);

    expect(createTabSplitForSession(fixture.db, session.id, fixture.organiserId)).toEqual({ ok: false, error: "no_cost_set" });
  });

  it("rejects a non-member", () => {
    fixture = seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    withCost(fixture, 3200);
    const session = playedSession(fixture.db, fixture, [fixture.organiserId]);
    const outsider = fixture.db.insert(users).values({ email: "outsider@example.com", displayName: "Outsider" }).returning().get();

    expect(createTabSplitForSession(fixture.db, session.id, outsider.id)).toEqual({ ok: false, error: "not_a_circle_member" });
  });

  it("hasTabSplitForSession reflects whether a split exists for that session", () => {
    fixture = seedCircle({ memberCount: 1, standingGame: { weekday: 2, startTime: "20:00" } });
    withCost(fixture, 3200);
    const [d1] = fixture.memberIds;
    const session = playedSession(fixture.db, fixture, [fixture.organiserId, d1]);

    expect(hasTabSplitForSession(fixture.db, session.id)).toBe(false);
    createTabSplitForSession(fixture.db, session.id, fixture.organiserId);
    expect(hasTabSplitForSession(fixture.db, session.id)).toBe(true);
  });
});
