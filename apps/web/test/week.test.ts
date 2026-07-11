import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { rsvps, sessions, standingGames, tabEntries, tabs, users } from "@cuatro/db";
import { seedCircle, type Fixture } from "./support/games-fixtures";
import { buildWeekData, weekCellKind, type WeekSession } from "@/server/week";

let fixture: Fixture | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

// A Saturday, 12:00 UTC (13:00 BST) — the reference "now" for the 7-day window.
const NOW = new Date(Date.UTC(2026, 6, 11, 12, 0, 0));
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function insertSession(
  fx: Fixture,
  opts: { startsAt: number; standingGameId?: string | null; rotationLockedAt?: number | null; status?: "upcoming" | "played" | "cancelled" } = { startsAt: NOW.getTime() + DAY },
) {
  const [session] = await fx.db
    .insert(sessions)
    .values({
      circleId: fx.circleId,
      venueId: fx.venueId,
      standingGameId: opts.standingGameId ?? null,
      startsAt: opts.startsAt,
      rotationLockedAt: opts.rotationLockedAt ?? null,
      status: opts.status ?? "upcoming",
    })
    .returning();
  return session;
}

function addRsvp(fx: Fixture, sessionId: string, userId: string, status: "in" | "out" | "reserve" | "available") {
  return fx.db.insert(rsvps).values({ sessionId, userId, status });
}

describe("buildWeekData — the 7-day window", () => {
  it("lays out 7 columns starting today with a mono range label", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    const data = await buildWeekData(fixture.db, fixture.organiserId, NOW);
    expect(data.days).toHaveLength(7);
    expect(data.days[0]).toMatchObject({ weekday: "Sat", dayNum: 11, isToday: true });
    expect(data.days[6]).toMatchObject({ weekday: "Fri", dayNum: 17 });
    expect(data.rangeLabel).toBe("Sat 11 – Fri 17 Jul");
    expect(data.hasNoCircles).toBe(false);
  });

  it("marks a viewer with no circles as first-run empty", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    const [loner] = await fixture.db.insert(users).values({ email: "loner@example.com", displayName: "Lone" }).returning();
    const data = await buildWeekData(fixture.db, loner.id, NOW);
    expect(data.hasNoCircles).toBe(true);
    expect(data.sessions).toEqual([]);
    expect(data.days).toHaveLength(7);
  });

  it("buckets a session into its local day and ignores past + out-of-window games", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    await insertSession(fixture, { startsAt: NOW.getTime() - DAY }); // yesterday (past)
    await insertSession(fixture, { startsAt: NOW.getTime() + 20 * DAY }); // beyond the week
    const tue = await insertSession(fixture, { startsAt: NOW.getTime() + 3 * DAY }); // Tue 14th

    const data = await buildWeekData(fixture.db, fixture.organiserId, NOW);
    expect(data.gameCount).toBe(1);
    const tueDay = data.days.find((d) => d.dayNum === 14);
    expect(tueDay?.sessions.map((s) => s.sessionId)).toEqual([tue.id]);
  });
});

