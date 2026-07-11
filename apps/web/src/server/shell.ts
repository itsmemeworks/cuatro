/**
 * The one server module that assembles everything the responsive shell chrome
 * (rail / sidebar / topbar / phone branches) renders around every authed page.
 * The frames agent codes against getShellData's ShellData return; see the
 * lead-owned contract at components/shell/contract.ts for the shapes.
 *
 * This runs on EVERY authed navigation, so it is deliberately a fixed set of
 * batched, READ-ONLY queries — no per-circle N+1, and none of the write-side
 * lazy-generation / Fourth-Call / rotation-lock work that
 * listUpcomingSessionsForUser triggers (that stays the page's job; the shell
 * only glances at the next session for a status line). The per-circle reads
 * are a constant 5 batched queries regardless of circle count; on top of that
 * sit the identity + circle-list pair and the discoverCount probe (see below).
 *
 * discoverCount (the green Discover badge — open public games near the viewer's
 * patch this week) reuses the discovery module rather than reimplementing its
 * geo/privacy rules: resolvePatch gates it (null patch → null, no board query
 * at all, so unplaceable viewers pay nothing beyond resolvePatch), and a
 * placeable viewer runs boardGames once. It runs in parallel with the circle
 * reads. Cost note: boardGames re-resolves the patch internally and is N+1 over
 * nearby candidate sessions, so the badge is the shell's one variable-cost read
 * — see the manifest for the recommended lean count follow-up.
 *
 * Money rules (CLAUDE.md #4) are sacred here: net position is computed from
 * amount_minor integers via server/tab.ts's computeNetPosition, currencies are
 * never combined, and the sidebar shows one currency (GBP-first) while the Tab
 * page itself explains the rest. Amounts render in the web design's money
 * format (formatShellNet): whole pounds carry no pence ("+£8", "−£4"), pence
 * only when real ("£8.50"). Rating stays hidden until the Placement Trio
 * completes (CLAUDE.md #6): the identity fact line reads placement progress
 * while users.rating is NULL and only shows a Glass number once it is set.
 */
import { and, asc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  circleMembers,
  circleMessages,
  circles,
  rsvps,
  sessions,
  standingGames,
  tabEntries,
  tabs,
  users,
  venues,
  type CuatroDb,
} from "@cuatro/db";
import { PLACEMENT_TRIO_SIZE } from "@cuatro/glass";
import type { ShellCircle, ShellData, ShellIdentity } from "@/components/shell/contract";
import { getDb } from "@/server/db";
import { getUnreadCount } from "@/server/notifications";
import { computeNetPosition, type TabEntryLike } from "@/server/tab";
import { DEFAULT_SESSION_SLOTS } from "@/server/games-service";
import { resolvePatch } from "@/server/patch";
import { boardGames } from "@/server/discovery";
import { circleColorFor } from "@/lib/design";

/**
 * Everything the shell chrome needs for `userId`, in one call. Acquires the
 * shared DB connection internally (same getDb() the app layout uses). The
 * `now` default is for tests only — callers pass just the userId.
 */
export async function getShellData(userId: string, now: Date = new Date()): Promise<ShellData> {
  const { db } = await getDb();
  return buildShellData(db, userId, now);
}

/**
 * The db-taking core, split out so tests can drive it against an isolated
 * PGlite fixture (the rest of this repo's server modules take `db` for exactly
 * this reason — getDb() opens the app's real connection). Not used by app code
 * directly; call getShellData(userId) there.
 */
