import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { circleMembers, circles, rsvps, sessions, type CuatroDb } from "@cuatro/db";

/**
 * Post-conversion landing for a guest who just became a member (QA8: the old
 * flow dumped a freshly-converted guest on a generic surface with zero
 * acknowledgement of the Circle they'd just joined — "wait, did that just
 * undo my join?").
 *
 * Only GENERIC destinations are upgraded; anything specific (a /games/[id]
 * deep link, /circles/[id], a notification target) is the caller's intent and
 * passes through untouched:
 *  - `/join/[code]` — the circle-join convert CTA bounces back to the invite
 *    page; a now-member should land IN that Circle instead.
 *  - `/home` — the legacy Fourth Call convert target; land on their Circle,
 *    else the game they claimed.
 */
export function isGenericConversionDestination(destination: string): boolean {
  return destination === "/home" || destination.startsWith("/join/");
}

/**
 * Where a just-converted guest should land, resolved AFTER convertGuestOnAuth
 * has run (memberships live on `userId` — the resolved account — whether the
 * guest row was flipped in place or merged onto a pre-existing account).
 *
 * Resolution order:
 *  1. `/join/[code]` destination and they're a member of THAT Circle → it.
 *  2. Their most recently joined Circle (the one the convert CTA sat in).
 *  3. No Circle at all (a pure Fourth Call guest): their next upcoming
 *     committed game.
 *  4. Nothing to anchor to → null, caller keeps the original destination.
 */
export async function resolveConvertedGuestLanding(
  db: CuatroDb,
  userId: string,
  destination: string,
  now: Date = new Date(),
): Promise<string | null> {
  const joinCode = destination.startsWith("/join/") ? (destination.split("/")[2]?.split("?")[0] ?? null) : null;
  if (joinCode) {
    const [invited] = await db
      .select({ circleId: circleMembers.circleId })
      .from(circleMembers)
      .innerJoin(circles, eq(circles.id, circleMembers.circleId))
      .where(and(eq(circles.inviteCode, joinCode), eq(circleMembers.userId, userId)));
    if (invited) return `/circles/${invited.circleId}`;
  }

  const [latest] = await db
    .select({ circleId: circleMembers.circleId })
    .from(circleMembers)
    .where(eq(circleMembers.userId, userId))
    .orderBy(desc(circleMembers.joinedAt))
    .limit(1);
  if (latest) return `/circles/${latest.circleId}`;

  const [upcoming] = await db
    .select({ sessionId: rsvps.sessionId })
    .from(rsvps)
    .innerJoin(sessions, eq(sessions.id, rsvps.sessionId))
    .where(
      and(
        eq(rsvps.userId, userId),
        inArray(rsvps.status, ["in", "reserve"]),
        eq(sessions.status, "upcoming"),
        gt(sessions.startsAt, now.getTime()),
      ),
    )
    .orderBy(sessions.startsAt)
    .limit(1);
  if (upcoming) return `/games/${upcoming.sessionId}`;

  return null;
}
