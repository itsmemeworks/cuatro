import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  circleMessages,
  circles,
  notifications,
  rsvps,
  sessions,
  standingGames,
  tabEntries,
  tabs,
  users,
} from "@cuatro/db";
import { seedCircle, type Fixture } from "./support/games-fixtures";
import { buildShellData } from "@/server/shell";
import { formatMoney } from "@/components/tab/money";
import { circleColorFor } from "@/lib/design";

let fixture: Fixture | undefined;
afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

// A Tuesday 20:00 Europe/London (19:00 UTC in BST) — used where a test asserts
// the status-line's "when" shape.
const TUESDAY_8PM = Date.UTC(2026, 6, 14, 19, 0, 0);
const BEFORE = new Date(TUESDAY_8PM - 60 * 60 * 1000);

async function insertSession(
  fx: Fixture,
  opts: { startsAt?: number; standingGameId?: string | null; rotationLockedAt?: number | null } = {},
) {
  const [session] = await fx.db
    .insert(sessions)
    .values({
      circleId: fx.circleId,
      venueId: fx.venueId,
      standingGameId: opts.standingGameId ?? null,
      startsAt: opts.startsAt ?? TUESDAY_8PM,
      rotationLockedAt: opts.rotationLockedAt ?? null,
    })
    .returning();
  return session;
}

function addRsvp(fx: Fixture, sessionId: string, userId: string, status: "in" | "out" | "reserve" | "available") {
  return fx.db.insert(rsvps).values({ sessionId, userId, status });
}

describe("buildShellData — identity fact line", () => {
  it("shows Placement Trio progress while the user is unrated (rating NULL)", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    await fixture.db.update(users).set({ rating: null, verifiedMatchCount: 1 }).where(eq(users.id, fixture.organiserId));

    const data = await buildShellData(fixture.db, fixture.organiserId);
    expect(data.identity.factLine).toBe("Placement Trio · 1 of 3");
  });

  it("caps the placement count at 3", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    await fixture.db.update(users).set({ rating: null, verifiedMatchCount: 5 }).where(eq(users.id, fixture.organiserId));

    const data = await buildShellData(fixture.db, fixture.organiserId);
    expect(data.identity.factLine).toBe("Placement Trio · 3 of 3");
  });

  it("shows the Glass number + confidence once revealed (rating set)", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    await fixture.db
      .update(users)
      .set({ rating: 4.62, confidence: 0.78, verifiedMatchCount: 3, displayName: "Ben" })
      .where(eq(users.id, fixture.organiserId));

    const data = await buildShellData(fixture.db, fixture.organiserId);
    expect(data.identity.factLine).toBe("Glass 4.62 · conf 78%");
    expect(data.identity.displayName).toBe("Ben");
  });
});

describe("buildShellData — circle flags", () => {
  it("derives two-letter initials, passes emblem through, falls back to a deterministic colour", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    // seedCircle names the circle "Test Circle" and sets no emblem/colour.
    const data = await buildShellData(fixture.db, fixture.organiserId);
    expect(data.circles).toHaveLength(1);
    expect(data.circles[0].initials).toBe("TE");
    expect(data.circles[0].emblem).toBeNull();
    expect(data.circles[0].color).toBe(circleColorFor(fixture.circleId));
  });

  it("uses the circle's chosen colour + emblem when set", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    await fixture.db.update(circles).set({ colour: "#123456", emblem: "🎾" }).where(eq(circles.id, fixture.circleId));

    const data = await buildShellData(fixture.db, fixture.organiserId);
    expect(data.circles[0].color).toBe("#123456");
    expect(data.circles[0].emblem).toBe("🎾");
  });
});

