import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { notifications, sessions } from "@cuatro/db";
import { seedCircle, type Fixture } from "./support/games-fixtures";
import {
  addSplitEntry,
  computeCounterpartyBalances,
  computeEqualSplit,
  computeMemberNetPositions,
  computeNetPosition,
  ensureTabForCircle,
  getTabView,
  MAX_TAB_ENTRY_DESCRIPTION_LENGTH,
  nudgeEntry,
  proposeOrConfirmSettle,
  type TabEntryLike,
} from "@/server/tab";
import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";
import { circleChannel, userChannel } from "@/lib/realtime/channels";

let fixture: Fixture | undefined;
afterEach(() => {
  fixture?.close();
  fixture = undefined;
  __setRealtimeSenderForTests(null);
});

describe("computeEqualSplit — penny-remainder rule", () => {
  it("splits evenly with no remainder", () => {
    expect(computeEqualSplit(3000, 2)).toEqual({ shareMinor: 1000, payerShareMinor: 1000, numPeople: 3 });
  });

  it("£32 across a payer + 2 debtors: remainder pennies go to the payer, none lost", () => {
    const result = computeEqualSplit(3200, 2);
    expect(result.shareMinor).toBe(1066);
    expect(result.payerShareMinor).toBe(1068);
    // No lost penny: every debtor's floor share plus the payer's own share
    // reconstructs the original total exactly.
    expect(result.shareMinor * 2 + result.payerShareMinor).toBe(3200);
  });

  it("rejects non-positive or non-integer amounts", () => {
    expect(() => computeEqualSplit(0, 1)).toThrow();
    expect(() => computeEqualSplit(-100, 1)).toThrow();
    expect(() => computeEqualSplit(10.5, 1)).toThrow();
    expect(() => computeEqualSplit(1000, 0)).toThrow();
  });
});

describe("addSplitEntry", () => {
  it("creates one entry per debtor, each the floor share, and reports the payer's own share", () => {
    fixture = seedCircle({ memberCount: 3 });
    const [d1, d2, d3] = fixture.memberIds;
    const result = addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [d1, d2, d3],
      totalAmountMinor: 3200,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    expect(result.entries).toHaveLength(3);
    for (const e of result.entries) {
      expect(e.amountMinor).toBe(800); // 3200p / 4 people divides evenly
      expect(e.currency).toBe("GBP");
      expect(e.status).toBe("open");
    }
    expect(result.payerShareMinor).toBe(800);
    // No lost penny end to end.
    expect(result.entries.reduce((sum, e) => sum + e.amountMinor, 0) + result.payerShareMinor).toBe(3200);
  });

  it("£32 across a payer + 2 debtors persists the documented remainder-to-payer split", () => {
    fixture = seedCircle({ memberCount: 2 });
    const [d1, d2] = fixture.memberIds;
    const result = addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [d1, d2],
      totalAmountMinor: 3200,
    });
    if (!result.ok) throw new Error("unreachable");
    expect(result.entries.map((e) => e.amountMinor)).toEqual([1066, 1066]);
    expect(result.payerShareMinor).toBe(1068);
  });

  it("rejects a payer who is also listed as a debtor", () => {
    fixture = seedCircle({ memberCount: 2 });
    const result = addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [fixture.organiserId],
      totalAmountMinor: 1000,
    });
    expect(result).toEqual({ ok: false, error: "payer_is_debtor" });
  });

  it("rejects duplicate debtors and an empty debtor list", () => {
    fixture = seedCircle({ memberCount: 2 });
    const [d1] = fixture.memberIds;
    expect(
      addSplitEntry(fixture.db, {
        circleId: fixture.circleId,
        payerUserId: fixture.organiserId,
        debtorUserIds: [d1, d1],
        totalAmountMinor: 1000,
      }),
    ).toEqual({ ok: false, error: "duplicate_debtor" });

    expect(
      addSplitEntry(fixture.db, {
        circleId: fixture.circleId,
        payerUserId: fixture.organiserId,
        debtorUserIds: [],
        totalAmountMinor: 1000,
      }),
    ).toEqual({ ok: false, error: "no_debtors" });
  });

  it("rejects a debtor who isn't a member of the circle", () => {
    fixture = seedCircle({ memberCount: 1 });
    const result = addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: ["not-a-member"],
      totalAmountMinor: 1000,
    });
    expect(result).toEqual({ ok: false, error: "not_a_circle_member" });
  });

  it("persists a trimmed, length-capped description on every created entry", () => {
    fixture = seedCircle({ memberCount: 2 });
    const [d1, d2] = fixture.memberIds;
    const overlong = "x".repeat(MAX_TAB_ENTRY_DESCRIPTION_LENGTH + 50);
    const result = addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [d1, d2],
      totalAmountMinor: 1000,
      description: `  ${overlong}  `,
    });
    if (!result.ok) throw new Error("unreachable");
    for (const e of result.entries) {
      expect(e.description).toBe(overlong.slice(0, MAX_TAB_ENTRY_DESCRIPTION_LENGTH));
      expect(e.description!.length).toBe(MAX_TAB_ENTRY_DESCRIPTION_LENGTH);
    }
  });

  it("stores null when no description is given, or when it's blank/whitespace-only", () => {
    fixture = seedCircle({ memberCount: 1 });
    const [d1] = fixture.memberIds;

    const noDescription = addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [d1],
      totalAmountMinor: 1000,
    });
    if (!noDescription.ok) throw new Error("unreachable");
    expect(noDescription.entries[0]!.description).toBeNull();

    const blankDescription = addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [d1],
      totalAmountMinor: 1000,
      description: "   ",
    });
    if (!blankDescription.ok) throw new Error("unreachable");
    expect(blankDescription.entries[0]!.description).toBeNull();
  });

  it("rejects a zero or negative amount", () => {
    fixture = seedCircle({ memberCount: 1 });
    const [d1] = fixture.memberIds;
    expect(
      addSplitEntry(fixture.db, {
        circleId: fixture.circleId,
        payerUserId: fixture.organiserId,
        debtorUserIds: [d1],
        totalAmountMinor: 0,
      }),
    ).toEqual({ ok: false, error: "invalid_amount" });
  });
});

