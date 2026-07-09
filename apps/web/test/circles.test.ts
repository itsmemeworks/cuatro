import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createClient, users } from "@cuatro/db";
import type { CuatroClient } from "@cuatro/db";
import {
  createCirclesStore,
  EmptyMessageError,
  InvalidCircleNameError,
  InvalidColourError,
  InvalidEmblemError,
  MAX_CIRCLE_NAME_LENGTH,
  MessageTooLongError,
  NotMemberError,
  NotOrganiserError,
  type CirclesStore,
} from "@/server/circles";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";
import { circleChannel } from "@/lib/realtime/channels";

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
    __setRealtimeSenderForTests(null);
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

  it("exposes verifiedMatchCount per member for the Placement Trio progress dots", async () => {
    const circle = await store.createCircle({ name: "Trio Circle", creatorUserId: organiser.id });
    await store.joinCircle({ inviteCode: circle.inviteCode, userId: member.id });

    const detailBefore = await store.getCircleDetail(circle.id, organiser.id);
    const memberRowBefore = detailBefore!.members.find((m) => m.userId === member.id)!;
    expect(memberRowBefore.rating).toBeNull();
    expect(memberRowBefore.verifiedMatchCount).toBe(0);

    await client.db.update(users).set({ verifiedMatchCount: 2 }).where(eq(users.id, member.id));

    const detailAfter = await store.getCircleDetail(circle.id, organiser.id);
    const memberRowAfter = detailAfter!.members.find((m) => m.userId === member.id)!;
    expect(memberRowAfter.verifiedMatchCount).toBe(2);
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

  it("passes the Board flag through updateCircleSettings and surfaces it on the detail", async () => {
    const circle = await store.createCircle({ name: "Tiers", creatorUserId: organiser.id });

    // Defaults to on (board-enabled) at creation.
    const before = await store.getCircleDetail(circle.id, organiser.id);
    expect(before!.boardEnabled).toBe(true);

    // Door shut + Board off → the private tier.
    await store.updateCircleSettings(circle.id, organiser.id, { openDoor: false, boardEnabled: false });
    const priv = await store.getCircleDetail(circle.id, organiser.id);
    expect(priv!.openDoor).toBe(false);
    expect(priv!.boardEnabled).toBe(false);

    // Board back on while the door stays shut → invite-only.
    await store.updateCircleSettings(circle.id, organiser.id, { boardEnabled: true });
    const invite = await store.getCircleDetail(circle.id, organiser.id);
    expect(invite!.openDoor).toBe(false);
    expect(invite!.boardEnabled).toBe(true);
  });

  it("updates name, colour and emblem together, accepting any single emoji", async () => {
    const circle = await store.createCircle({ name: "Plain", creatorUserId: organiser.id });

    await store.updateCircleSettings(circle.id, organiser.id, {
      name: "  Duck Club  ",
      colour: "#2FA05A",
      emblem: "🦆",
    });

    const detail = await store.getCircleDetail(circle.id, organiser.id);
    expect(detail!.name).toBe("Duck Club");
    expect(detail!.colour).toBe("#2FA05A");
    expect(detail!.emblem).toBe("🦆");
  });

  it("clears the emblem back to null when given an empty string", async () => {
    const circle = await store.createCircle({ name: "Marked", emblem: "🎾", creatorUserId: organiser.id });
    await store.updateCircleSettings(circle.id, organiser.id, { emblem: "  " });
    const detail = await store.getCircleDetail(circle.id, organiser.id);
    expect(detail!.emblem).toBeNull();
  });

  it("rejects an emblem that is more than one grapheme cluster", async () => {
    const circle = await store.createCircle({ name: "Marked", creatorUserId: organiser.id });
    await expect(
      store.updateCircleSettings(circle.id, organiser.id, { emblem: "🦆🦆" }),
    ).rejects.toThrow(InvalidEmblemError);
    await expect(
      store.updateCircleSettings(circle.id, organiser.id, { emblem: "AB" }),
    ).rejects.toThrow(InvalidEmblemError);
  });

  it("accepts a composed ZWJ-sequence emoji as a single grapheme", async () => {
    const circle = await store.createCircle({ name: "Family", creatorUserId: organiser.id });
    await store.updateCircleSettings(circle.id, organiser.id, { emblem: "👨‍👩‍👧" });
    const detail = await store.getCircleDetail(circle.id, organiser.id);
    expect(detail!.emblem).toBe("👨‍👩‍👧");
  });

  it("rejects an empty or whitespace-only name", async () => {
    const circle = await store.createCircle({ name: "Has A Name", creatorUserId: organiser.id });
    await expect(
      store.updateCircleSettings(circle.id, organiser.id, { name: "   " }),
    ).rejects.toThrow(InvalidCircleNameError);
  });

  it("rejects a name longer than the max length", async () => {
    const circle = await store.createCircle({ name: "Short", creatorUserId: organiser.id });
    await expect(
      store.updateCircleSettings(circle.id, organiser.id, { name: "x".repeat(MAX_CIRCLE_NAME_LENGTH + 1) }),
    ).rejects.toThrow(InvalidCircleNameError);
  });

  it("rejects a colour that is not a #rrggbb hex value", async () => {
    const circle = await store.createCircle({ name: "Coloured", creatorUserId: organiser.id });
    await expect(
      store.updateCircleSettings(circle.id, organiser.id, { colour: "red" }),
    ).rejects.toThrow(InvalidColourError);
  });

  it("rejects creating a circle with an empty name or a multi-emoji emblem", async () => {
    await expect(store.createCircle({ name: "   ", creatorUserId: organiser.id })).rejects.toThrow(
      InvalidCircleNameError,
    );
    await expect(
      store.createCircle({ name: "Valid", emblem: "🦆🔥", creatorUserId: organiser.id }),
    ).rejects.toThrow(InvalidEmblemError);
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

  it("postMessage broadcasts a minimal 'message' event on the circle's realtime channel — never the body", async () => {
    const circle = await store.createCircle({ name: "Chat Circle", creatorUserId: organiser.id });
    const calls: { topic: string; type: string; fields: Record<string, unknown> }[] = [];
    __setRealtimeSenderForTests(async (topic, type, fields) => {
      calls.push({ topic, type, fields });
    });

    const message = await store.postMessage({ circleId: circle.id, userId: organiser.id, body: "secret plans" });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.topic).toBe(circleChannel(circle.id));
    expect(calls[0]!.type).toBe("message");
    expect(calls[0]!.fields).toEqual({ circleId: circle.id, messageId: message.id });
    expect(JSON.stringify(calls[0]!.fields)).not.toContain("secret plans");
  });
});
