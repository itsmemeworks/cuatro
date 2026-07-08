import { describe, expect, it } from "vitest";
import { formatMoney, parseAmountToMinor } from "@/components/tab/money";

describe("formatMoney", () => {
  it("formats minor units as a localised currency string", () => {
    expect(formatMoney(3200, "GBP")).toBe("£32.00");
    expect(formatMoney(150, "GBP")).toBe("£1.50");
    expect(formatMoney(0, "GBP")).toBe("£0.00");
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