describe("weekCellKind — the day-cell state machine", () => {
  it("flags an unanswered, open, >48h game as needs-answer with a fill count", async () => {
    fixture = await seedCircle({ memberCount: 3 });
    const [m0, m1] = fixture.memberIds;
    const s = await insertSession(fixture, { startsAt: NOW.getTime() + 3 * DAY });
    await addRsvp(fixture, s.id, m0, "in");
    await addRsvp(fixture, s.id, m1, "in");

    const data = await buildWeekData(fixture.db, fixture.organiserId, NOW);
    const ws = data.sessions[0];
    expect(weekCellKind(ws)).toBe("needs-answer");
    expect(ws.confirmedCount).toBe(2);
    expect(ws.slots).toBe(4);
    expect(data.needsAnswer?.sessionId).toBe(s.id);
    expect(data.needsAnswerCount).toBe(1);
  });

  it("flags an open game inside the 48h window as a fourth-call, not needs-answer", async () => {
    fixture = await seedCircle({ memberCount: 3 });
    const [m0, m1] = fixture.memberIds;
    const s = await insertSession(fixture, { startsAt: NOW.getTime() + 3 * HOUR }); // today, soon
    await addRsvp(fixture, s.id, m0, "in");
    await addRsvp(fixture, s.id, m1, "in");

    const data = await buildWeekData(fixture.db, fixture.organiserId, NOW);
    const ws = data.sessions[0];
    expect(ws.fourthCallActive).toBe(true);
    expect(weekCellKind(ws)).toBe("fourth-call");
    expect(data.fourthCall?.sessionId).toBe(s.id);
    // The first confirmed player stands in as the asker.
    expect(data.fourthCall?.askerName).toBe("Member 0");
  });

  it("reads a game the viewer is in as youre-in", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const s = await insertSession(fixture, { startsAt: NOW.getTime() + 2 * DAY });
    await addRsvp(fixture, s.id, fixture.organiserId, "in");

    const data = await buildWeekData(fixture.db, fixture.organiserId, NOW);
    expect(weekCellKind(data.sessions[0])).toBe("youre-in");
    expect(data.needsAnswer).toBeNull();
  });

  it("reads a rotation game still pre-lock as rotation (never a red needs-answer, never a fill count)", async () => {
    fixture = await seedCircle({ memberCount: 2 });
    const [sg] = await fixture.db
      .insert(standingGames)
      .values({ circleId: fixture.circleId, venueId: fixture.venueId, weekday: 2, startTime: "20:00", rotationEnabled: true, rotationMode: "limited", rotationCutoffHours: 24 })
      .returning();
    const s = await insertSession(fixture, { startsAt: NOW.getTime() + 2 * DAY, standingGameId: sg.id, rotationLockedAt: null });

    const data = await buildWeekData(fixture.db, fixture.organiserId, NOW);
    const ws = data.sessions[0];
    expect(ws.rotation).toBe(true);
    expect(ws.rotationLocked).toBe(false);
    expect(ws.locksAt).toBe(s.startsAt - 24 * HOUR);
    expect(weekCellKind(ws)).toBe("rotation");
  });

  it("reads a full game the viewer is not in as a neutral 'confirmed' cell", async () => {
    fixture = await seedCircle({ memberCount: 4 });
    const [m0, m1, m2, m3] = fixture.memberIds;
    const s = await insertSession(fixture, { startsAt: NOW.getTime() + 3 * DAY });
    for (const m of [m0, m1, m2, m3]) await addRsvp(fixture, s.id, m, "in");

    const data = await buildWeekData(fixture.db, fixture.organiserId, NOW);
    expect(weekCellKind(data.sessions[0])).toBe("confirmed");
    expect(data.needsAnswer).toBeNull();
  });
});

describe("buildWeekData — money opt-in (issue #21, Booked on XOR court cost)", () => {
  async function insertStandingGame(fx: Fixture, values: Record<string, unknown> = {}) {
    const [sg] = await fx.db
      .insert(standingGames)
      .values({ circleId: fx.circleId, venueId: fx.venueId, weekday: 2, startTime: "20:00", ...values })
      .returning();
    return sg;
  }

  it("defaults to silence — a game with no signpost and no cost carries no money at all", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    await insertSession(fixture, { startsAt: NOW.getTime() + DAY });
    const data = await buildWeekData(fixture.db, fixture.organiserId, NOW);
    expect(data.sessions[0].moneyOptIn).toBeNull();
  });

  it("inherits the standing game's Booked-on signpost", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    const sg = await insertStandingGame(fixture, { bookingPlatform: "playtomic", bookingUrl: "https://playtomic.io/x" });
    await insertSession(fixture, { startsAt: NOW.getTime() + DAY, standingGameId: sg.id });
    const data = await buildWeekData(fixture.db, fixture.organiserId, NOW);
    expect(data.sessions[0].moneyOptIn).toEqual({
      kind: "booking",
      booking: { platform: "playtomic", url: "https://playtomic.io/x" },
    });
  });

  it("lets a session-level booking override the standing game's", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    const sg = await insertStandingGame(fixture, { bookingPlatform: "playtomic" });
    const s = await insertSession(fixture, { startsAt: NOW.getTime() + DAY, standingGameId: sg.id });
    await fixture.db.update(sessions).set({ bookingPlatform: "matchi", bookingUrl: null }).where(eq(sessions.id, s.id));
    const data = await buildWeekData(fixture.db, fixture.organiserId, NOW);
    expect(data.sessions[0].moneyOptIn).toEqual({ kind: "booking", booking: { platform: "matchi", url: null } });
  });

  it("resolves a court cost when that's the one opt-in set", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    const sg = await insertStandingGame(fixture, { costMinor: 3200, costCurrency: "GBP" });
    await insertSession(fixture, { startsAt: NOW.getTime() + DAY, standingGameId: sg.id });
    const data = await buildWeekData(fixture.db, fixture.organiserId, NOW);
    expect(data.sessions[0].moneyOptIn).toEqual({ kind: "cost", amountMinor: 3200, currency: "GBP" });
  });

  it("a booking signpost silences a cost — booked-on games never touch the Tab", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    // The write side enforces the XOR; the read side stays defensive anyway.
    const sg = await insertStandingGame(fixture, { bookingPlatform: "padel_mates", costMinor: 3200 });
    await insertSession(fixture, { startsAt: NOW.getTime() + DAY, standingGameId: sg.id });
    const data = await buildWeekData(fixture.db, fixture.organiserId, NOW);
    expect(data.sessions[0].moneyOptIn).toEqual({ kind: "booking", booking: { platform: "padel_mates", url: null } });
  });
});