describe("buildShellData — status line + needs attention", () => {
  it("formats the next session as '<when> · N spots open' and flags an un-answered viewer", async () => {
    fixture = await seedCircle({ memberCount: 4 });
    const [m0, m1, , m3] = fixture.memberIds;
    const session = await insertSession(fixture);
    // 3 of 4 slots taken → 1 open. The viewer (m3) has no row.
    await addRsvp(fixture, session.id, fixture.organiserId, "in");
    await addRsvp(fixture, session.id, m0, "in");
    await addRsvp(fixture, session.id, m1, "in");

    const data = await buildShellData(fixture.db, m3, BEFORE);
    const circle = data.circles[0];
    expect(circle.statusLine).toMatch(/^[A-Z][a-z]{2} \d{1,2}(:\d{2})?[ap]m · 1 spot open$/);
    // Formats in the venue/circle timezone (Europe/London) — 19:00 UTC is 8pm BST.
    expect(circle.statusLine).toBe("Tue 8pm · 1 spot open");
    expect(circle.needsAttention).toBe(true);
  });

  it("reads 'full ✓' and needs no attention when every slot is taken", async () => {
    fixture = await seedCircle({ memberCount: 4 });
    const [m0, m1, m2, m3] = fixture.memberIds;
    const session = await insertSession(fixture);
    await addRsvp(fixture, session.id, m0, "in");
    await addRsvp(fixture, session.id, m1, "in");
    await addRsvp(fixture, session.id, m2, "in");
    await addRsvp(fixture, session.id, fixture.organiserId, "in");

    const data = await buildShellData(fixture.db, m3, BEFORE);
    expect(data.circles[0].statusLine).toBe("Tue 8pm · full ✓");
    expect(data.circles[0].needsAttention).toBe(false);
  });

  it("does not flag attention for a viewer who already replied (even 'out')", async () => {
    fixture = await seedCircle({ memberCount: 2 });
    const [m0] = fixture.memberIds;
    const session = await insertSession(fixture);
    await addRsvp(fixture, session.id, m0, "in");
    await addRsvp(fixture, session.id, fixture.organiserId, "out");

    const data = await buildShellData(fixture.db, fixture.organiserId, BEFORE);
    expect(data.circles[0].needsAttention).toBe(false); // spot open, but they answered "out"
  });

  it("shows the lock time (not a fill count) for a rotation game still pre-lock", async () => {
    fixture = await seedCircle({ memberCount: 4 });
    const [m0, m1, , m3] = fixture.memberIds;
    const [sg] = await fixture.db
      .insert(standingGames)
      .values({
        circleId: fixture.circleId,
        venueId: fixture.venueId,
        weekday: 2,
        startTime: "20:00",
        slots: 4,
        rotationEnabled: true,
        rotationMode: "limited",
        rotationCutoffHours: 24, // locks 24h before kickoff → Mon 8pm
      })
      .returning();
    const session = await insertSession(fixture, { standingGameId: sg.id, rotationLockedAt: null });
    // Availability is declared, but the rotation never quotes a fill count.
    await addRsvp(fixture, session.id, m0, "available");
    await addRsvp(fixture, session.id, m1, "available");

    const data = await buildShellData(fixture.db, m3, BEFORE);
    expect(data.circles[0].statusLine).toBe("Tue 8pm · locks Mon 8pm");
    expect(data.circles[0].needsAttention).toBe(true); // m3 hasn't declared availability
  });

  it("does not flag attention for a rotation viewer who already declared availability", async () => {
    fixture = await seedCircle({ memberCount: 2 });
    const [m0] = fixture.memberIds;
    const [sg] = await fixture.db
      .insert(standingGames)
      .values({
        circleId: fixture.circleId,
        venueId: fixture.venueId,
        weekday: 2,
        startTime: "20:00",
        rotationEnabled: true,
        rotationMode: "limited",
      })
      .returning();
    const session = await insertSession(fixture, { standingGameId: sg.id, rotationLockedAt: null });
    await addRsvp(fixture, session.id, m0, "available");

    const data = await buildShellData(fixture.db, m0, BEFORE);
    expect(data.circles[0].needsAttention).toBe(false);
  });

  it("reads 'locked ✓' once a rotation game has locked", async () => {
    fixture = await seedCircle({ memberCount: 2 });
    const [sg] = await fixture.db
      .insert(standingGames)
      .values({ circleId: fixture.circleId, venueId: fixture.venueId, weekday: 2, startTime: "20:00", rotationEnabled: true })
      .returning();
    const session = await insertSession(fixture, { standingGameId: sg.id, rotationLockedAt: TUESDAY_8PM - 24 * 60 * 60 * 1000 });

    const data = await buildShellData(fixture.db, fixture.organiserId, BEFORE);
    expect(data.circles[0].statusLine).toBe("Tue 8pm · locked ✓");
    expect(data.circles[0].needsAttention).toBe(false);
  });

  it("shows just the kickoff time for an unlimited rotation game (never locks)", async () => {
    fixture = await seedCircle({ memberCount: 2 });
    const [sg] = await fixture.db
      .insert(standingGames)
      .values({
        circleId: fixture.circleId,
        venueId: fixture.venueId,
        weekday: 2,
        startTime: "20:00",
        rotationEnabled: true,
        rotationMode: "unlimited",
      })
      .returning();
    const session = await insertSession(fixture, { standingGameId: sg.id, rotationLockedAt: null });

    const data = await buildShellData(fixture.db, fixture.organiserId, BEFORE);
    expect(data.circles[0].statusLine).toBe("Tue 8pm");
  });

  it("returns a null status line when nothing is scheduled", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    const data = await buildShellData(fixture.db, fixture.organiserId);
    expect(data.circles[0].statusLine).toBeNull();
    expect(data.circles[0].needsAttention).toBe(false);
  });

  it("ignores sessions already in the past", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    await insertSession(fixture, { startsAt: TUESDAY_8PM });
    const data = await buildShellData(fixture.db, fixture.organiserId, new Date(TUESDAY_8PM + 60 * 60 * 1000));
    expect(data.circles[0].statusLine).toBeNull();
  });
});

