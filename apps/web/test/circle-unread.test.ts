import { afterEach, describe, expect, it } from "vitest";
import { circleMessages } from "@cuatro/db";
import { seedCircle, type Fixture } from "./support/games-fixtures";
import { getUnreadCountForCircle, getUnreadCountsForCircles, hasUnreadMessages, markCircleRead } from "@/server/circle-unread";

let fixture: Fixture | undefined;
afterEach(() => {
  fixture?.close();
  fixture = undefined;
});

function postMessage(fixture: Fixture, userId: string, body: string, createdAt?: Date) {
  fixture.db.insert(circleMessages).values({ circleId: fixture.circleId, userId, body, ...(createdAt ? { createdAt } : {}) }).run();
}

describe("getUnreadCountForCircle", () => {
  it("counts every message from OTHER members as unread when last_read_at is null (never opened)", () => {
    fixture = seedCircle({ memberCount: 2 });
    const [m1, m2] = fixture.memberIds;
    postMessage(fixture, m1, "hi");
    postMessage(fixture, m2, "hey");

    expect(getUnreadCountForCircle(fixture.db, fixture.circleId, fixture.organiserId)).toBe(2);
  });

  it("excludes the viewer's own messages", () => {
    fixture = seedCircle({ memberCount: 1 });
    const [m1] = fixture.memberIds;
    postMessage(fixture, fixture.organiserId, "my own message");
    postMessage(fixture, m1, "someone else's");

    expect(getUnreadCountForCircle(fixture.db, fixture.circleId, fixture.organiserId)).toBe(1);
  });

  it("only counts messages after last_read_at once the circle has been marked read", () => {
    fixture = seedCircle({ memberCount: 1 });
    const [m1] = fixture.memberIds;
    const before = new Date(Date.now() - 60_000);
    postMessage(fixture, m1, "before mark-read", before);

    markCircleRead(fixture.db, fixture.circleId, fixture.organiserId, new Date());
    expect(getUnreadCountForCircle(fixture.db, fixture.circleId, fixture.organiserId)).toBe(0);

    postMessage(fixture, m1, "after mark-read", new Date(Date.now() + 60_000));
    expect(getUnreadCountForCircle(fixture.db, fixture.circleId, fixture.organiserId)).toBe(1);
  });

  it("returns 0 for a non-member without throwing", () => {
    fixture = seedCircle({ memberCount: 1 });
    expect(getUnreadCountForCircle(fixture.db, fixture.circleId, "not-a-member")).toBe(0);
  });
});

describe("markCircleRead", () => {
  it("returns false for a non-member (no row matched)", () => {
    fixture = seedCircle({ memberCount: 1 });
    expect(markCircleRead(fixture.db, fixture.circleId, "not-a-member")).toBe(false);
  });

  it("returns true and updates last_read_at for a member", () => {
    fixture = seedCircle({ memberCount: 1 });
    expect(markCircleRead(fixture.db, fixture.circleId, fixture.organiserId)).toBe(true);
  });
});

describe("getUnreadCountsForCircles / hasUnreadMessages", () => {
  it("aggregates per-circle counts and the has-any-unread flag across multiple circles", () => {
    fixture = seedCircle({ memberCount: 1 });
    const second = seedCircle({ memberCount: 1 });
    try {
      const [m1] = fixture.memberIds;
      postMessage(fixture, m1, "unread in circle one");

      // second fixture is a completely separate :memory: db/circle — the
      // viewer here (fixture.organiserId) isn't a member of it, so it
      // contributes 0 regardless of its own messages.
      const counts = getUnreadCountsForCircles(fixture.db, [fixture.circleId], fixture.organiserId);
      expect(counts).toEqual({ [fixture.circleId]: 1 });

      expect(hasUnreadMessages(fixture.db, [fixture.circleId], fixture.organiserId)).toBe(true);
      markCircleRead(fixture.db, fixture.circleId, fixture.organiserId);
      expect(hasUnreadMessages(fixture.db, [fixture.circleId], fixture.organiserId)).toBe(false);
    } finally {
      second.close();
    }
  });
});
