import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClient, users, circles, sessions, type CuatroDb } from "@cuatro/db";
import {
  captureEvent,
  shutdownAnalytics,
  SYSTEM_DISTINCT_ID,
  __setAnalyticsClientForTests,
  type AnalyticsClient,
} from "@/lib/analytics";
import { createCirclesStore, type CirclesStore } from "@/server/circles";
import { createMatchesStoreFromClient, type MatchesStore } from "@/server/matches-db";

// A fake posthog-node client: records every capture so a test can assert on
// the exact EventMessage the wrapper built, with no live network call.
type Captured = Parameters<AnalyticsClient["capture"]>[0];
function fakeClient() {
  const events: Captured[] = [];
  const client: AnalyticsClient = {
    capture: (m) => {
      events.push(m);
    },
    shutdown: async () => {},
  };
  return { client, events };
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("analytics wrapper", () => {
  afterEach(() => {
    __setAnalyticsClientForTests(undefined); // restore env-derived (no-op in tests)
  });

  it("no-ops when analytics is off (no POSTHOG_KEY in the test env)", () => {
    // No override installed + no env ⇒ getClient() is null. A capture must be a
    // silent no-op that never throws (a stale metric beats a failed mutation).
    expect(() => captureEvent("circle_created", { circleId: "c1" })).not.toThrow();
    // Explicit null override forces the off-path regardless of env.
    __setAnalyticsClientForTests(null);
    expect(() => captureEvent("match_sealed", { circleId: "c1" })).not.toThrow();
  });

  it("builds the EventMessage: default system distinct_id, circle group, circle_id/session_id props, Date timestamp", () => {
    const { client, events } = fakeClient();
    __setAnalyticsClientForTests(client);

    captureEvent("session_materialized", {
      circleId: "circle-123",
      sessionId: "session-456",
      timestamp: 1_700_000_000_000,
      properties: { standing_game_id: "sg-1", scheduled_for: 1_700_100_000_000 },
    });

    expect(events).toHaveLength(1);
    const [msg] = events;
    expect(msg.event).toBe("session_materialized");
    // No acting user was passed ⇒ system distinct_id, so a scheduler event
    // never gets attributed to a person.
    expect(msg.distinctId).toBe(SYSTEM_DISTINCT_ID);
    expect(msg.groups).toEqual({ circle: "circle-123" });
    expect(msg.properties).toMatchObject({
      circle_id: "circle-123",
      session_id: "session-456",
      standing_game_id: "sg-1",
      scheduled_for: 1_700_100_000_000,
    });
    expect(msg.timestamp).toBeInstanceOf(Date);
    expect((msg.timestamp as Date).getTime()).toBe(1_700_000_000_000);
    expect(msg.disableGeoip).toBe(true);
  });

  it("passes the acting user as distinct_id and omits session_id when absent", () => {
    const { client, events } = fakeClient();
    __setAnalyticsClientForTests(client);

    captureEvent("circle_created", { distinctId: "user-9", circleId: "c1", properties: { origin: "unknown" } });

    expect(events[0]!.distinctId).toBe("user-9");
    expect(events[0]!.properties).not.toHaveProperty("session_id");
  });

  it("never throws when the underlying client throws", () => {
    __setAnalyticsClientForTests({
      capture: () => {
        throw new Error("posthog exploded");
      },
      shutdown: async () => {},
    });
    expect(() => captureEvent("match_recorded", { circleId: "c1" })).not.toThrow();
  });

  it("shutdownAnalytics is safe when analytics is off", async () => {
    __setAnalyticsClientForTests(undefined);
    await expect(shutdownAnalytics()).resolves.toBeUndefined();
  });
});

describe("circle_created callsite (createCircle, after commit)", () => {
  let client: Awaited<ReturnType<typeof createTestClient>>;
  let store: CirclesStore;
  let organiser: { id: string };
  const fake = fakeClient();

  beforeEach(async () => {
    client = await createTestClient();
    store = createCirclesStore(client.db);
    __setAnalyticsClientForTests(fake.client);
    fake.events.length = 0;
    [organiser] = await client.db.insert(users).values({ email: "o@example.com", displayName: "Org" }).returning();
  });

  afterEach(async () => {
    __setAnalyticsClientForTests(undefined);
    await client.close();
  });

  it("captures circle_created with the creator as distinct_id, the circle group, and origin unknown", async () => {
    const circle = await store.createCircle({ name: "Tuesday Crew", creatorUserId: organiser.id });

    const created = fake.events.filter((e) => e.event === "circle_created");
    expect(created).toHaveLength(1);
    const [msg] = created;
    expect(msg.distinctId).toBe(organiser.id);
    expect(msg.groups).toEqual({ circle: circle.id });
    expect(msg.properties).toMatchObject({
      circle_id: circle.id,
      origin: "unknown", // no seed-attribution column yet — see metrics-manifest.md
      created_by: organiser.id,
      default_game_type: "competitive",
    });
  });
});

describe("match_recorded / match_sealed callsites (after commit)", () => {
  let store: MatchesStore;
  let db: CuatroDb;
  const fake = fakeClient();

  async function circleWithSession(createdBy: string) {
    const [circle] = await db
      .insert(circles)
      .values({ name: "C", inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy })
      .returning();
    const [session] = await db
      .insert(sessions)
      .values({ circleId: circle.id, startsAt: Date.now() - DAY_MS, status: "played" })
      .returning();
    return { circleId: circle.id, sessionId: session.id };
  }

  beforeEach(async () => {
    store = createMatchesStoreFromClient(await createTestClient());
    db = store.db;
    __setAnalyticsClientForTests(fake.client);
    fake.events.length = 0;
  });

  afterEach(async () => {
    __setAnalyticsClientForTests(undefined);
    await store.close();
  });

  it("match_recorded carries game_type + is_confirmable=true for two real teams; match_sealed carries game_type", async () => {
    const [a] = await db.insert(users).values({ email: "a@x.com", displayName: "A" }).returning();
    const [b] = await db.insert(users).values({ email: "b@x.com", displayName: "B" }).returning();
    const [c] = await db.insert(users).values({ email: "c@x.com", displayName: "C" }).returning();
    const [d] = await db.insert(users).values({ email: "d@x.com", displayName: "D" }).returning();
    const { circleId, sessionId } = await circleWithSession(a.id);

    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: a.id,
      teamA: [a.id, b.id],
      teamB: [c.id, d.id],
      sets: [
        { a: 6, b: 3 },
        { a: 6, b: 4 },
      ],
    });

    const recorded = fake.events.filter((e) => e.event === "match_recorded");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.groups).toEqual({ circle: circleId });
    expect(recorded[0]!.properties).toMatchObject({
      match_id: matchId,
      game_type: "competitive",
      team_a_all_guest: false,
      team_b_all_guest: false,
      is_confirmable: true,
      recorded_by: a.id,
    });

    // Opposing team confirms -> seal.
    const outcome = await store.confirmMatch(matchId, c.id);
    expect(outcome.status).toBe("verified");

    const sealed = fake.events.filter((e) => e.event === "match_sealed");
    expect(sealed).toHaveLength(1);
    // Friendlies manifest requirement: seal-rate events must carry game_type so
    // §9 metric 2 can filter to competitive only.
    expect(sealed[0]!.properties).toMatchObject({ match_id: matchId, game_type: "competitive" });

    // The confirming team's confirmation also emits match_confirmed (a/b).
    const confirmed = fake.events.filter((e) => e.event === "match_confirmed");
    expect(confirmed.length).toBeGreaterThanOrEqual(1);
    expect(confirmed.some((e) => (e.properties as Record<string, unknown>).confirming_team === "b")).toBe(true);
  });

  it("match_recorded marks an all-guest team unconfirmable (excluded from the seal-rate denominator)", async () => {
    const [a] = await db.insert(users).values({ email: "a2@x.com", displayName: "A" }).returning();
    const [b] = await db.insert(users).values({ email: "b2@x.com", displayName: "B" }).returning();
    const { sessionId } = await circleWithSession(a.id);

    const { matchId } = await store.recordMatch({
      sessionId,
      reporterId: a.id,
      teamA: [a.id, b.id],
      teamB: ["guest-1", "guest-2"],
      newGuests: [
        { token: "guest-1", name: "Guest One" },
        { token: "guest-2", name: "Guest Two" },
      ],
      sets: [{ a: 6, b: 0 }],
    });

    const recorded = fake.events.filter((e) => e.event === "match_recorded");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.properties).toMatchObject({
      match_id: matchId,
      team_a_all_guest: false,
      team_b_all_guest: true,
      is_confirmable: false,
    });
  });
});
