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