describe("nudgeEntry — fires once per entry, no repeat nags", () => {
  it("nudges an open entry, then rejects a second nudge on the same entry", () => {
    fixture = seedCircle({ memberCount: 1 });
    const [debtor] = fixture.memberIds;
    const created = addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [debtor],
      totalAmountMinor: 1000,
    });
    if (!created.ok) throw new Error("unreachable");
    const entryId = created.entries[0]!.id;

    expect(nudgeEntry(fixture.db, entryId, fixture.organiserId)).toEqual({ ok: true, status: "nudged" });
    expect(nudgeEntry(fixture.db, entryId, fixture.organiserId)).toEqual({ ok: false, error: "already_nudged" });
  });

  it("only the payer can nudge — the debtor can't nudge themselves", () => {
    fixture = seedCircle({ memberCount: 1 });
    const [debtor] = fixture.memberIds;
    const created = addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [debtor],
      totalAmountMinor: 1000,
    });
    if (!created.ok) throw new Error("unreachable");

    expect(nudgeEntry(fixture.db, created.entries[0]!.id, debtor)).toEqual({ ok: false, error: "not_the_payer" });
  });

  it("rejects nudging an already-settled entry", () => {
    fixture = seedCircle({ memberCount: 1 });
    const [debtor] = fixture.memberIds;
    const created = addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [debtor],
      totalAmountMinor: 1000,
    });
    if (!created.ok) throw new Error("unreachable");
    const entryId = created.entries[0]!.id;

    proposeOrConfirmSettle(fixture.db, entryId, debtor);
    proposeOrConfirmSettle(fixture.db, entryId, fixture.organiserId);

    expect(nudgeEntry(fixture.db, entryId, fixture.organiserId)).toEqual({ ok: false, error: "already_settled" });
  });
});

