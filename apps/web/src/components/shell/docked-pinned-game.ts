import { bookingPlatform, type BookingSignpost } from "@/lib/booking";

/*
 * Pure model + parsing for the docked chat's pinned-game card (issue #29;
 * design/CUATRO-Web-LATEST.dc.html docked chat rail). The card renders the
 * circle's pinned game — the first upcoming session, exactly what
 * PinnedGameBar shows on the circle pages — fetched client-side from
 * GET /api/circles/[id]/pinned-game (that route wraps the same
 * listUpcomingSessionsForCircle read the circle pages use; no new query).
 *
 * Kept as a plain .ts module so the response guard + status line are unit
 * testable in the node suite (test/docked-pinned-game.test.ts) without
 * pulling the dock's React/realtime imports.
 */

export interface DockPinnedGame {
  sessionId: string;
  /** kickoff, UTC epoch-ms */
  startsAt: number;
  /** effective timezone (venue's, else the circle's) for the "Tue 8pm" label */
  timezone: string;
  venueName: string | null;
  slots: number;
  confirmedCount: number;
  /** the game's "Booked on" signpost when its money opt-in resolves to a booking; null = silence */
  booking: BookingSignpost | null;
}

/**
 * The card's mono fill line — PinnedGameBar's statusLabel phrasing, kept in
 * step: "4 of 4, game on" when full, "3 of 4 in · 1 spot left" otherwise.
 */
export function pinnedStatusLine(slots: number, confirmedCount: number): string {
  const openSpots = Math.max(0, slots - confirmedCount);
  if (openSpots === 0) return `${slots} of ${slots}, game on`;
  return `${confirmedCount} of ${slots} in · ${openSpots} spot${openSpots === 1 ? "" : "s"} left`;
}

/**
 * Defensive parse of the pinned-game response: anything malformed (error
 * bodies, shape drift, an unknown booking platform) degrades to null — the
 * dock simply shows no card, never a broken one.
 */
export function parsePinnedGameResponse(json: unknown): DockPinnedGame | null {
  if (typeof json !== "object" || json === null) return null;
  const body = json as { ok?: unknown; game?: unknown };
  if (body.ok !== true || typeof body.game !== "object" || body.game === null) return null;
  const g = body.game as Record<string, unknown>;
  if (
    typeof g.sessionId !== "string" ||
    typeof g.startsAt !== "number" ||
    typeof g.timezone !== "string" ||
    typeof g.slots !== "number" ||
    typeof g.confirmedCount !== "number"
  ) {
    return null;
  }

  let booking: BookingSignpost | null = null;
  if (typeof g.booking === "object" && g.booking !== null) {
    const b = g.booking as Record<string, unknown>;
    const platform = bookingPlatform(typeof b.platform === "string" ? b.platform : null);
    if (platform) booking = { platform: platform.id, url: typeof b.url === "string" ? b.url : null };
  }

  return {
    sessionId: g.sessionId,
    startsAt: g.startsAt,
    timezone: g.timezone,
    venueName: typeof g.venueName === "string" ? g.venueName : null,
    slots: g.slots,
    confirmedCount: g.confirmedCount,
    booking,
  };
}
