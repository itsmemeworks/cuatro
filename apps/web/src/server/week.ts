/**
 * getWeekData — the one read-only aggregate behind the wide "Your week"
 * surface (WEB-SHELL-SPEC.md Wave B, design/CUATRO-Web-LATEST.dc.html
 * "Desktop · Your week"). It answers "what does my next 7 days look like
 * across every Circle I'm in" in a fixed, batched set of queries so the
 * desktop/tablet grid + its three side cards render from a single call.
 *
 * READ-ONLY by contract. Unlike games-service's listUpcomingSessionsForUser
 * (which lazily materialises sessions, locks due rotations, and fires Fourth
 * Calls), this NEVER writes. The wide /home page renders alongside the phone
 * home, whose listUpcomingSessionsForUser already does that write-side work in
 * the same request, and the always-warm scheduler materialises sessions every
 * 60s in prod — so a pure read here is safe and cheap. Mirrors server/shell.ts:
 * batched Promise.all reads, no per-circle N+1, constant query count (~7).
 *
 * Money rules (CLAUDE.md #4) are sacred: balances come from amount_minor
 * integers via server/tab.ts's computeCounterpartyBalances, currencies never
 * combine (GBP-first, the Tab page explains the rest), and the callers render
 * whole pounds without pence.
 */
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import {
  circleMembers,
  circles,
  matches,
  rsvps,
  sessions,
  standingGames,
  tabEntries,
  tabs,
  users,
  venues,
  type CuatroDb,
} from "@cuatro/db";
import { computeCounterpartyBalances, type TabEntryLike } from "@/server/tab";
import { DEFAULT_SESSION_SLOTS, FOURTH_CALL_WINDOW_MS, ROTATION_DEFAULT_CUTOFF_HOURS } from "@/server/games-service";
import { getDb } from "@/server/db";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** How many days the grid spans, starting today. */
export const WEEK_DAYS = 7;