export async function buildShellData(db: CuatroDb, userId: string, now: Date = new Date()): Promise<ShellData> {
  // --- identity + circle list (independent; run together) ---------------------
  const [identityRow, circleRows] = await Promise.all([
    db
      .select({
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        rating: users.rating,
        confidence: users.confidence,
        verifiedMatchCount: users.verifiedMatchCount,
      })
      .from(users)
      .where(eq(users.id, userId))
      .then((rows) => rows[0]),
    db
      .select({
        id: circles.id,
        name: circles.name,
        emblem: circles.emblem,
        colour: circles.colour,
        timezone: circles.timezone,
        createdAt: circles.createdAt,
      })
      .from(circleMembers)
      .innerJoin(circles, eq(circleMembers.circleId, circles.id))
      .where(eq(circleMembers.userId, userId))
      // Newest circle first — the same order listCirclesForUser gives the phone.
      .orderBy(sql`${circles.createdAt} desc`),
  ]);

  const identity = buildIdentity(userId, identityRow);
  const circleIds = circleRows.map((c) => c.id);

  // The Discover badge doesn't depend on the circle list, so kick it off now
  // and let it run alongside everything else (resolved at the return). null
  // patch → null count with no board query — see the file header cost note.
  const discoverCountPromise = computeDiscoverCount(db, userId, now);

  // Viewer with no circles: only the notification count + Discover badge are
  // meaningful (boardGames excludes circles you're already in, so a circle-less
  // but placeable viewer can still have open games near their patch).
  if (circleIds.length === 0) {
    return {
      identity,
      circles: [],
      tabNetLine: null,
      tabNetOwing: false,
      unreadNotifications: await getUnreadCount(db, userId),
      discoverCount: await discoverCountPromise,
    };
  }

  // --- circle-scoped reads (all independent; run together) --------------------
  const [nextSessionRows, unreadRows, tabRows, memberCountRows, unreadNotifications] = await Promise.all([
    // Every upcoming future session for these circles, earliest first; the
    // per-circle "next" is the first one we see when we group in JS below. Joins
    // pull slots (standing game), rotation state, and the effective timezone.
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
          gt(sessions.startsAt, now.getTime()),
        ),
      )
      .orderBy(asc(sessions.startsAt)),
    // Per-circle unread chat count (others' messages after the viewer's
    // last_read_at) in ONE grouped query — same semantics as
    // server/circle-unread.ts getUnreadCountForCircle, without its per-circle loop.
    db
      .select({
        circleId: circleMembers.circleId,
        unread: sql<number>`cast(count(${circleMessages.id}) as int)`,
      })
      .from(circleMembers)
      .leftJoin(
        circleMessages,
        and(
          eq(circleMessages.circleId, circleMembers.circleId),
          ne(circleMessages.userId, userId),
          or(isNull(circleMembers.lastReadAt), gt(circleMessages.createdAt, circleMembers.lastReadAt)),
        ),
      )
      .where(and(eq(circleMembers.userId, userId), inArray(circleMembers.circleId, circleIds)))
      .groupBy(circleMembers.circleId),
    // Every unsettled entry the viewer is a party to, across their circles —
    // fed straight into computeNetPosition (which keeps currencies isolated).
    // circleId rides along so the same rows drive both the global rollup and
    // each circle's own net (no second query per circle).
    db
      .select({
        circleId: tabs.circleId,
        payerUserId: tabEntries.payerUserId,
        debtorUserId: tabEntries.debtorUserId,
        amountMinor: tabEntries.amountMinor,
        currency: tabEntries.currency,
        status: tabEntries.status,
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
    // Roster size per circle, for the circle-context sidebar header subline
    // ("6 members · est. 2024") — one grouped query, no per-circle loop.
    db
      .select({
        circleId: circleMembers.circleId,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(circleMembers)
      .where(inArray(circleMembers.circleId, circleIds))
      .groupBy(circleMembers.circleId),
    getUnreadCount(db, userId),
  ]);

  // First (earliest) upcoming session per circle.
  type NextSession = (typeof nextSessionRows)[number];
  const nextByCircle = new Map<string, NextSession>();
  for (const row of nextSessionRows) {
    if (!nextByCircle.has(row.circleId)) nextByCircle.set(row.circleId, row);
  }

  // RSVP aggregates for exactly those "next" sessions (one query).
  const nextSessionIds = [...nextByCircle.values()].map((s) => s.sessionId);
  const rsvpAgg = await loadRsvpAggregates(db, nextSessionIds, userId);

  const unreadByCircle = new Map(unreadRows.map((r) => [r.circleId, Number(r.unread)]));
  const memberCountByCircle = new Map(memberCountRows.map((r) => [r.circleId, Number(r.count)]));

  // Group the viewer's unsettled entries by circle once, so each circle's net
  // comes from the rows that belong to it (currencies stay isolated per circle,
  // same as the global rollup).
  const tabRowsByCircle = new Map<string, typeof tabRows>();
  for (const row of tabRows) {
    const list = tabRowsByCircle.get(row.circleId) ?? [];
    list.push(row);
    tabRowsByCircle.set(row.circleId, list);
  }

  const shellCircles: ShellCircle[] = circleRows.map((c) => {
    const next = nextByCircle.get(c.id);
    const status = next ? deriveSessionStatus(next, rsvpAgg.get(next.sessionId)) : null;
    const unreadChatCount = unreadByCircle.get(c.id) ?? 0;
    const circleNet = deriveNet(tabRowsByCircle.get(c.id) ?? [], userId);
    return {
      id: c.id,
      name: c.name,
      initials: c.name.slice(0, 2).toUpperCase(),
      emblem: c.emblem,
      color: c.colour ?? circleColorFor(c.id),
      statusLine: status?.statusLine ?? null,
      unreadChatCount,
      memberCount: memberCountByCircle.get(c.id) ?? 0,
      foundedYear: c.createdAt != null ? new Date(Number(c.createdAt)).getFullYear() : null,
      circleTabNetLine: circleNet.line,
      circleTabNetOwing: circleNet.owing,
      needsAttention: status?.needsAttention ?? false,
    };
  });

  const globalNet = deriveNet(tabRows, userId);

  return {
    identity,
    circles: shellCircles,
    tabNetLine: globalNet.line,
    tabNetOwing: globalNet.owing,
    unreadNotifications,
    discoverCount: await discoverCountPromise,
  };
}

// ---------------------------------------------------------------------------
// Discover badge — open public games near the viewer's patch this week
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far ahead the Discover badge looks ("this week" = the next 7 days). */
const DISCOVER_WINDOW_DAYS = 7;

/**
 * Count of open public games near the viewer's patch over the next 7 days, for
 * the Discover nav badge. Returns null when the viewer has no resolvable patch
 * (not placeable → not on the map, badge hidden), matching the discovery
 * contract; resolvePatch gates the work so unplaceable viewers never touch
 * boardGames. Reuses server/discovery.ts's boardGames so the geo/RSVP-window/
 * open-slot/privacy rules stay single-sourced.
 */
async function computeDiscoverCount(db: CuatroDb, userId: string, now: Date): Promise<number | null> {
  const patch = await resolvePatch(db, userId);
  if (!patch) return null;
  const horizon = now.getTime() + DISCOVER_WINDOW_DAYS * DAY_MS;
  const games = await boardGames(db, userId, { now });
  return games.filter((g) => g.startsAt.getTime() <= horizon).length;
}

// ---------------------------------------------------------------------------
// Identity fact line (rating stays hidden until the Placement Trio completes)
// ---------------------------------------------------------------------------

function buildIdentity(
  userId: string,
  row:
    | { displayName: string; avatarUrl: string | null; rating: number | null; confidence: number; verifiedMatchCount: number }
    | undefined,
): ShellIdentity {
  const displayName = row?.displayName?.trim() || "there";
  const avatarUrl = row?.avatarUrl ?? null;
  const rating = row?.rating ?? null;
  const confidence = row?.confidence ?? 0;
  const verifiedMatchCount = row?.verifiedMatchCount ?? 0;

  // rating is NULL until the Placement Trio verifies (CLAUDE.md #6), so a
  // non-null rating IS the reveal signal — never derive the reveal from a
  // count that could race the ledger write.
  const factLine =
    rating !== null
      ? `Glass ${rating.toFixed(2)} · conf ${Math.round(confidence * 100)}%`
      : `Placement Trio · ${Math.min(verifiedMatchCount, PLACEMENT_TRIO_SIZE)} of ${PLACEMENT_TRIO_SIZE}`;

  return { userId, displayName, avatarUrl, factLine };
}

// ---------------------------------------------------------------------------
// Next-session status line + needs-attention (read-only, no side effects)
// ---------------------------------------------------------------------------

interface NextSessionRow {
  startsAt: number;
  rotationLockedAt: number | null;
  slots: number | null;
  rotationEnabled: boolean | null;
  rotationMode: "limited" | "unlimited" | null;
  rotationCutoffHours: number | null;
  venueTimezone: string | null;
  circleTimezone: string;
}

const HOUR_MS = 60 * 60 * 1000;
/** THE ROTATION's default lock lead (hours before kickoff) — mirrors games-service ROTATION_DEFAULT_CUTOFF_HOURS / the standing_games column default. */
const ROTATION_DEFAULT_CUTOFF_HOURS = 24;

interface RsvpAggregate {
  inCount: number;
  viewerHasRow: boolean;
}

/**
 * The mono status line + needs-answer flag for a circle's next session.
 *
 * Two shapes, because the two game types have two different mechanics:
 *
 * - First-come game: FILL-oriented. Counts committed 'in' rows against the
 *   slots — "N spot(s) open" / "full ✓". needsAttention when the viewer holds
 *   no RSVP row AND there is still a spot to take.
 *
 * - Rotation game (rotationEnabled): LOCK-oriented, never a fill count —
 *   nobody holds a slot ("available, not grab"), so a "3 of 4" would
 *   misrepresent the mechanic (lead ruling 2026, matches the Games-list design).
 *   Pre-lock (limited mode): "{when} · locks {lockWhen}". Post-lock:
 *   "{when} · locked ✓". Unlimited mode never locks, so it shows just "{when}".
 *   needsAttention when the viewer has not yet declared availability (pre-lock);
 *   a locked rotation is decided, so nothing to answer.
 */
function deriveSessionStatus(
  next: NextSessionRow,
  agg: RsvpAggregate | undefined,
): { statusLine: string; needsAttention: boolean } {
  const viewerHasRow = agg?.viewerHasRow ?? false;
  const tz = next.venueTimezone ?? next.circleTimezone;
  const when = formatSessionWhen(new Date(next.startsAt), tz);

  if (next.rotationEnabled === true) {
    if (next.rotationLockedAt != null) {
      return { statusLine: `${when} · locked ✓`, needsAttention: false };
    }
    // Pre-lock. A limited-mode game shows when its four lock; unlimited never
    // locks, so there is no lock time to show.
    if (next.rotationMode === "unlimited") {
      return { statusLine: when, needsAttention: !viewerHasRow };
    }
    const cutoffHours = next.rotationCutoffHours ?? ROTATION_DEFAULT_CUTOFF_HOURS;
    const locksWhen = formatSessionWhen(new Date(next.startsAt - cutoffHours * HOUR_MS), tz);
    return { statusLine: `${when} · locks ${locksWhen}`, needsAttention: !viewerHasRow };
  }

  // First-come.
  const slots = next.slots ?? DEFAULT_SESSION_SLOTS;
  const spotsOpen = Math.max(0, slots - (agg?.inCount ?? 0));
  const fill = spotsOpen === 0 ? "full ✓" : `${spotsOpen} spot${spotsOpen === 1 ? "" : "s"} open`;

  return {
    statusLine: `${when} · ${fill}`,
    needsAttention: !viewerHasRow && spotsOpen > 0,
  };
}

/** "Tue 8pm" / "Thu 7:30pm" in the session's effective timezone (matches the contract's example shape). */
function formatSessionWhen(date: Date, timeZone: string): string {
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(date);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const period = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toLowerCase().replace(/\s/g, "");
  const time = `${hour}${minute === "00" ? "" : `:${minute}`}${period}`;
  return `${weekday} ${time}`;
}

/** Per-session RSVP counts + whether the viewer has any row, for a set of sessions, in one query. */
async function loadRsvpAggregates(
  db: CuatroDb,
  sessionIds: string[],
  userId: string,
): Promise<Map<string, RsvpAggregate>> {
  const byId = new Map<string, RsvpAggregate>();
  if (sessionIds.length === 0) return byId;

  const rows = await db
    .select({ sessionId: rsvps.sessionId, userId: rsvps.userId, status: rsvps.status })
    .from(rsvps)
    .where(inArray(rsvps.sessionId, sessionIds));

  for (const row of rows) {
    let agg = byId.get(row.sessionId);
    if (!agg) {
      agg = { inCount: 0, viewerHasRow: false };
      byId.set(row.sessionId, agg);
    }
    if (row.status === "in") agg.inCount += 1;
    if (row.userId === userId) agg.viewerHasRow = true;
  }
  return byId;
}

// ---------------------------------------------------------------------------
// Tab net line (GBP-first single currency; currencies never combined)
// ---------------------------------------------------------------------------

/**
 * The web shell's money format (design/CUATRO-Web-LATEST.dc.html): a leading
 * sign, then the amount with pence ONLY when there are real pence — whole
 * pounds render as "+£8" / "−£4", never "+£8.00". The minus is the typographic
 * U+2212 the design uses, and the sign is applied by hand around the unsigned
 * magnitude so the format is identical for every currency.
 */
function formatShellNet(minor: number, currency: string, locale = "en-GB"): string {
  const whole = minor % 100 === 0;
  const magnitude = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(minor) / 100);
  const sign = minor > 0 ? "+" : minor < 0 ? "−" : "";
  return `${sign}${magnitude}`;
}

/**
 * The viewer's net across a set of unsettled tab entries, as a display line +
 * an owing flag. Currencies never net against each other (CLAUDE.md #4): when
 * the viewer straddles more than one, GBP wins (UK-launch primary), otherwise
 * the currency they have the biggest stake in — the Tab page explains the
 * rest. null line when everything squares to zero. Drives both the global
 * rollup and each circle's own net.
 */
function deriveNet(
  rows: Array<{ payerUserId: string; debtorUserId: string; amountMinor: number; currency: string; status: TabEntryLike["status"] }>,
  userId: string,
): { line: string | null; owing: boolean } {
  const net = computeNetPosition(rows, userId); // Record<currency, netMinor>
  const nonZero = Object.entries(net).filter(([, minor]) => minor !== 0);
  if (nonZero.length === 0) return { line: null, owing: false };

  const chosen =
    nonZero.find(([currency]) => currency === "GBP") ??
    [...nonZero].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];

  const [currency, minor] = chosen;
  return { line: formatShellNet(minor, currency), owing: minor < 0 };
}
