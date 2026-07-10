import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { circleMembers, circles, notifications, rsvps, users } from "@cuatro/db";
import { seedCircle, type Fixture } from "./support/games-fixtures";
import {
  CannotRemoveSelfError,
  CannotTransferToGuestError,
  CannotTransferToSelfError,
  createCirclesStore,
  LastOrganiserError,
  NotOrganiserError,
  TargetNotMemberError,
  type CirclesStore,
} from "@/server/circles";
import { ensureUpcomingSessionForStandingGame, rsvpIn } from "@/server/games-service";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";
import { circleChannel } from "@/lib/realtime/channels";

// A `now` inside the default 6-day RSVP window before the Tuesday 20:00 game
// used by the standing-game fixtures below.
const IN_WINDOW = new Date("2026-01-05T00:00:00.000Z");

let fixture: Fixture | undefined;
let store: CirclesStore;

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
  __setRealtimeSenderForTests(null);
});

function makeStore(fx: Fixture) {
  store = createCirclesStore(fx.db);
  return store;
}

async function roleOf(fx: Fixture, userId: string): Promise<string | undefined> {
  const [row] = await fx.db
    .select({ role: circleMembers.role })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, fx.circleId), eq(circleMembers.userId, userId)));
  return row?.role;
}

async function memberCount(fx: Fixture): Promise<number> {
  const rows = await fx.db.select().from(circleMembers).where(eq(circleMembers.circleId, fx.circleId));
  return rows.length;
}

describe("leaveCircle", () => {
  it("removes a member's roster row but keeps their user record", async () => {
    fixture = await seedCircle({ memberCount: 2 });
    makeStore(fixture);
    const leaver = fixture.memberIds[0];

    await store.leaveCircle(fixture.circleId, leaver);

    expect(await roleOf(fixture, leaver)).toBeUndefined();
    expect(await memberCount(fixture)).toBe(2); // organiser + one remaining member
    const [stillExists] = await fixture.db.select().from(users).where(eq(users.id, leaver));
    expect(stillExists).toBeDefined();
  });

  it("blocks the sole organiser from leaving while other members remain", async () => {
    fixture = await seedCircle({ memberCount: 2 });
    makeStore(fixture);

    await expect(store.leaveCircle(fixture.circleId, fixture.organiserId)).rejects.toBeInstanceOf(LastOrganiserError);
    expect(await roleOf(fixture, fixture.organiserId)).toBe("organiser");
  });

  it("lets an organiser leave when another organiser remains", async () => {
    fixture = await seedCircle({ memberCount: 2 });
    makeStore(fixture);
    // Promote a second organiser directly, then the original may step out.
    await fixture.db
      .update(circleMembers)
      .set({ role: "organiser" })
      .where(and(eq(circleMembers.circleId, fixture.circleId), eq(circleMembers.userId, fixture.memberIds[0])));

    await store.leaveCircle(fixture.circleId, fixture.organiserId);

    expect(await roleOf(fixture, fixture.organiserId)).toBeUndefined();
    expect(await roleOf(fixture, fixture.memberIds[0])).toBe("organiser");
  });

  it("lets the last member leave, leaving an empty Circle with the door shut", async () => {
    fixture = await seedCircle({ memberCount: 0 }); // organiser only
    makeStore(fixture);

    await store.leaveCircle(fixture.circleId, fixture.organiserId);

    expect(await memberCount(fixture)).toBe(0);
    const [circle] = await fixture.db.select().from(circles).where(eq(circles.id, fixture.circleId));
    expect(circle).toBeDefined(); // the Circle row stays
    expect(circle.openDoor).toBe(false);
    expect(circle.boardEnabled).toBe(false);
  });

  it("is a no-op for a non-member", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    makeStore(fixture);
    const [outsider] = await fixture.db
      .insert(users)
      .values({ email: "outsider@example.com", displayName: "Outsider" })
      .returning();

    await expect(store.leaveCircle(fixture.circleId, outsider.id)).resolves.toBeUndefined();
    expect(await memberCount(fixture)).toBe(2);
  });

  it("broadcasts a roster signal on the circle channel after leaving", async () => {
    fixture = await seedCircle({ memberCount: 2 });
    makeStore(fixture);
    const calls: Array<{ topic: string; type: string; fields: Record<string, unknown> }> = [];
    __setRealtimeSenderForTests(async (topic, type, fields) => {
      calls.push({ topic, type, fields });
    });

    await store.leaveCircle(fixture.circleId, fixture.memberIds[0]);

    const rosterCall = calls.find((c) => c.topic === circleChannel(fixture!.circleId) && c.fields.reason === "roster");
    expect(rosterCall).toBeDefined();
  });
});