export interface WeekPlayer {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * One upcoming session in the window, as facts (no display strings). The
 * cell's visual state is derived by weekCellKind so it stays testable and the
 * grid + side cards agree.
 */
export interface WeekSession {
  sessionId: string;
  circleId: string;
  circleName: string;
  circleColour: string | null;
  circleEmblem: string | null;
  venueName: string | null;
  /** Kickoff, UTC epoch-ms. */
  startsAt: number;
  /** The session's effective timezone (venue's, else the Circle's) for local time rendering. */
  timezone: string;
  /** Local calendar date key "YYYY-MM-DD" in `timezone` — the grid column this session belongs to. */
  dayKey: string;
  slots: number;
  /** Committed 'in' count (first-come fill). Rotation games never quote a fill count. */
  confirmedCount: number;
  /** Confirmed faces for the needs-answer avatar stack (RSVP order, capped). */
  confirmed: WeekPlayer[];
  /** Public Glass ratings of everyone confirmed, for a Fourth Call level band. */
  confirmedRatings: number[];
  viewerStatus: "in" | "reserve" | "out" | null;
  rotation: boolean;
  rotationLocked: boolean;
  rotationMode: "limited" | "unlimited" | null;
  /** Instant the provisional four locks (startsAt − cutoff); null for non-rotation / unlimited. */
  locksAt: number | null;
  /** Rotation only: did the viewer declare availability this week. */
  viewerAvailable: boolean;
  /** In the Fourth Call window (≤48h out, not full) — same rule as games-service isFourthCallActive. */
  fourthCallActive: boolean;
  costMinor: number | null;
  costCurrency: string;
}

/** Visual state of a day cell / which side card a session feeds. Priority order documented in weekCellKind. */
export type WeekCellKind = "rotation" | "youre-in" | "fourth-call" | "needs-answer" | "confirmed";

export interface WeekDay {
  /** "YYYY-MM-DD" local calendar key (matches WeekSession.dayKey). */
  key: string;
  /** Weekday label, upper-cased by the caller if wanted, e.g. "Sat". */
  weekday: string;
  /** Day of month, e.g. 11. */
  dayNum: number;
  isToday: boolean;
  sessions: WeekSession[];
}

export interface WeekFourthCall {
  sessionId: string;
  circleName: string;
  venueName: string | null;
  startsAt: number;
  timezone: string;
  /** The first confirmed player, standing in as who's asking (avatar + name). */
  askerName: string;
  askerAvatarUrl: string | null;
  /** Confirmed players' Glass ratings for the "their level X–Y" band; empty when none rated. */
  confirmedRatings: number[];
  /** The viewer's own Glass, or null if unrated. */
  viewerRating: number | null;
}

export interface WeekTabPrompt {
  circleId: string;
  circleName: string;
  /** The counterparty the viewer owes the most (single, most-pressing prompt). */
  counterpartyName: string;
  amountMinor: number;
  currency: string;
  /** The most recent unsettled entry's "what for", or null when there's nothing to say. */
  description: string | null;
}

export interface WeekData {
  /** The reference timezone the 7 columns are laid out in (GBP-launch: the viewer's circles', else Europe/London). */
  timezone: string;
  /** Mono range label parts for the "NEXT 7 DAYS" header, e.g. "Sat 11 – Fri 17 Jul". */
  rangeLabel: string;
  days: WeekDay[];
  /** Flattened, earliest-first — the tablet list + counts read from this. */
  sessions: WeekSession[];
  gameCount: number;
  needsAnswerCount: number;
  /** The one session the big needs-answer panel features (earliest needs-answer), or null. */
  needsAnswer: WeekSession | null;
  /** The one incoming Fourth Call the side card features (earliest), or null. */
  fourthCall: WeekFourthCall | null;
  /** The single most-pressing "you owe" prompt across every Circle, or null when all square. */
  tabPrompt: WeekTabPrompt | null;
  /** Most recent past session the viewer played but hasn't logged a result for — the "Log last night's result" target; null hides the button. */
  logResultSessionId: string | null;
  /** True when the viewer belongs to no Circle yet (the first-run empty layout). */
  hasNoCircles: boolean;
}

/**
 * The day cell's visual state, in priority order:
 *   1. rotation pre-lock  → "rotation" (available-not-grab: never a fill count, never a red "needs answer")
 *   2. viewer is 'in'     → "youre-in"
 *   3. open + ≤48h out + viewer hasn't answered → "fourth-call" (the escalating ask)
 *   4. open + viewer hasn't answered            → "needs-answer"
 *   5. otherwise (full and not you / you're out / reserve) → "confirmed" (just in the diary)
 */
export function weekCellKind(s: WeekSession): WeekCellKind {
  if (s.rotation && !s.rotationLocked) return "rotation";
  if (s.viewerStatus === "in") return "youre-in";
  const open = s.confirmedCount < s.slots;
  if (s.viewerStatus === null && open && s.fourthCallActive) return "fourth-call";
  if (s.viewerStatus === null && open) return "needs-answer";
  return "confirmed";
}

export async function getWeekData(userId: string, now: Date = new Date()): Promise<WeekData> {
  const { db } = await getDb();
  return buildWeekData(db, userId, now);
}

/** db-taking core so tests drive it against an isolated PGlite fixture (same split as server/shell.ts). */
export async function buildWeekData(db: CuatroDb, userId: string, now: Date = new Date()): Promise<WeekData> {
  const nowMs = now.getTime();

  const circleRows = await db
    .select({
      id: circles.id,
      name: circles.name,
      colour: circles.colour,
      emblem: circles.emblem,
      timezone: circles.timezone,
    })
    .from(circleMembers)
    .innerJoin(circles, eq(circleMembers.circleId, circles.id))
    .where(eq(circleMembers.userId, userId));

  const circleIds = circleRows.map((c) => c.id);
  const weekTimezone = pickReferenceTimezone(circleRows.map((c) => c.timezone));
  const { days, dayKeys, rangeLabel } = buildDays(nowMs, weekTimezone);

  if (circleIds.length === 0) {
    return {
      timezone: weekTimezone,
      rangeLabel,
      days,
      sessions: [],
      gameCount: 0,
      needsAnswerCount: 0,
      needsAnswer: null,
      fourthCall: null,
      tabPrompt: null,
      logResultSessionId: null,
      hasNoCircles: true,
    };
  }

  // Generous upper bound (8 days) covers the whole 7-column window regardless
  // of any DST shift; sessions outside the exact day-key set are filtered below.
  const windowEndMs = nowMs + (WEEK_DAYS + 1) * DAY_MS;

  const [sessionRows, viewerRow, tabRows, logRow] = await Promise.all([
    db
      .select({
        sessionId: sessions.id,
        circleId: sessions.circleId,
        startsAt: sessions.startsAt,
        rotationLockedAt: sessions.rotationLockedAt,
        slots: standingGames.slots,
        rotationEnabled: standingGames.rotationEnabled,
        rotationMode: standingGames.rotationMode,
        rotationCutoffHours: standingGames.rotationCutoffHours,
        costMinor: standingGames.costMinor,
        costCurrency: standingGames.costCurrency,
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
    db.select({ rating: users.rating }).from(users).where(eq(users.id, userId)).then((r) => r[0]),
    // Every unsettled entry the viewer is a party to, across their circles —
    // fed to computeCounterpartyBalances (which keeps currencies isolated).
    db
      .select({
        entryId: tabEntries.id,
        circleId: tabs.circleId,
        payerUserId: tabEntries.payerUserId,
        debtorUserId: tabEntries.debtorUserId,
        amountMinor: tabEntries.amountMinor,
        currency: tabEntries.currency,
        status: tabEntries.status,
        description: tabEntries.description,
        createdAt: tabEntries.createdAt,
      })
      .from(tabEntries)
      .innerJoin(tabs, eq(tabEntries.tabId, tabs.id))
      .where(
        and(
          inArray(tabs.circleId, circleIds),
          or(eq(tabEntries.payerUserId, userId), eq(tabEntries.debtorUserId, userId)),
          ne(tabEntries.status, "settled"),
        ),
      ),
    // Most recent past session the viewer was 'in' for that has no match yet —
    // the "Log last night's result" target (left join, matches.id null).
    db
      .select({ sessionId: sessions.id })
      .from(sessions)
      .innerJoin(rsvps, and(eq(rsvps.sessionId, sessions.id), eq(rsvps.userId, userId), eq(rsvps.status, "in")))
      .leftJoin(matches, eq(matches.sessionId, sessions.id))
      .where(and(inArray(sessions.circleId, circleIds), ne(sessions.status, "cancelled"), lt(sessions.startsAt, nowMs), isNull(matches.id)))
      .orderBy(desc(sessions.startsAt))
      .limit(1),
  ]);

  // RSVP rows for exactly the window's sessions (one query, joined to users for
  // the confirmed faces + their ratings).
  const sessionIds = sessionRows.map((s) => s.sessionId);
  const rsvpRows = sessionIds.length
    ? await db
        .select({
          sessionId: rsvps.sessionId,
          status: rsvps.status,
          respondedAt: rsvps.respondedAt,
          userId: users.id,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          rating: users.rating,
        })
        .from(rsvps)
        .innerJoin(users, eq(rsvps.userId, users.id))
        .where(inArray(rsvps.sessionId, sessionIds))
    : [];

  const rsvpBySession = new Map<string, typeof rsvpRows>();
  for (const r of rsvpRows) {
    const list = rsvpBySession.get(r.sessionId);
    if (list) list.push(r);
    else rsvpBySession.set(r.sessionId, [r]);
  }

  const circleById = new Map(circleRows.map((c) => [c.id, c]));
  const dayKeySet = new Set(dayKeys);

  const weekSessions: WeekSession[] = [];
  for (const row of sessionRows) {
    const tz = row.venueTimezone ?? row.circleTimezone;
    const dayKey = localDateKey(row.startsAt, tz);
    if (!dayKeySet.has(dayKey)) continue; // outside the exact 7-column window

    const circle = circleById.get(row.circleId);
    const rows = rsvpBySession.get(row.sessionId) ?? [];
    const confirmedRows = rows
      .filter((r) => r.status === "in")
      .sort((a, b) => (a.respondedAt ?? 0) - (b.respondedAt ?? 0));
    const viewerRsvp = rows.find((r) => r.userId === userId);
    const viewerStatus =
      viewerRsvp?.status === "in" || viewerRsvp?.status === "reserve" || viewerRsvp?.status === "out"
        ? viewerRsvp.status
        : null;
    const rotationEnabled = row.rotationEnabled === true;
    const rotationLocked = row.rotationLockedAt != null;
    const slots = row.slots ?? DEFAULT_SESSION_SLOTS;
    const cutoffHours = row.rotationCutoffHours ?? ROTATION_DEFAULT_CUTOFF_HOURS;
    const confirmedCount = confirmedRows.length;
    const msToStart = row.startsAt - nowMs;

    weekSessions.push({
      sessionId: row.sessionId,
      circleId: row.circleId,
      circleName: circle?.name ?? "",
      circleColour: circle?.colour ?? null,
      circleEmblem: circle?.emblem ?? null,
      venueName: row.venueName ?? null,
      startsAt: row.startsAt,
      timezone: tz,
      dayKey,
      slots,
      confirmedCount,
      confirmed: confirmedRows.slice(0, 3).map((r) => ({ userId: r.userId, displayName: r.displayName, avatarUrl: r.avatarUrl })),
      confirmedRatings: confirmedRows.map((r) => r.rating).filter((r): r is number => r != null),
      viewerStatus,
      rotation: rotationEnabled,
      rotationLocked,
      rotationMode: rotationEnabled ? row.rotationMode : null,
      locksAt: rotationEnabled && row.rotationMode !== "unlimited" ? row.startsAt - cutoffHours * HOUR_MS : null,
      viewerAvailable: rows.some((r) => r.userId === userId && r.status === "available"),
      fourthCallActive: msToStart >= 0 && msToStart <= FOURTH_CALL_WINDOW_MS && confirmedCount < slots,
      costMinor: row.costMinor ?? null,
      costCurrency: row.costCurrency ?? "GBP",
    });
  }

  // Bucket into the 7 columns (already time-ordered).
  const daysWithSessions: WeekDay[] = days.map((d) => ({ ...d, sessions: weekSessions.filter((s) => s.dayKey === d.key) }));

  const needsAnswerSessions = weekSessions.filter((s) => weekCellKind(s) === "needs-answer");
  const needsAnswer = needsAnswerSessions[0] ?? null;

  const firstFourthCall = weekSessions.find((s) => weekCellKind(s) === "fourth-call") ?? null;
  const fourthCall: WeekFourthCall | null = firstFourthCall
    ? {
        sessionId: firstFourthCall.sessionId,
        circleName: firstFourthCall.circleName,
        venueName: firstFourthCall.venueName,
        startsAt: firstFourthCall.startsAt,
        timezone: firstFourthCall.timezone,
        askerName: firstFourthCall.confirmed[0]?.displayName ?? firstFourthCall.circleName,
        askerAvatarUrl: firstFourthCall.confirmed[0]?.avatarUrl ?? null,
        confirmedRatings: firstFourthCall.confirmedRatings,
        viewerRating: viewerRow?.rating ?? null,
      }
    : null;

  // Resolve the tab counterparties' names (one small query, only when owed).
  const counterpartyIds = [
    ...new Set(tabRows.flatMap((r) => [r.payerUserId, r.debtorUserId]).filter((id) => id !== userId)),
  ];
  const nameById = counterpartyIds.length
    ? new Map(
        (await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, counterpartyIds))).map(
          (u) => [u.id, u.displayName],
        ),
      )
    : new Map<string, string>();
  const tabPrompt = deriveTabPrompt(tabRows, circleById, nameById, userId);

  return {
    timezone: weekTimezone,
    rangeLabel,
    days: daysWithSessions,
    sessions: weekSessions,
    gameCount: weekSessions.length,
    needsAnswerCount: needsAnswerSessions.length,
    needsAnswer,
    fourthCall,
    tabPrompt,
    logResultSessionId: logRow[0]?.sessionId ?? null,
    hasNoCircles: false,
  };
}

// ---------------------------------------------------------------------------
// The Tab prompt (GBP-first, single most-pressing "you owe" across circles)
// ---------------------------------------------------------------------------

function deriveTabPrompt(
  rows: Array<{
    circleId: string;
    payerUserId: string;
    debtorUserId: string;
    amountMinor: number;
    currency: string;
    status: TabEntryLike["status"];
    description: string | null;
    createdAt: number;
  }>,
  circleById: Map<string, { name: string }>,
  nameById: Map<string, string>,
  userId: string,
): WeekTabPrompt | null {
  if (rows.length === 0) return null;

  // Balances are per counterparty within a currency, netted across every
  // unsettled entry (server/tab.ts). We want the single biggest "you owe"
  // (negative) balance, scoped to the circle it lives in so Settle links right.
  type Owed = { circleId: string; counterpartyUserId: string; currency: string; amountMinor: number };
  const owed: Owed[] = [];
  const byCircle = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byCircle.get(r.circleId);
    if (list) list.push(r);
    else byCircle.set(r.circleId, [r]);
  }
  for (const [circleId, entries] of byCircle) {
    for (const b of computeCounterpartyBalances(entries, userId)) {
      if (b.netMinor < 0) owed.push({ circleId, counterpartyUserId: b.counterpartyUserId, currency: b.currency, amountMinor: -b.netMinor });
    }
  }
  if (owed.length === 0) return null;