describe("buildShellData — unread chat dot", () => {
  it("flags a circle with another member's unread message, ignoring the viewer's own", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const [m0] = fixture.memberIds;
    await fixture.db.insert(circleMessages).values({ circleId: fixture.circleId, userId: fixture.organiserId, body: "mine" });
    let data = await buildShellData(fixture.db, fixture.organiserId);
    expect(data.circles[0].hasUnreadChat).toBe(false); // only my own message

    await fixture.db.insert(circleMessages).values({ circleId: fixture.circleId, userId: m0, body: "theirs" });
    data = await buildShellData(fixture.db, fixture.organiserId);
    expect(data.circles[0].hasUnreadChat).toBe(true);
  });
});

describe("buildShellData — Tab net line", () => {
  async function seedTabEntry(
    fx: Fixture,
    opts: { payer: string; debtor: string; amountMinor: number; currency?: string },
  ) {
    const [tab] = await fx.db
      .insert(tabs)
      .values({ circleId: fx.circleId })
      .onConflictDoNothing()
      .returning();
    const tabId = tab?.id ?? (await fx.db.select().from(tabs).where(eq(tabs.circleId, fx.circleId)))[0].id;
    await fx.db.insert(tabEntries).values({
      tabId,
      payerUserId: opts.payer,
      debtorUserId: opts.debtor,
      amountMinor: opts.amountMinor,
      currency: opts.currency ?? "GBP",
    });
  }

  it("shows a negative, owing line when the viewer owes", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const [m0] = fixture.memberIds;
    await seedTabEntry(fixture, { payer: m0, debtor: fixture.organiserId, amountMinor: 400 });

    const data = await buildShellData(fixture.db, fixture.organiserId);
    expect(data.tabNetLine).toBe(formatMoney(-400, "GBP"));
    expect(data.tabNetOwing).toBe(true);
  });

  it("shows a positive, non-owing line when the viewer is owed", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const [m0] = fixture.memberIds;
    await seedTabEntry(fixture, { payer: fixture.organiserId, debtor: m0, amountMinor: 800 });

    const data = await buildShellData(fixture.db, fixture.organiserId);
    expect(data.tabNetLine).toBe(`+${formatMoney(800, "GBP")}`);
    expect(data.tabNetOwing).toBe(false);
  });

  it("is null when balances net to zero", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const [m0] = fixture.memberIds;
    await seedTabEntry(fixture, { payer: m0, debtor: fixture.organiserId, amountMinor: 400 });
    await seedTabEntry(fixture, { payer: fixture.organiserId, debtor: m0, amountMinor: 400 });

    const data = await buildShellData(fixture.db, fixture.organiserId);
    expect(data.tabNetLine).toBeNull();
    expect(data.tabNetOwing).toBe(false);
  });

  it("prefers GBP over another currency with a larger magnitude", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const [m0] = fixture.memberIds;
    await seedTabEntry(fixture, { payer: fixture.organiserId, debtor: m0, amountMinor: 300, currency: "GBP" });
    await seedTabEntry(fixture, { payer: m0, debtor: fixture.organiserId, amountMinor: 5000, currency: "EUR" });

    const data = await buildShellData(fixture.db, fixture.organiserId);
    expect(data.tabNetLine).toBe(`+${formatMoney(300, "GBP")}`); // GBP wins despite the bigger EUR debt
    expect(data.tabNetOwing).toBe(false);
  });

  it("is null when there are no entries", async () => {
    fixture = await seedCircle({ memberCount: 1 });
    const data = await buildShellData(fixture.db, fixture.organiserId);
    expect(data.tabNetLine).toBeNull();
  });
});

describe("buildShellData — notifications + no-circle viewer", () => {
  it("counts unread notifications only", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    await fixture.db.insert(notifications).values({ userId: fixture.organiserId, type: "x", payload: {} });
    await fixture.db.insert(notifications).values({ userId: fixture.organiserId, type: "x", payload: {} });
    await fixture.db.insert(notifications).values({ userId: fixture.organiserId, type: "x", payload: {}, readAt: Date.now() });

    const data = await buildShellData(fixture.db, fixture.organiserId);
    expect(data.unreadNotifications).toBe(2);
  });

  it("returns empty circles + a null Tab for a user with no memberships", async () => {
    fixture = await seedCircle({ memberCount: 0 });
    const [loner] = await fixture.db.insert(users).values({ email: "loner@example.com", displayName: "Lone Wolf" }).returning();
    await fixture.db.insert(notifications).values({ userId: loner.id, type: "x", payload: {} });

    const data = await buildShellData(fixture.db, loner.id);
    expect(data.circles).toEqual([]);
    expect(data.tabNetLine).toBeNull();
    expect(data.tabNetOwing).toBe(false);
    expect(data.unreadNotifications).toBe(1);
    expect(data.identity.displayName).toBe("Lone Wolf");
  });
});