describe("proposeOrConfirmSettle — two-step counterparty confirmation", () => {
  it("first mark is pending; the counterparty's mark finalises it", () => {
    fixture = seedCircle({ memberCount: 1 });
    const [debtor] = fixture.memberIds;
    const created = addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [debtor],
      totalAmountMinor: 1000,
    });
    if (!created.ok) throw new Error("unreachable");
    const entryId = created.entries[0]!.id;

    expect(proposeOrConfirmSettle(fixture.db, entryId, debtor)).toEqual({
      ok: true,
      status: "pending",
      proposedBy: debtor,
    });

    // Re-marking by the same person is a no-op, not a self-confirmation.
    expect(proposeOrConfirmSettle(fixture.db, entryId, debtor)).toEqual({
      ok: true,
      status: "pending",
      proposedBy: debtor,
    });

    expect(proposeOrConfirmSettle(fixture.db, entryId, fixture.organiserId)).toEqual({
      ok: true,
      status: "settled",
      confirmedBy: fixture.organiserId,
      alreadyFinal: false,
    });

    // Idempotent once final.
    expect(proposeOrConfirmSettle(fixture.db, entryId, debtor)).toEqual({
      ok: true,
      status: "settled",
      confirmedBy: fixture.organiserId,
      alreadyFinal: true,
    });
  });

  it("works starting from the payer's side too", () => {
    fixture = seedCircle({ memberCount: 1 });
    const [debtor] = fixture.memberIds;
    const created = addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [debtor],
      totalAmountMinor: 1000,
    });
    if (!created.ok) throw new Error("unreachable");
    const entryId = created.entries[0]!.id;

    expect(proposeOrConfirmSettle(fixture.db, entryId, fixture.organiserId).ok).toBe(true);
    expect(proposeOrConfirmSettle(fixture.db, entryId, debtor)).toEqual({
      ok: true,
      status: "settled",
      confirmedBy: debtor,
      alreadyFinal: false,
    });
  });

  it("rejects a non-party", () => {
    fixture = seedCircle({ memberCount: 2 });
    const [debtor, outsider] = fixture.memberIds;
    const created = addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [debtor],
      totalAmountMinor: 1000,
    });
    if (!created.ok) throw new Error("unreachable");

    expect(proposeOrConfirmSettle(fixture.db, created.entries[0]!.id, outsider)).toEqual({
      ok: false,
      error: "not_a_party",
    });
  });

  it("rejects an unknown entry", () => {
    fixture = seedCircle({ memberCount: 1 });
    expect(proposeOrConfirmSettle(fixture.db, "no-such-entry", fixture.organiserId)).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("net balance computation", () => {
  it("nets multiple entries between the same two people, across directions", () => {
    const entries: TabEntryLike[] = [
      { payerUserId: "A", debtorUserId: "B", amountMinor: 1000, currency: "GBP", status: "open" },
      { payerUserId: "B", debtorUserId: "A", amountMinor: 400, currency: "GBP", status: "open" },
    ];
    expect(computeCounterpartyBalances(entries, "A")).toEqual([
      { counterpartyUserId: "B", currency: "GBP", netMinor: 600 },
    ]);
    expect(computeNetPosition(entries, "A")).toEqual({ GBP: 600 });
  });

  it("a fully netted pair (equal and opposite) drops out entirely — 'all square'", () => {
    const entries: TabEntryLike[] = [
      { payerUserId: "A", debtorUserId: "B", amountMinor: 500, currency: "GBP", status: "open" },
      { payerUserId: "B", debtorUserId: "A", amountMinor: 500, currency: "GBP", status: "open" },
    ];
    expect(computeCounterpartyBalances(entries, "A")).toEqual([]);
    expect(computeNetPosition(entries, "A")).toEqual({});
  });

  it("ignores settled entries", () => {
    const entries: TabEntryLike[] = [
      { payerUserId: "A", debtorUserId: "B", amountMinor: 500, currency: "GBP", status: "settled" },
    ];
    expect(computeCounterpartyBalances(entries, "A")).toEqual([]);
  });

  it("computes every member's overall net position across a three-way circle", () => {
    const entries: TabEntryLike[] = [
      { payerUserId: "A", debtorUserId: "B", amountMinor: 1000, currency: "GBP", status: "open" },
      { payerUserId: "A", debtorUserId: "C", amountMinor: 500, currency: "GBP", status: "open" },
    ];
    const positions = computeMemberNetPositions(entries);
    expect(positions).toHaveLength(3);
    expect(positions).toEqual(
      expect.arrayContaining([
        { userId: "A", currency: "GBP", netMinor: 1500 },
        { userId: "B", currency: "GBP", netMinor: -1000 },
        { userId: "C", currency: "GBP", netMinor: -500 },
      ]),
    );
  });
});

describe("currency isolation", () => {
  it("never nets a GBP debt against a EUR debt between the same two people", () => {
    const entries: TabEntryLike[] = [
      { payerUserId: "A", debtorUserId: "B", amountMinor: 1000, currency: "GBP", status: "open" },
      { payerUserId: "B", debtorUserId: "A", amountMinor: 1000, currency: "EUR", status: "open" },
    ];
    const balances = computeCounterpartyBalances(entries, "A");
    expect(balances).toHaveLength(2);
    expect(balances).toEqual(
      expect.arrayContaining([
        { counterpartyUserId: "B", currency: "GBP", netMinor: 1000 },
        { counterpartyUserId: "B", currency: "EUR", netMinor: -1000 },
      ]),
    );
    expect(computeNetPosition(entries, "A")).toEqual({ GBP: 1000, EUR: -1000 });
  });
});

describe("ensureTabForCircle / getTabView", () => {
  it("is idempotent — lazily creates exactly one tab per circle", () => {
    fixture = seedCircle({ memberCount: 1 });
    const first = ensureTabForCircle(fixture.db, fixture.circleId);
    const second = ensureTabForCircle(fixture.db, fixture.circleId);
    expect(second.id).toBe(first.id);
  });

  it("returns null for a non-member viewer", () => {
    fixture = seedCircle({ memberCount: 1 });
    expect(getTabView(fixture.db, fixture.circleId, "not-a-member")).toBeNull();
  });

  it("reflects entries in the viewer's balances and net position; settled entries drop out of the net but stay in activity", () => {
    fixture = seedCircle({ memberCount: 1 });
    const [debtor] = fixture.memberIds;
    const created = addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [debtor],
      totalAmountMinor: 1000,
    });
    if (!created.ok) throw new Error("unreachable");
    const entryId = created.entries[0]!.id;

    // £10.00 split payer + 1 debtor = 2 people -> 500p each.
    const before = getTabView(fixture.db, fixture.circleId, fixture.organiserId)!;
    expect(before.netPositionByCurrency).toEqual({ GBP: 500 });
    expect(before.balances).toEqual([{ counterpartyUserId: debtor, currency: "GBP", netMinor: 500 }]);
    expect(before.activity).toHaveLength(1);

    proposeOrConfirmSettle(fixture.db, entryId, debtor);
    proposeOrConfirmSettle(fixture.db, entryId, fixture.organiserId);

    const after = getTabView(fixture.db, fixture.circleId, fixture.organiserId)!;
    expect(after.netPositionByCurrency).toEqual({});
    expect(after.balances).toEqual([]);
    expect(after.activity).toHaveLength(1);
    expect(after.activity[0]!.status).toBe("settled");
  });
});