  // GBP first (UK launch primary), then the biggest magnitude.
  owed.sort((a, b) => (a.currency === "GBP" ? -1 : b.currency === "GBP" ? 1 : 0) || b.amountMinor - a.amountMinor);
  const top = owed[0];

  // The freshest unsettled entry between this pair stands in for "what for"
  // (matches the phone home's owedRows treatment).
  const freshest = rows
    .filter(
      (r) =>
        r.circleId === top.circleId &&
        ((r.payerUserId === userId && r.debtorUserId === top.counterpartyUserId) ||
          (r.debtorUserId === userId && r.payerUserId === top.counterpartyUserId)),
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];

  return {
    circleId: top.circleId,
    circleName: circleById.get(top.circleId)?.name ?? "",
    counterpartyName: nameById.get(top.counterpartyUserId) ?? "someone",
    amountMinor: top.amountMinor,
    currency: top.currency,
    description: freshest?.description ?? null,
  };
}

// ---------------------------------------------------------------------------
// Day-window helpers (calendar math in a reference timezone; DST-safe labels)
// ---------------------------------------------------------------------------

/** Most common circle timezone, else Europe/London (UK launch default). */
function pickReferenceTimezone(zones: string[]): string {
  if (zones.length === 0) return "Europe/London";
  const counts = new Map<string, number>();
  for (const z of zones) counts.set(z, (counts.get(z) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** "YYYY-MM-DD" calendar date of an instant in the given timezone. */
function localDateKey(instantMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instantMs));
}

/**
 * The 7 grid columns starting on today's local date. Column identity is pure
 * calendar arithmetic (Date.UTC on the local Y-M-D) so labels never skip/repeat
 * across a DST boundary; sessions bucket in by their own local date key.
 */
function buildDays(nowMs: number, timeZone: string): { days: WeekDay[]; dayKeys: string[]; rangeLabel: string } {
  const todayKey = localDateKey(nowMs, timeZone);
  const [y, m, d] = todayKey.split("-").map(Number);
  const days: WeekDay[] = [];
  const dayKeys: string[] = [];
  for (let i = 0; i < WEEK_DAYS; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(dt);
    dayKeys.push(key);
    days.push({ key, weekday, dayNum: dt.getUTCDate(), isToday: i === 0, sessions: [] });
  }
  const first = new Date(Date.UTC(y, m - 1, d));
  const last = new Date(Date.UTC(y, m - 1, d + WEEK_DAYS - 1));
  const dayMonth = (dt: Date) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(dt);
  // "Sat 11 – Fri 17 Jul": drop the leading month when both fall in one month.
  const firstLabel = last.getUTCMonth() === first.getUTCMonth() ? dayMonth(first).replace(/\s\w+$/, "") : dayMonth(first);
  const rangeLabel = `${firstLabel} – ${dayMonth(last)}`;
  return { days, dayKeys, rangeLabel };
}
