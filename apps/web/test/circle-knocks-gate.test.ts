import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { circleMembers, circles, createTestClient, knocks, users, type CuatroClient } from "@cuatro/db";
import { pendingKnockItems } from "@/app/(app)/circles/[id]/load-circle";

/**
 * Members-page capability gate (fix wave F3 — Sentry CUATRO-7, QA2's
 * post-hand-back error boundary): loadCircleContext reads `myRole` once
 * (getCircleDetail) and circleKnocks re-checks the role itself several awaits
 * later, so a transfer/removal committing between the two reads used to throw
 * NotOrganiserError/NotMemberError straight into the members page's error
 * boundary. pendingKnockItems is that gap in miniature: calling it with a
 * STALE myRole="organiser" for a viewer whose role has already changed must
 * degrade to the member view (no knock queue), never throw.
 */
describe("pendingKnockItems — capability gate", () => {
  let client: CuatroClient;
  let db: CuatroClient["db"];
  let inviteSeq = 0;

  const mkUser = async (name: string) => {
    const [u] = await db
      .insert(users)
      .values({ displayName: name, email: `${name}${Math.random()}@e.com` })
      .returning();
    return u;
  };

  const mkCircle = async (createdBy: string) => {
    const [c] = await db
      .insert(circles)
      .values({ name: "Gate Test", inviteCode: `GATE${inviteSeq++}`, createdBy, openDoor: true })
      .returning();
    return c;
  };

  beforeEach(async () => {
    client = await createTestClient();
    db = client.db;
  });

  afterEach(async () => {
    await client.close();
  });

  it("returns the pending knocks for a real organiser", async () => {
    const organiser = await mkUser("Org");
    const knocker = await mkUser("Knocker");
    const circle = await mkCircle(organiser.id);
    await db.insert(circleMembers).values({ circleId: circle.id, userId: organiser.id, role: "organiser" });
    await db.insert(knocks).values({ kind: "circle", targetId: circle.id, userId: knocker.id, message: "let me in" });

    const items = await pendingKnockItems(db, circle.id, organiser.id, "organiser");
    expect(items).toHaveLength(1);
    expect(items[0].displayName).toBe("Knocker");
  });

  it("short-circuits to [] for a member role without querying", async () => {
    const organiser = await mkUser("Org");
    const member = await mkUser("Mem");
    const circle = await mkCircle(organiser.id);
    await db.insert(circleMembers).values({ circleId: circle.id, userId: organiser.id, role: "organiser" });
    await db.insert(circleMembers).values({ circleId: circle.id, userId: member.id, role: "member" });

    await expect(pendingKnockItems(db, circle.id, member.id, "member")).resolves.toEqual([]);
  });

  it("degrades to [] (never throws) when the role went stale: viewer demoted to member between reads", async () => {
    const organiser = await mkUser("Org");
    const demoted = await mkUser("Demoted");
    const circle = await mkCircle(organiser.id);
    await db.insert(circleMembers).values({ circleId: circle.id, userId: organiser.id, role: "organiser" });
    // The viewer's LIVE role is member — but the caller still holds a stale
    // myRole="organiser" from before the hand-back committed.
    await db.insert(circleMembers).values({ circleId: circle.id, userId: demoted.id, role: "member" });

    await expect(pendingKnockItems(db, circle.id, demoted.id, "organiser")).resolves.toEqual([]);
  });

  it("degrades to [] (never throws) when the viewer was removed between reads", async () => {
    const organiser = await mkUser("Org");
    const removed = await mkUser("Removed");
    const circle = await mkCircle(organiser.id);
    await db.insert(circleMembers).values({ circleId: circle.id, userId: organiser.id, role: "organiser" });
    // `removed` has NO membership row at all — the caller's myRole is stale.

    await expect(pendingKnockItems(db, circle.id, removed.id, "organiser")).resolves.toEqual([]);
  });
});
