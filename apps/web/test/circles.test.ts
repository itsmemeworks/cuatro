import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient, users } from "@cuatro/db";
import type { CuatroClient } from "@cuatro/db";
import {
  createCirclesStore,
  EmptyMessageError,
  MessageTooLongError,
  NotMemberError,
  NotOrganiserError,
  type CirclesStore,
} from "@/server/circles";

describe("circles store (@cuatro/db)", () => {
  let client: CuatroClient;
  let store: CirclesStore;
  let organiser: { id: string };
  let member: { id: string };
  let outsider: { id: string };

  beforeEach(async () => {
    client = createClient(":memory:");
    store = createCirclesStore(client.db);

    [organiser] = await client.db
      .insert(users)
      .values({ email: "organiser@example.com", displayName: "Organiser" })
      .returning();
    [member] = await client.db
      .insert(users)
      .values({ email: "member@example.com", displayName: "Member" })
      .returning();
    [outsider] = await client.db
      .insert(users)
      .values({ email: "outsider@example.com", displayName: "Outsider" })
      .returning();
  });

  afterEach(() => {
    client.close();
  });

  it("creates a circle with the creator as organiser and a well-formed invite code", async () => {
    const circle = await store.createCircle({ name: "  Tuesday Crew  ", creatorUserId: organiser.id });

    expect(circle.name).toBe("Tuesday Crew");
    expect(circle.myRole).toBe("organiser");
    expect(circle.memberCount).toBe(1);
    expect(circle.countryCode).toBe("GB");
    expect(circle.timezone).toBe("Europe/London");
    expect(circle.inviteCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  });

  it("retries invite-code generation on a collision and still succeeds", async () => {
    let calls = 0;
    const codes = ["COLLIDE1", "COLLIDE1", "UNIQUE99"];
    const storeWithForcedCollision = createCirclesStore(client.db, {
      generateInviteCode: () => codes[calls++],
    });

    const first = await storeWithForcedCollision.createCircle({ name: "First", creatorUserId: organiser.id });
    expect(first.inviteCode).toBe("COLLIDE1");

    const second = await storeWithForcedCollision.createCircle({ name: "Second", creatorUserId: organiser.id });
    expect(second.inviteCode).toBe("UNIQUE99");
    expect(calls).toBe(3);
  });

  it("generates distinct invite codes across many circles", async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const circle = await store.createCircle({ name: `Circle ${i}`, creatorUserId: organiser.id });
      codes.add(circle.inviteCode);
    }
    expect(codes.size).toBe(25);
  });

  it("joins a circle by invite code and is idempotent on re-join", async () => {
    const circle = await store.createCircle({ name: "Weekend Four", creatorUserId: organiser.id });

    const firstJoin = await store.joinCircle({ inviteCode: circle.inviteCode, userId: member.id });
    expect(firstJoin).toEqual({ circleId: circle.id, circleName: circle.name, alreadyMember: false });

    const secondJoin = await store.joinCircle({ inviteCode: circle.inviteCode, userId: member.id });
    expect(secondJoin).toEqual({ circleId: circle.id, circleName: circle.name, alreadyMember: true });

    const detail = await store.getCircleDetail(circle.id, organiser.id);
    const memberRows = detail!.members.filter((m) => m.userId === member.id);
    expect(memberRows).toHaveLength(1);
  });

  it("returns null when joining with an unknown invite code", async () => {
    const result = await store.joinCircle({ inviteCode: "NOPE0000", userId: member.id });
    expect(result).toBeNull();
  });

  it("returns null from getCircleByInviteCode for an unknown code", async () => {
    expect(await store.getCircleByInviteCode("NOPE0000")).toBeNull();
  });

  it("enforces membership on getCircleDetail", async () => {
    const circle = await store.createCircle({ name: "Private Circle", creatorUserId: organiser.id });

    await expect(store.getCircleDetail(circle.id, outsider.id)).rejects.toThrow(NotMemberError);
    await expect(store.getCircleDetail(circle.id, organiser.id)).resolves.not.toBeNull();
  });

  it("enforces the organiser role on updateCircleSettings", async () => {
    const circle = await store.createCircle({ name: "Original Name", creatorUserId: organiser.id });
    await store.joinCircle({ inviteCode: circle.inviteCode, userId: member.id });

    await expect(
      store.updateCircleSettings(circle.id, member.id, { name: "Hijacked" }),
    ).rejects.toThrow(NotOrganiserError);
    await expect(
      store.updateCircleSettings(circle.id, outsider.id, { name: "Hijacked" }),
    ).rejects.toThrow(NotMemberError);

    await store.updateCircleSettings(circle.id, organiser.id, { name: "Renamed Circle" });
    const detail = await store.getCircleDetail(circle.id, organiser.id);
    expect(detail!.name).toBe("Renamed Circle");
  });

  it("lists circles for a user with member counts and roles", async () => {
    const circle = await store.createCircle({ name: "Shared Circle", creatorUserId: organiser.id });
    await store.joinCircle({ inviteCode: circle.inviteCode, userId: member.id });

    const forOrganiser = await store.listCirclesForUser(organiser.id);
    expect(forOrganiser).toHaveLength(1);
    expect(forOrganiser[0]).toMatchObject({ id: circle.id, memberCount: 2, myRole: "organiser" });

    const forMember = await store.listCirclesForUser(member.id);
    expect(forMember).toHaveLength(1);
    expect(forMember[0]).toMatchObject({ id: circle.id, memberCount: 2, myRole: "member" });

    expect(await store.listCirclesForUser(outsider.id)).toHaveLength(0);
  });

  it("enforces membership on postMessage and listMessages", async () => {
    const circle = await store.createCircle({ name: "Chat Circle", creatorUserId: organiser.id });

    await expect(
      store.postMessage({ circleId: circle.id, userId: outsider.id, body: "hi" }),
    ).rejects.toThrow(NotMemberError);
    await expect(store.listMessages(circle.id, outsider.id)).rejects.toThrow(NotMemberError);
  });

  it("rejects empty or over-length message bodies", async () => {
    const circle = await store.createCircle({ name: "Chat Circle", creatorUserId: organiser.id });

    await expect(
      store.postMessage({ circleId: circle.id, userId: organiser.id, body: "   " }),
    ).rejects.toThrow(EmptyMessageError);
    await expect(
      store.postMessage({ circleId: circle.id, userId: organiser.id, body: "x".repeat(2001) }),
    ).rejects.toThrow(MessageTooLongError);
  });

  it("persists messages and returns them in insertion order", async () => {
    const circle = await store.createCircle({ name: "Chat Circle", creatorUserId: organiser.id });
    await store.joinCircle({ inviteCode: circle.inviteCode, userId: member.id });

    const first = await store.postMessage({ circleId: circle.id, userId: organiser.id, body: "hello circle" });
    const second = await store.postMessage({ circleId: circle.id, userId: member.id, body: "hey!" });
    const third = await store.postMessage({ circleId: circle.id, userId: organiser.id, body: "ready for Tuesday?" });

    expect(first.displayName).toBe("Organiser");
    expect(second.displayName).toBe("Member");

    const messages = await store.listMessages(circle.id, organiser.id);
    expect(messages.map((m) => m.id)).toEqual([first.id, second.id, third.id]);
    expect(messages.map((m) => m.body)).toEqual(["hello circle", "hey!", "ready for Tuesday?"]);
  });

  it("supports fetching only messages after a given timestamp", async () => {
    const circle = await store.createCircle({ name: "Chat Circle", creatorUserId: organiser.id });
    const first = await store.postMessage({ circleId: circle.id, userId: organiser.id, body: "one" });
    // Real ms gap so `after: first.createdAt` deterministically excludes
    // `first` and includes `second`, regardless of clock resolution.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await store.postMessage({ circleId: circle.id, userId: organiser.id, body: "two" });

    const messages = await store.listMessages(circle.id, organiser.id, { after: first.createdAt });
    expect(messages.map((m) => m.id)).toEqual([second.id]);
  });
});