describe("TabEntryView.descriptionLabel — description with a session-date fallback", () => {
  it("uses the entry's own description when set, even for a session-linked entry", () => {
    fixture = seedCircle({ memberCount: 1 });
    const [debtor] = fixture.memberIds;
    const session = fixture.db.insert(sessions).values({ circleId: fixture.circleId, startsAt: new Date(), status: "played" }).returning().get();

    addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [debtor],
      totalAmountMinor: 1000,
      sessionId: session.id,
      description: "court + new balls",
    });

    const view = getTabView(fixture.db, fixture.circleId, fixture.organiserId)!;
    expect(view.activity[0]!.description).toBe("court + new balls");
    expect(view.activity[0]!.descriptionLabel).toBe("court + new balls");
  });

  it("falls back to a weekday-derived label for a session-linked entry with no description", () => {
    fixture = seedCircle({ memberCount: 1 });
    const [debtor] = fixture.memberIds;
    const session = fixture.db.insert(sessions).values({ circleId: fixture.circleId, startsAt: new Date(), status: "played" }).returning().get();

    addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [debtor],
      totalAmountMinor: 1000,
      sessionId: session.id,
    });

    const view = getTabView(fixture.db, fixture.circleId, fixture.organiserId)!;
    const entry = view.activity[0]!;
    expect(entry.description).toBeNull();
    const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(entry.createdAt);
    expect(entry.descriptionLabel).toBe(`${weekday}'s court split`);
  });

  it("is null for a manually-added entry with no session and no description", () => {
    fixture = seedCircle({ memberCount: 1 });
    const [debtor] = fixture.memberIds;

    addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [debtor],
      totalAmountMinor: 1000,
    });

    const view = getTabView(fixture.db, fixture.circleId, fixture.organiserId)!;
    expect(view.activity[0]!.description).toBeNull();
    expect(view.activity[0]!.descriptionLabel).toBeNull();
  });
});

