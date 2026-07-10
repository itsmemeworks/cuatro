import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { notifications, sessions, type CuatroDb } from "@cuatro/db";
import { seedCircle, type Fixture } from "./support/games-fixtures";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";

// The scheduler reaches the database through the app-wide singleton in
// @/server/db. Point that at the per-test PGlite client the fixture opens, so
// runSchedulerTick exercises the real domain functions against a real (in-
// memory) Postgres — the tick itself is never mocked.
let currentDb: CuatroDb | null = null;
vi.mock("@/server/db", () => ({
  getDb: async () => ({ db: currentDb, close: async () => {} }),
  __resetDbForTests: () => {},
}));

import { runSchedulerTick } from "@/server/scheduler";

const HOUR_MS = 60 * 60 * 1000;

let fixture: Fixture;

afterEach(async () => {
  currentDb = null;
  __setRealtimeSenderForTests(null);
  if (fixture) await fixture.close();
});

describe("runSchedulerTick — Fourth Call idempotence", () => {
  beforeEach(async () => {
    // memberCount 0 = the organiser is the circle's only member, so a due
    // Fourth Call has exactly one un-responded target: one notification.
    fixture = await seedCircle({ memberCount: 0 });
    currentDb = fixture.db;
  });

  it("fires a due T-48h Fourth Call once across two ticks (never nags twice)", async () => {
    const now = new Date("2026-03-10T12:00:00.000Z");
    // 47h out: inside the 48h Fourth Call window, still short of a full four.
    await fixture.db
      .insert(sessions)
      .values({ circleId: fixture.circleId, startsAt: now.getTime() + 47 * HOUR_MS, status: "upcoming" });

    await runSchedulerTick(now);
    await runSchedulerTick(now);

    const fourthCalls = await fixture.db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "fourth_call"));
    expect(fourthCalls).toHaveLength(1);
  });

  it("does not fire a Fourth Call for a session still outside the 48h window", async () => {
    const now = new Date("2026-03-10T12:00:00.000Z");
    // 49h out: window not open yet.
    await fixture.db
      .insert(sessions)
      .values({ circleId: fixture.circleId, startsAt: now.getTime() + 49 * HOUR_MS, status: "upcoming" });

    const summary = await runSchedulerTick(now);

    const fourthCalls = await fixture.db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "fourth_call"));
    expect(fourthCalls).toHaveLength(0);
    // The session was still visited (it's within the maintenance horizon) — the
    // domain function's own "not_yet" gate is what held the notification back.
    expect(summary.sessionsChecked).toBe(1);
    expect(summary.errors).toBe(0);
  });
});

describe("runSchedulerTick — session materialisation", () => {
  it("materialises each active standing game's next session, idempotently", async () => {
    fixture = await seedCircle({
      memberCount: 1,
      standingGame: { weekday: 2, startTime: "20:00" }, // Tuesday 20:00
    });
    currentDb = fixture.db;
    const now = new Date("2026-01-04T00:00:00.000Z"); // Sunday; next Tue is 2026-01-06

    await runSchedulerTick(now);
    await runSchedulerTick(now);

    const rows = await fixture.db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0].circleId).toBe(fixture.circleId);
    expect(new Date(rows[0].startsAt).toISOString()).toBe("2026-01-06T20:00:00.000Z");
  });
});

describe("runSchedulerTick — horizon", () => {
  it("skips sessions starting beyond the maintenance horizon", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    currentDb = fixture.db;
    const now = new Date("2026-03-10T12:00:00.000Z");
    // 40 days out — past MAINTENANCE_HORIZON_MS (30 days).
    await fixture.db
      .insert(sessions)
      .values({ circleId: fixture.circleId, startsAt: now.getTime() + 40 * 24 * HOUR_MS, status: "upcoming" });

    const summary = await runSchedulerTick(now);

    expect(summary.sessionsChecked).toBe(0);
    const fourthCalls = await fixture.db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "fourth_call"));
    expect(fourthCalls).toHaveLength(0);
  });
});
