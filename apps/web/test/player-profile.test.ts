import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  circleMembers,
  circles,
  sessions,
  users,
  type CuatroClient,
} from "@cuatro/db";

// getPlayerProfile/getPlayerLedger compose the shared db + the matches store,
// both module-level singletons in prod. Point both at one in-memory client so
// the read model runs against real data (mirrors discovery-settings.test.ts).
const h = vi.hoisted(() => ({ client: null as unknown as CuatroClient }));
vi.mock("@/server/db", () => ({ getDb: vi.fn(async () => ({ db: h.client.db })) }));
vi.mock("@/server/matches-db", async (orig) => {
  const actual = await orig<typeof import("@/server/matches-db")>();
  return { ...actual, getMatchesStore: vi.fn(async () => actual.createMatchesStoreFromClient(h.client)) };
});

import { createTestClient } from "@cuatro/db";
import { createMatchesStoreFromClient, type MatchesStore } from "@/server/matches-db";
import { getPlayerLedger, getPlayerProfile } from "@/server/players";

const DAY_MS = 24 * 60 * 60 * 1000;

async function insertUser(client: CuatroClient, email: string, displayName: string, extra: Record<string, unknown> = {}) {
  const [row] = await client.db.insert(users).values({ email, displayName, ...extra }).returning();
  return row;
}

async function insertCircleAndSession(client: CuatroClient, createdBy: string, startsAt: Date) {
  const [circle] = await client.db
    .insert(circles)
    .values({ name: "Test Circle", inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy })
    .returning();
  const [session] = await client.db
    .insert(sessions)
    .values({ circleId: circle.id, startsAt: startsAt.getTime(), status: "played" })
    .returning();
  return { circleId: circle.id, sessionId: session.id };
}

describe("public player profile read model", () => {
  let store: MatchesStore;

  beforeEach(async () => {
    h.client = await createTestClient();
    store = createMatchesStoreFromClient(h.client);
  });

  afterEach(async () => {
    await h.client.close();
  });

  it("returns null for an unknown user id", async () => {
    expect(await getPlayerProfile("nope")).toBeNull();
    expect(await getPlayerLedger("nope")).toBeNull();
  });

  it("reports a guest as isGuest with no rating", async () => {
    const guest = await insertUser(h.client, `g-${Math.random()}@x.com`, "Casey Guest", { isGuest: true });
    const profile = await getPlayerProfile(guest.id);
    expect(profile).not.toBeNull();
    expect(profile!.user.isGuest).toBe(true);
    expect(profile!.glass?.status).toBe("unrated");
  });

  it("assembles a rated player's Glass, history, ledger, and circles in common", async () => {
    const viewer = await insertUser(h.client, "viewer@x.com", "Vic Viewer");
    const target = await insertUser(h.client, "target@x.com", "Tara Target");
    const partner = await insertUser(h.client, "partner@x.com", "Pat Partner");

    // A shared circle → circlesInCommon = 1.
    const [shared] = await h.client.db
      .insert(circles)
      .values({ name: "Shared", inviteCode: `INV-shared-${Math.random().toString(36).slice(2, 8)}`, createdBy: viewer.id })
      .returning();
    await h.client.db.insert(circleMembers).values({ circleId: shared.id, userId: viewer.id, role: "organiser" });
    await h.client.db.insert(circleMembers).values({ circleId: shared.id, userId: target.id, role: "member" });

    // Three verified wins → target crosses the Placement Trio and becomes rated.
    const start = Date.now() - 10 * DAY_MS;
    for (let i = 0; i < 3; i++) {
      const opp1 = await insertUser(h.client, `o1-${i}@x.com`, `Opp1-${i}`);
      const opp2 = await insertUser(h.client, `o2-${i}@x.com`, `Opp2-${i}`);
      const { sessionId } = await insertCircleAndSession(h.client, target.id, new Date(start + i * DAY_MS));
      const { matchId } = await store.recordMatch({
        sessionId,
        reporterId: target.id,
        teamA: [target.id, partner.id],
        teamB: [opp1.id, opp2.id],
        sets: [{ a: 6, b: 2 }],
      });
      await store.confirmMatch(matchId, opp1.id);
    }

    const profile = await getPlayerProfile(target.id, viewer.id);
    expect(profile).not.toBeNull();
    expect(profile!.user.displayName).toBe("Tara Target");
    expect(profile!.user.isGuest).toBe(false);
    expect(profile!.glass?.status).toBe("rated");
    expect(profile!.glass?.rating).not.toBeNull();
    expect(profile!.history.wins).toBe(3);
    expect(profile!.history.losses).toBe(0);
    expect(profile!.circlesInCommon).toBe(1);
    expect(profile!.streak).toEqual({ kind: "W", count: 3 });
    expect(profile!.lastThree.filter(Boolean)).toHaveLength(3);
    expect(profile!.lastThree[0]).toMatchObject({ won: true, label: "W 6–2" });

    const ledger = await getPlayerLedger(target.id);
    expect(ledger).not.toBeNull();
    expect(ledger!.user.displayName).toBe("Tara Target");
    // 3 match events + the Placement-Trio genesis row.
    expect(ledger!.rows.length).toBeGreaterThanOrEqual(3);
    const scored = ledger!.rows.filter((r) => r.score !== null);
    expect(scored.length).toBe(3);
    expect(scored[0]!.score).toBe("6–2");
    expect(scored[0]!.opponentNames).toContain("Opp1");
  });

  it("circlesInCommon is null when the viewer is the player themselves", async () => {
    const solo = await insertUser(h.client, "solo@x.com", "Solo");
    const profile = await getPlayerProfile(solo.id, solo.id);
    expect(profile!.circlesInCommon).toBeNull();
  });
});
