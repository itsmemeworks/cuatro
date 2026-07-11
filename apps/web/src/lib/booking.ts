/**
 * "Booked on" signpost vocabulary (GitHub issue #21, 2026-07-11 product
 * decision). CUATRO never touches booking or payment; a game may carry ONE
 * opt-in: a booking signpost (these games never touch the Tab) XOR a court
 * cost (the existing Tab split). Default is silence — no money chrome at all.
 *
 * This file is the single source of the platform list (world-ready: data,
 * not UK assumptions) and the pure resolution rule. Schema columns live in
 * packages/db (standing_games/sessions booking_platform + booking_url);
 * write-side XOR enforcement lives in server/standing-games-service.ts.
 * Lead-seeded for Wave C — shared across territories, edit via the lead.
 */

export const BOOKING_PLATFORMS = [
  { id: "playtomic", label: "Playtomic", tile: "PT" },
  { id: "padel_mates", label: "Padel Mates", tile: "PM" },
  { id: "matchi", label: "MATCHi", tile: "MA" },
  { id: "padium", label: "Padium", tile: "PD" },
  { id: "club_website", label: "Club site", tile: "CS" },
  { id: "other", label: "Other", tile: "··" },
] as const;

export type BookingPlatformId = (typeof BOOKING_PLATFORMS)[number]["id"];

export const BOOKING_PLATFORM_IDS = BOOKING_PLATFORMS.map((p) => p.id) as BookingPlatformId[];

export function bookingPlatform(id: string | null | undefined) {
  return BOOKING_PLATFORMS.find((p) => p.id === id) ?? null;
}

export type BookingSignpost = {
  platform: BookingPlatformId;
  url: string | null;
};

/** What a session resolves to after inheritance: at most ONE of these, never both. */
export type MoneyOptIn =
  | { kind: "booking"; booking: BookingSignpost }
  | { kind: "cost"; amountMinor: number; currency: string }
  | null;

/**
 * The inheritance + mutual-exclusivity rule, in one pure place:
 * session-level booking override > standing-game booking > standing-game
 * court cost. A resolved booking always silences the cost (a booked-on game
 * never touches the Tab); no opt-in anywhere means silence.
 */
export function resolveMoneyOptIn(input: {
  session?: { bookingPlatform: string | null; bookingUrl: string | null } | null;
  standingGame?: {
    bookingPlatform: string | null;
    bookingUrl: string | null;
    costMinor: number | null;
    costCurrency: string;
  } | null;
}): MoneyOptIn {
  const sessionPlatform = bookingPlatform(input.session?.bookingPlatform);
  if (sessionPlatform) {
    return {
      kind: "booking",
      booking: { platform: sessionPlatform.id, url: input.session?.bookingUrl ?? null },
    };
  }
  const gamePlatform = bookingPlatform(input.standingGame?.bookingPlatform);
  if (gamePlatform) {
    return {
      kind: "booking",
      booking: { platform: gamePlatform.id, url: input.standingGame?.bookingUrl ?? null },
    };
  }
  const costMinor = input.standingGame?.costMinor ?? null;
  if (costMinor != null && costMinor > 0) {
    return { kind: "cost", amountMinor: costMinor, currency: input.standingGame?.costCurrency ?? "GBP" };
  }
  return null;
}
