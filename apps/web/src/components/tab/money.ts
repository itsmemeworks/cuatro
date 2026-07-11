/**
 * Money maths lives entirely in integer minor units + an ISO 4217 currency
 * code (see packages/db/src/schema/tabs.ts's amount_minor + currency rule) —
 * never a float. These two helpers are the only place pounds-and-pence
 * strings exist, at the very edge of the UI (display and form parsing).
 *
 * Documented limitation: both assume a 2-decimal-place currency (true for
 * GBP/EUR/USD, the only ones this v0 UI can produce). A zero-decimal
 * currency like JPY would need a currency-aware exponent lookup — out of
 * scope for the UK-only launch (see DESIGN.md §5).
 */

export function formatMoney(amountMinor: number, currency: string, locale = "en-GB"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amountMinor / 100);
}

/**
 * The web design's money format (design/CUATRO-Web-LATEST.dc.html, mirrors
 * server/shell.ts's formatShellNet): whole pounds carry NO pence ("£8",
 * "£12"), pence show only when the amount actually has them ("£8.50"). The
 * design never renders ".00". Returns the magnitude only (no sign) — pair it
 * with a tone colour, or use formatMoneyWholeSigned for the ±£ net header.
 * The phone `formatMoney` above stays pence-always so the phone Tab and every
 * surface that already uses it are byte-for-byte unchanged.
 */
export function formatMoneyWhole(amountMinor: number, currency: string, locale = "en-GB"): string {
  const whole = amountMinor % 100 === 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amountMinor) / 100);
}

/** As formatMoneyWhole, but with the design's signed prefix — "+£8" when owed, "−£4" when down (U+2212 minus, never a hyphen or em dash). */
export function formatMoneyWholeSigned(amountMinor: number, currency: string, locale = "en-GB"): string {
  const sign = amountMinor > 0 ? "+" : amountMinor < 0 ? "−" : "";
  return `${sign}${formatMoneyWhole(amountMinor, currency, locale)}`;
}

/**
 * Client-safe mirror of server/tab.ts's computeEqualSplit for the wide
 * add-expense dialog's LIVE preview line ("£34 split 3 ways · £11.33 a head,
 * you absorb the 1p"). Same rule, same numbers: every debtor pays the FLOOR
 * of the even split, the payer absorbs whatever pennies don't divide.
 * `payerExtraMinor` is how many pennies the payer absorbs beyond their own
 * floor share (0 when it splits clean). Kept in this pure UI-edge module so
 * the client bundle never imports server/tab.ts (drizzle et al); parity with
 * the server rule is pinned by test/tab-money.test.ts.
 */
export function equalSplitPreview(
  totalAmountMinor: number,
  debtorCount: number,
): { shareMinor: number; payerExtraMinor: number; numPeople: number } {
  const numPeople = debtorCount + 1;
  const shareMinor = Math.floor(totalAmountMinor / numPeople);
  const payerShareMinor = totalAmountMinor - shareMinor * debtorCount;
  return { shareMinor, payerExtraMinor: payerShareMinor - shareMinor, numPeople };
}

/**
 * Parses a user-typed amount like "32" or "32.50" into integer minor units.
 * Returns null for anything that isn't a non-negative number with at most
 * two decimal places (rejects rather than silently rounding away pennies).
 */
export function parseAmountToMinor(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;

  const [wholePart, fractionPart = ""] = trimmed.split(".");
  const paddedFraction = (fractionPart + "00").slice(0, 2);
  return Number(wholePart) * 100 + Number(paddedFraction);
}
