import { afterEach, describe, expect, it } from "vitest";
import { circleMessages } from "@cuatro/db";
import { seedCircle, type Fixture } from "./support/games-fixtures";
import { getUnreadCountForCircle, getUnreadCountsForCircles, hasUnreadMessages, markCircleRead } from "@/server/circle-unread";

let fixture: Fixture | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

async function postMessage(fixture: Fixture, userId: string, body: string, createdAt?: number) {
  await fixture.db.insert(circleMessages).values({ circleId: fixture.circleId, userId, body, ...(createdAt !== undefined ? { createdAt } : {}) });
}

describe("getUnreadCountForCircle", () => {
  it("counts every message from OTHER members as unread when last_read_at is null (never opened)", async () => {
    fixture = await seedCircle({ memberCount: 2 });
    const [m1, m2] = fixture.memberIds;
    await postMessage(fixture, m1, "hi");
    await postMessage(fixture, m2, "hey");

    expect(await getUnreadCountForCircle(fixture.db, fixture.circleId, fixture.organiserId)).toBe(2);
  });

  it("excludes the viewer's own messages", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const [m1] = fixture.memberIds;
    await postMessage(fixture, fixture.organiserId, "my own message");
    await postMessage(fixture, m1, "someone else's");

    expect(await getUnreadCountForCircle(fixture.db, fixture.circleId, fixture.organiserId)).toBe(1);
  });

  it("only counts messages after last_read_at once the circle has been marked read", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const [m1] = fixture.memberIds;
    const before = Date.now() - 60_000;
    await postMessage(fixture, m1, "before mark-read", before);

    await markCircleRead(fixture.db, fixture.circleId, fixture.organiserId, Date.now());
    expect(await getUnreadCountForCircle(fixture.db, fixture.circleId, fixture.organiserId)).toBe(0);

    await postMessage(fixture, m1, "after mark-read", Date.now() + 60_000);
    expect(await getUnreadCountForCircle(fixture.db, fixture.circleId, fixture.organiserId)).toBe(1);
  });

  it("returns 0 for a non-member without throwing", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    expect(await getUnreadCountForCircle(fixture.db, fixture.circleId, "not-a-member")).toBe(0);
  });
});

describe("markCircleRead", () => {
  it("returns false for a non-member (no row matched)", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    expect(await markCircleRead(fixture.db, fixture.circleId, "not-a-member")).toBe(false);
  });

  it("returns true and updates last_read_at for a member", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    expect(await markCircleRead(fixture.db, fixture.circleId, fixture.organiserId)).toBe(true);
  });
});

describe("getUnreadCountsForCircles / hasUnreadMessages", () => {
  it("aggregates per-circle counts and the has-any-unread flag across multiple circles", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const second = await seedCircle({ memberCount: 1 });
    try {
      const [m1] = fixture.memberIds;
      await postMessage(fixture, m1, "unread in circle one");

      // second fixture is a completely separate :memory: db/circle — the
      // viewer here (fixture.organiserId) isn't a member of it, so it
      // contributes 0 regardless of its own messages.
      const counts = await getUnreadCountsForCircles(fixture.db, [fixture.circleId], fixture.organiserId);
      expect(counts).toEqual({ [fixture.circleId]: 1 });

      expect(await hasUnreadMessages(fixture.db, [fixture.circleId], fixture.organiserId)).toBe(true);
      await markCircleRead(fixture.db, fixture.circleId, fixture.organiserId);
      expect(await hasUnreadMessages(fixture.db, [fixture.circleId], fixture.organiserId)).toBe(false);
    } finally {
      await second.close();
    }
  });
});