describe("removeMember", () => {
  it("lets an organiser remove a member and writes them one notification", async () => {
    fixture = await seedCircle({ memberCount: 2 });
    makeStore(fixture);
    const target = fixture.memberIds[0];

    await store.removeMember(fixture.circleId, fixture.organiserId, target);

    expect(await roleOf(fixture, target)).toBeUndefined();
    const notes = await fixture.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, target), eq(notifications.type, "member_removed")));
    expect(notes).toHaveLength(1);
  });

  it("withdraws the removed member's future RSVP and promotes the waiting reserve", async () => {
    fixture = await seedCircle({ memberCount: 5, standingGame: { weekday: 2, startTime: "20:00" } });
    makeStore(fixture);
    const session = await ensureUpcomingSessionForStandingGame(fixture.db, fixture.standingGameId!, IN_WINDOW);
    // Fill all four slots (organiser + 3 members), leave one member as reserve #1.
    const confirmed = [fixture.organiserId, fixture.memberIds[0], fixture.memberIds[1], fixture.memberIds[2]];
    for (const uid of confirmed) await rsvpIn(fixture.db, session.id, uid, IN_WINDOW);
    const reserve = fixture.memberIds[3];
    await rsvpIn(fixture.db, session.id, reserve, IN_WINDOW);

    // Remove a confirmed member — their slot must free and the reserve step in.
    await store.removeMember(fixture.circleId, fixture.organiserId, fixture.memberIds[0], IN_WINDOW);

    const [removedRsvp] = await fixture.db
      .select()
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, session.id), eq(rsvps.userId, fixture.memberIds[0])));
    expect(removedRsvp.status).toBe("out");
    const [reserveRsvp] = await fixture.db
      .select()
      .from(rsvps)
      .where(and(eq(rsvps.sessionId, session.id), eq(rsvps.userId, reserve)));
    expect(reserveRsvp.status).toBe("in");
  });

  it("rejects a non-organiser", async () => {
    fixture = await seedCircle({ memberCount: 2 });
    makeStore(fixture);
    await expect(
      store.removeMember(fixture.circleId, fixture.memberIds[0], fixture.memberIds[1]),
    ).rejects.toBeInstanceOf(NotOrganiserError);
  });

  it("won't let an organiser remove themselves", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    makeStore(fixture);
    await expect(
      store.removeMember(fixture.circleId, fixture.organiserId, fixture.organiserId),
    ).rejects.toBeInstanceOf(CannotRemoveSelfError);
  });

  it("rejects removing someone who isn't a member", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    makeStore(fixture);
    const [outsider] = await fixture.db
      .insert(users)
      .values({ email: "outsider@example.com", displayName: "Outsider" })
      .returning();
    await expect(
      store.removeMember(fixture.circleId, fixture.organiserId, outsider.id),
    ).rejects.toBeInstanceOf(TargetNotMemberError);
  });
});

describe("transferOrganiser", () => {
  it("hands the role over and steps the caller back to member", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    makeStore(fixture);
    const target = fixture.memberIds[0];

    await store.transferOrganiser(fixture.circleId, fixture.organiserId, target);

    expect(await roleOf(fixture, target)).toBe("organiser");
    expect(await roleOf(fixture, fixture.organiserId)).toBe("member");
    const notes = await fixture.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, target), eq(notifications.type, "organiser_transferred")));
    expect(notes).toHaveLength(1);
  });

  it("rejects a non-organiser caller", async () => {
    fixture = await seedCircle({ memberCount: 2 });
    makeStore(fixture);
    await expect(
      store.transferOrganiser(fixture.circleId, fixture.memberIds[0], fixture.memberIds[1]),
    ).rejects.toBeInstanceOf(NotOrganiserError);
  });

  it("won't transfer to yourself", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    makeStore(fixture);
    await expect(
      store.transferOrganiser(fixture.circleId, fixture.organiserId, fixture.organiserId),
    ).rejects.toBeInstanceOf(CannotTransferToSelfError);
  });

  it("rejects a target who isn't a member", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    makeStore(fixture);
    const [outsider] = await fixture.db
      .insert(users)
      .values({ email: "outsider@example.com", displayName: "Outsider" })
      .returning();
    await expect(
      store.transferOrganiser(fixture.circleId, fixture.organiserId, outsider.id),
    ).rejects.toBeInstanceOf(TargetNotMemberError);
  });

  it("won't make a guest the organiser", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    makeStore(fixture);
    const [guest] = await fixture.db
      .insert(users)
      .values({ displayName: "Guest", isGuest: true })
      .returning();
    await fixture.db.insert(circleMembers).values({ circleId: fixture.circleId, userId: guest.id, role: "member" });
    await expect(
      store.transferOrganiser(fixture.circleId, fixture.organiserId, guest.id),
    ).rejects.toBeInstanceOf(CannotTransferToGuestError);
  });
});
