/**
 * getQuickSwitchData — the ONE read-only aggregate behind the ⌘K quick
 * switcher's lazily-fetched entries (WEB-SHELL-SPEC.md Wave D). Circles come
 * to the client for free on the ShellData prop; this module supplies the two
 * sets the shell does NOT already carry:
 *
 *   people — every distinct real member across the viewer's circles
 *            (circle_members → users over the viewer's circleIds; guests are
 *            excluded — they are not searchable destinations — and so is the
 *            viewer, whose own page is the sidebar identity card).
 *   games  — upcoming sessions across those circles in the next 7 days (the
 *            same window as the week surface), with just enough RSVP fact to
 *            derive the "needs your answer" flag.
 *
 * READ-ONLY by contract: fetched on the first ⌘K open, so it must never do
 * the lazy materialise/lock/Fourth-Call write work (games-service's job).
 * Query count is constant (4) regardless of circle count, mirroring
 * server/shell.ts. The needs-answer rule matches server/week.ts weekCellKind:
 * a pre-lock rotation game is "available, not grab" — never a red ask — and a
 * viewer with any in/reserve/out row has answered.
 */
import { and, asc, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { circleMembers, circles, rsvps, sessions, standingGames, users, venues, type CuatroDb } from "@cuatro/db";
import { DEFAULT_SESSION_SLOTS } from "@/server/games-service";
import { getDb } from "@/server/db";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far ahead the games list looks — the week surface's window. */
export const QUICK_SWITCH_WINDOW_DAYS = 7;

export interface QuickSwitchPerson {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /** shared-circle names, shell order — searchable keywords client-side */
  circleNames: string[];
}

export interface QuickSwitchGame {
  sessionId: string;
  circleId: string;
  circleName: string;
  venueName: string | null;
  /** kickoff, UTC epoch-ms */
  startsAt: number;
  /** effective timezone (venue's, else the circle's) for the "Tue 8pm" label */
  timezone: string;
  slots: number;
  confirmedCount: number;
  /** open + un-answered by the viewer + not a pre-lock rotation (weekCellKind's rule) */
  needsAnswer: boolean;
}

export interface QuickSwitchData {
  people: QuickSwitchPerson[];
  games: QuickSwitchGame[];
}

export async function getQuickSwitchData(userId: string, now: Date = new Date()): Promise<QuickSwitchData> {
  const { db } = await getDb();
  return buildQuickSwitchData(db, userId, now);
}

/** db-taking core so tests drive it against an isolated PGlite fixture (house split, same as server/shell.ts). */
export async function buildQuickSwitchData(db: CuatroDb, userId: string, now: Date = new Date()): Promise<QuickSwitchData> {
  const nowMs = now.getTime();

  const circleRows = await db
    .select({ id: circles.id, name: circles.name, timezone: circles.timezone, createdAt: circles.createdAt })
    .from(circleMembers)
    .innerJoin(circles, eq(circleMembers.circleId, circles.id))
    .where(eq(circleMembers.userId, userId))
    .orderBy(asc(circles.createdAt));

  const circleIds = circleRows.map((c) => c.id);
  if (circleIds.length === 0) return { people: [], games: [] };

  const windowEndMs = nowMs + QUICK_SWITCH_WINDOW_DAYS * DAY_MS;

  const [memberRows, sessionRows] = await Promise.all([
    // Every real member across the viewer's circles (guests excluded — first-
    // class users rows, but not people you jump to), viewer excluded.
    db
      .select({
        circleId: circleMembers.circleId,
        userId: users.id,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(circleMembers)
      .innerJoin(users, eq(circleMembers.userId, users.id))
      .where(and(inArray(circleMembers.circleId, circleIds), eq(users.isGuest, false), ne(users.id, userId))),
    db
      .select({
        sessionId: sessions.id,
        circleId: sessions.circleId,
        startsAt: sessions.startsAt,
        rotationLockedAt: sessions.rotationLockedAt,
        slots: standingGames.slots,
        rotationEnabled: standingGames.rotationEnabled,
        venueName: venues.name,
        venueTimezone: venues.timezone,
        circleTimezone: circles.timezone,
      })
      .from(sessions)
      .innerJoin(circles, eq(sessions.circleId, circles.id))
      .leftJoin(standingGames, eq(sessions.standingGameId, standingGames.id))
      .leftJoin(venues, eq(sessions.venueId, venues.id))
      .where(
        and(
          inArray(sessions.circleId, circleIds),
          eq(sessions.status, "upcoming"),
          gt(sessions.startsAt, nowMs),
          lt(sessions.startsAt, windowEndMs),
        ),
      )
      .orderBy(asc(sessions.startsAt)),
  ]);

  // RSVP facts for exactly the window's sessions (one query): committed-'in'
  // count + whether the viewer has answered at all.
  const sessionIds = sessionRows.map((s) => s.sessionId);
  const rsvpRows = sessionIds.length
    ? await db
        .select({ sessionId: rsvps.sessionId, userId: rsvps.userId, status: rsvps.status })
        .from(rsvps)
        .where(inArray(rsvps.sessionId, sessionIds))
    : [];

  const agg = new Map<string, { inCount: number; viewerAnswered: boolean }>();
  for (const r of rsvpRows) {
    let a = agg.get(r.sessionId);
    if (!a) {
      a = { inCount: 0, viewerAnswered: false };
      agg.set(r.sessionId, a);
    }
    if (r.status === "in") a.inCount += 1;
    // "available" is a rotation declaration, not an answer to a fill ask; the
    // pre-lock rotation guard below already keeps those games out of the red.
    if (r.userId === userId && (r.status === "in" || r.status === "reserve" || r.status === "out")) a.viewerAnswered = true;
  }

  // People: dedupe across circles, collecting shared-circle names in circle order.
  const circleNameById = new Map(circleRows.map((c) => [c.id, c.name]));
  const peopleById = new Map<string, QuickSwitchPerson>();
  for (const row of memberRows) {
    const circleName = circleNameById.get(row.circleId);
    const existing = peopleById.get(row.userId);
    if (existing) {
      if (circleName && !existing.circleNames.includes(circleName)) existing.circleNames.push(circleName);
    } else {
      peopleById.set(row.userId, {
        userId: row.userId,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
        circleNames: circleName ? [circleName] : [],
      });
    }
  }
  const people = [...peopleById.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));

  const games: QuickSwitchGame[] = sessionRows.map((row) => {
    const a = agg.get(row.sessionId);
    const slots = row.slots ?? DEFAULT_SESSION_SLOTS;
    const confirmedCount = a?.inCount ?? 0;
    const rotationPreLock = row.rotationEnabled === true && row.rotationLockedAt == null;
    const open = confirmedCount < slots;
    return {
      sessionId: row.sessionId,
      circleId: row.circleId,
      circleName: circleNameById.get(row.circleId) ?? "",
      venueName: row.venueName ?? null,
      startsAt: row.startsAt,
      timezone: row.venueTimezone ?? row.circleTimezone,
      slots,
      confirmedCount,
      needsAnswer: !rotationPreLock && open && !(a?.viewerAnswered ?? false),
    };
  });

  return { people, games };
}
