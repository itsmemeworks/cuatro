/**
 * The outsider view of a game page (Pete, 2026-07-11):
 *  - server/session-viewer.ts — who is looking (membership, whether the
 *    Circle's public preview may open, any pending session knock);
 *  - wide-game-detail-model.ts — the membership-aware back target (the old
 *    unconditional /circles/[id]/games link 404'd on non-members) and the
 *    outsider ask-affordance gate.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestClient,
  circleMembers,
  circles,
  knocks,
  sessions,
  users,
  type CuatroClient,
} from "@cuatro/db";
import { circleDiscoverable, getSessionViewerContext } from "@/server/session-viewer";
import { gameBackTarget, outsiderCanAsk } from "@/components/circle-screens/wide/wide-game-detail-model";

describe("session viewer context (outsider game view)", () => {
  let client: CuatroClient;
  let db: CuatroClient["db"];
  let inviteSeq = 0;

  const mkUser = async (overrides: Partial<typeof users.$inferInsert> = {}) => {
    const [u] = await db
      .insert(users)
      .values({ displayName: "U", email: `u${Math.random()}@e.com`, ...overrides })
      .returning();
    return u;
  };

  const mkCircle = async (createdBy: string, overrides: Partial<typeof circles.$inferInsert> = {}) => {
    const [c] = await db
      .insert(circles)
      .values({ name: "C", inviteCode: `INV${inviteSeq++}`, createdBy, ...overrides })
      .returning();
    return c;
  };

  const mkSession = async (circleId: string) => {
    const [s] = await db
      .insert(sessions)
      .values({ circleId, startsAt: Date.now() + 3 * 24 * 60 * 60 * 1000, status: "upcoming" })
      .returning();
    return s;
  };

  beforeEach(async () => {
    client = await createTestClient();
    db = client.db;
  });

  afterEach(async () => {
    await client.close();
  });

  it("a member gets viewerIsMember and never the preview affordance", async () => {
    const organiser = await mkUser();
    const member = await mkUser();
    const circle = await mkCircle(organiser.id, { openDoor: true, boardEnabled: true });
    await db.insert(circleMembers).values({ circleId: circle.id, userId: member.id, role: "member" });
    const session = await mkSession(circle.id);

    const ctx = await getSessionViewerContext(db, { circleId: circle.id, sessionId: session.id, userId: member.id });
    expect(ctx.viewerIsMember).toBe(true);
    expect(ctx.circlePreviewEnabled).toBe(false);
    expect(ctx.viewerHasPendingSessionKnock).toBe(false);
  });

  it("a non-member of a discoverable Circle gets the preview affordance", async () => {
    const organiser = await mkUser();
    const outsider = await mkUser();
    const circle = await mkCircle(organiser.id, { openDoor: true, boardEnabled: true });
    const session = await mkSession(circle.id);

    const ctx = await getSessionViewerContext(db, { circleId: circle.id, sessionId: session.id, userId: outsider.id });
    expect(ctx.viewerIsMember).toBe(false);
    expect(ctx.circlePreviewEnabled).toBe(true);
  });

  it("Board-only (invite-only) Circles still preview; PRIVATE Circles never do", async () => {
    const organiser = await mkUser();
    const outsider = await mkUser();

    const inviteOnly = await mkCircle(organiser.id, { openDoor: false, boardEnabled: true });
    expect(await circleDiscoverable(db, inviteOnly.id)).toBe(true);

    const priv = await mkCircle(organiser.id, { openDoor: false, boardEnabled: false });
    expect(await circleDiscoverable(db, priv.id)).toBe(false);
    const session = await mkSession(priv.id);
    const ctx = await getSessionViewerContext(db, { circleId: priv.id, sessionId: session.id, userId: outsider.id });
    expect(ctx.viewerIsMember).toBe(false);
    expect(ctx.circlePreviewEnabled).toBe(false);

    // A missing circle is as undiscoverable as a private one.
    expect(await circleDiscoverable(db, "00000000-0000-0000-0000-000000000000")).toBe(false);
  });

  it("surfaces the viewer's own pending session knock (and only pending, only theirs, only this session)", async () => {
    const organiser = await mkUser();
    const outsider = await mkUser();
    const otherOutsider = await mkUser();
    const circle = await mkCircle(organiser.id, { openDoor: true, boardEnabled: true });
    const session = await mkSession(circle.id);
    const otherSession = await mkSession(circle.id);

    // Someone else's pending knock and the viewer's knock on ANOTHER session
    // must not read as "asked" here.
    await db.insert(knocks).values({ kind: "session", targetId: session.id, userId: otherOutsider.id });
    await db.insert(knocks).values({ kind: "session", targetId: otherSession.id, userId: outsider.id });
    let ctx = await getSessionViewerContext(db, { circleId: circle.id, sessionId: session.id, userId: outsider.id });
    expect(ctx.viewerHasPendingSessionKnock).toBe(false);

    const [mine] = await db
      .insert(knocks)
      .values({ kind: "session", targetId: session.id, userId: outsider.id })
      .returning();
    ctx = await getSessionViewerContext(db, { circleId: circle.id, sessionId: session.id, userId: outsider.id });
    expect(ctx.viewerHasPendingSessionKnock).toBe(true);

    // A withdrawn knock stops counting.
    await db.update(knocks).set({ status: "withdrawn", decidedAt: Date.now() }).where(eq(knocks.id, mine.id));
    ctx = await getSessionViewerContext(db, { circleId: circle.id, sessionId: session.id, userId: outsider.id });
    expect(ctx.viewerHasPendingSessionKnock).toBe(false);
  });
});

describe("game back target (membership-aware ‹ back)", () => {
  it("members return to their Circle's games", () => {
    expect(gameBackTarget(true, "circle-1")).toEqual({ href: "/circles/circle-1/games", label: "‹ Games" });
  });

  it("non-members go back to Discover (the circle pages 404 on outsiders)", () => {
    expect(gameBackTarget(false, "circle-1")).toEqual({ href: "/discover", label: "‹ Discover" });
  });
});

describe("outsider ask gate", () => {
  const base = {
    viewerIsMember: false,
    upcoming: true,
    gameFull: false,
    rsvpWindowOpen: true,
    viewerStatus: null as "in" | "reserve" | "out" | null,
  };

  it("asks when the game is upcoming, open, and the window is open", () => {
    expect(outsiderCanAsk(base)).toBe(true);
  });

  it("members never see it (they RSVP directly)", () => {
    expect(outsiderCanAsk({ ...base, viewerIsMember: true })).toBe(false);
  });

  it("no ask on a past, full, or pre-window game", () => {
    expect(outsiderCanAsk({ ...base, upcoming: false })).toBe(false);
    expect(outsiderCanAsk({ ...base, gameFull: true })).toBe(false);
    expect(outsiderCanAsk({ ...base, rsvpWindowOpen: false })).toBe(false);
  });

  it("an accepted knocker / Fourth Call claimant (in without membership) is not re-asked", () => {
    expect(outsiderCanAsk({ ...base, viewerStatus: "in" })).toBe(false);
    expect(outsiderCanAsk({ ...base, viewerStatus: "reserve" })).toBe(false);
    // "out" holds no place — asking again is legitimate.
    expect(outsiderCanAsk({ ...base, viewerStatus: "out" })).toBe(true);
  });
});