describe("nudgeEntry — routed through server/notify.ts's typed tab_nudge", () => {
  it("writes a tab_nudge notification carrying circleId (not a bare raw insert missing it)", () => {
    fixture = seedCircle({ memberCount: 1 });
    const [debtor] = fixture.memberIds;
    const created = addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [debtor],
      totalAmountMinor: 1000,
    });
    if (!created.ok) throw new Error("unreachable");
    const entryId = created.entries[0]!.id;

    nudgeEntry(fixture.db, entryId, fixture.organiserId);

    const [notif] = fixture.db.select().from(notifications).where(eq(notifications.type, "tab_nudge")).all();
    expect(notif.userId).toBe(debtor);
    expect(notif.payload).toMatchObject({
      circleId: fixture.circleId,
      tabEntryId: entryId,
      amountMinor: 500, // £10.00 split across payer + 1 debtor = 500p each
      currency: "GBP",
    });
  });
});

describe("realtime — tab events", () => {
  function capture() {
    const calls: { topic: string; type: string; fields: Record<string, unknown> }[] = [];
    __setRealtimeSenderForTests(async (topic, type, fields) => {
      calls.push({ topic, type, fields });
    });
    return calls;
  }

  it("addSplitEntry broadcasts 'tab' to the circle and each debtor", () => {
    fixture = seedCircle({ memberCount: 2 });
    const [d1, d2] = fixture.memberIds;
    const calls = capture();

    const result = addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [d1, d2],
      totalAmountMinor: 1000,
    });
    if (!result.ok) throw new Error("unreachable");

    const tabCalls = calls.filter((c) => c.type === "tab");
    // One circle-channel broadcast + one user-channel broadcast per debtor.
    expect(tabCalls.filter((c) => c.topic === circleChannel(fixture!.circleId))).toHaveLength(2);
    expect(tabCalls.map((c) => c.topic).sort()).toEqual(
      [circleChannel(fixture.circleId), circleChannel(fixture.circleId), userChannel(d1), userChannel(d2)].sort(),
    );
  });

  it("nudgeEntry broadcasts 'tab' to the circle and the debtor", () => {
    fixture = seedCircle({ memberCount: 1 });
    const [debtor] = fixture.memberIds;
    const created = addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [debtor],
      totalAmountMinor: 1000,
    });
    if (!created.ok) throw new Error("unreachable");
    const entryId = created.entries[0]!.id;

    const calls = capture();
    const outcome = nudgeEntry(fixture.db, entryId, fixture.organiserId);
    expect(outcome).toEqual({ ok: true, status: "nudged" });

    const tabCalls = calls.filter((c) => c.type === "tab");
    expect(tabCalls.map((c) => c.topic).sort()).toEqual([circleChannel(fixture.circleId), userChannel(debtor)].sort());
  });

  it("does not broadcast when nudgeEntry is rejected (already nudged)", () => {
    fixture = seedCircle({ memberCount: 1 });
    const [debtor] = fixture.memberIds;
    const created = addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [debtor],
      totalAmountMinor: 1000,
    });
    if (!created.ok) throw new Error("unreachable");
    const entryId = created.entries[0]!.id;
    nudgeEntry(fixture.db, entryId, fixture.organiserId);

    const calls = capture();
    const outcome = nudgeEntry(fixture.db, entryId, fixture.organiserId);
    expect(outcome).toEqual({ ok: false, error: "already_nudged" });
    expect(calls).toHaveLength(0);
  });

  it("proposeOrConfirmSettle broadcasts 'tab' only on the finalising call, not the proposing one", () => {
    fixture = seedCircle({ memberCount: 1 });
    const [debtor] = fixture.memberIds;
    const created = addSplitEntry(fixture.db, {
      circleId: fixture.circleId,
      payerUserId: fixture.organiserId,
      debtorUserIds: [debtor],
      totalAmountMinor: 1000,
    });
    if (!created.ok) throw new Error("unreachable");
    const entryId = created.entries[0]!.id;

    const proposeCalls = capture();
    proposeOrConfirmSettle(fixture.db, entryId, debtor);
    expect(proposeCalls.filter((c) => c.type === "tab")).toHaveLength(0);

    const confirmCalls = capture();
    const outcome = proposeOrConfirmSettle(fixture.db, entryId, fixture.organiserId);
    expect(outcome).toMatchObject({ ok: true, status: "settled", alreadyFinal: false });

    const tabCalls = confirmCalls.filter((c) => c.type === "tab");
    expect(tabCalls.map((c) => c.topic).sort()).toEqual(
      [circleChannel(fixture.circleId), userChannel(debtor), userChannel(fixture.organiserId)].sort(),
    );
  });
});
