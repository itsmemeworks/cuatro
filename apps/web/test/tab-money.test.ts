import { describe, expect, it } from "vitest";
import {
  equalSplitPreview,
  formatMoney,
  formatMoneyWhole,
  formatMoneyWholeSigned,
  parseAmountToMinor,
} from "@/components/tab/money";
import { computeEqualSplit } from "@/server/tab";

describe("formatMoney", () => {
  it("formats minor units as a localised currency string", () => {
    expect(formatMoney(3200, "GBP")).toBe("£32.00");
    expect(formatMoney(150, "GBP")).toBe("£1.50");
    expect(formatMoney(0, "GBP")).toBe("£0.00");
  });
});

describe("formatMoneyWhole — the whole-pounds-when-clean rule (Wave C sweep)", () => {
  it("drops the pence when the amount is clean pounds", () => {
    expect(formatMoneyWhole(800, "GBP")).toBe("£8");
    expect(formatMoneyWhole(3200, "GBP")).toBe("£32");
    expect(formatMoneyWhole(0, "GBP")).toBe("£0");
  });

  it("keeps the pence when the amount actually has them — never renders .00", () => {
    expect(formatMoneyWhole(850, "GBP")).toBe("£8.50");
    expect(formatMoneyWhole(1066, "GBP")).toBe("£10.66");
    expect(formatMoneyWhole(5, "GBP")).toBe("£0.05");
  });

  it("returns the magnitude only (sign belongs to tone or the Signed variant)", () => {
    expect(formatMoneyWhole(-400, "GBP")).toBe("£4");
    expect(formatMoneyWhole(-425, "GBP")).toBe("£4.25");
  });
});

describe("formatMoneyWholeSigned — the ±£ net header", () => {
  it("prefixes + when owed and a U+2212 minus (never a hyphen) when down", () => {
    expect(formatMoneyWholeSigned(800, "GBP")).toBe("+£8");
    expect(formatMoneyWholeSigned(-400, "GBP")).toBe("−£4");
    expect(formatMoneyWholeSigned(-425, "GBP")).toBe("−£4.25");
    expect(formatMoneyWholeSigned(0, "GBP")).toBe("£0");
  });
});

describe("equalSplitPreview — mirrors server/tab.ts computeEqualSplit exactly", () => {
  it("matches the server's floor-per-debtor, payer-absorbs-remainder split for a spread of amounts", () => {
    for (const total of [1, 2, 3, 100, 833, 2550, 3200, 3400, 9999, 100001]) {
      for (const debtors of [1, 2, 3, 4, 7]) {
        const server = computeEqualSplit(total, debtors);
        const preview = equalSplitPreview(total, debtors);
        expect(preview.shareMinor).toBe(server.shareMinor);
        expect(preview.numPeople).toBe(server.numPeople);
        expect(preview.payerExtraMinor).toBe(server.payerShareMinor - server.shareMinor);
        // No penny lost, no debtor above the floor share — the invariant the split rule guarantees.
        expect(server.shareMinor * debtors + server.payerShareMinor).toBe(total);
      }
    }
  });

  it("narrates the design's worked example — £34 across 3 people is £11.33 a head, payer absorbs the 1p", () => {
    const preview = equalSplitPreview(3400, 2);
    expect(preview).toEqual({ shareMinor: 1133, payerExtraMinor: 1, numPeople: 3 });
  });
});

describe("parseAmountToMinor", () => {
  it("parses whole and fractional pounds into minor units", () => {
    expect(parseAmountToMinor("32")).toBe(3200);
    expect(parseAmountToMinor("32.5")).toBe(3250);
    expect(parseAmountToMinor("32.50")).toBe(3250);
    expect(parseAmountToMinor("0.01")).toBe(1);
  });

  it("rejects anything that isn't a plain non-negative amount", () => {
    expect(parseAmountToMinor("")).toBeNull();
    expect(parseAmountToMinor("-5")).toBeNull();
    expect(parseAmountToMinor("abc")).toBeNull();
    expect(parseAmountToMinor("32.555")).toBeNull();
    expect(parseAmountToMinor("£32")).toBeNull();
  });
});