describe("buildWeekData — the Tab prompt", () => {
  async function seedTabEntry(fx: Fixture, opts: { payer: string; debtor: string; amountMinor: number; description?: string }) {
    const [tab] = await fx.db.insert(tabs).values({ circleId: fx.circleId }).onConflictDoNothing().returning();
    const tabId = tab?.id ?? (await fx.db.select().from(tabs).where(eq(tabs.circleId, fx.circleId)))[0].id;
    await fx.db.insert(tabEntries).values({
      tabId,
      payerUserId: opts.payer,
      debtorUserId: opts.debtor,
      amountMinor: opts.amountMinor,
      description: opts.description ?? null,
    });
  }

  it("surfaces the single most-pressing 'you owe' with the counterparty name and description", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const [m0] = fixture.memberIds;
    await fixture.db.update(users).set({ displayName: "Mags" }).where(eq(users.id, m0));
    await seedTabEntry(fixture, { payer: m0, debtor: fixture.organiserId, amountMinor: 1200, description: "court + balls" });

    const data = await buildWeekData(fixture.db, fixture.organiserId, NOW);
    expect(data.tabPrompt).toMatchObject({ counterpartyName: "Mags", amountMinor: 1200, currency: "GBP", description: "court + balls", circleId: fixture.circleId });
  });

  it("is null when the viewer only owes nothing / is owed", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const [m0] = fixture.memberIds;
    await seedTabEntry(fixture, { payer: fixture.organiserId, debtor: m0, amountMinor: 800 }); // they owe the viewer
    const data = await buildWeekData(fixture.db, fixture.organiserId, NOW);
    expect(data.tabPrompt).toBeNull();
  });
});

describe("buildWeekData — Log last night's result", () => {
  it("points at the most recent past session the viewer played with no match yet", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    const older = await insertSession(fixture, { startsAt: NOW.getTime() - 8 * DAY, status: "played" });
    const recent = await insertSession(fixture, { startsAt: NOW.getTime() - 2 * DAY, status: "played" });
    await addRsvp(fixture, older.id, fixture.organiserId, "in");
    await addRsvp(fixture, recent.id, fixture.organiserId, "in");

    const data = await buildWeekData(fixture.db, fixture.organiserId, NOW);
    expect(data.logResultSessionId).toBe(recent.id);
  });

  it("is null when the viewer has no unlogged past sessions", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    const data = await buildWeekData(fixture.db, fixture.organiserId, NOW);
    expect(data.logResultSessionId).toBeNull();
  });
});

// Type-only guard: weekCellKind is a pure function of WeekSession facts.
function _kindIsPure(s: WeekSession) {
  return weekCellKind(s);
}
void _kindIsPure;
