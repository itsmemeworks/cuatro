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
 * only glances at the next session for a status line). Query count is constant
 * at 7 regardless of how many circles the viewer has (see the manifest).
 *
 * Money rules (CLAUDE.md #4) are sacred here: net position is computed from
 * amount_minor integers via server/tab.ts's computeNetPosition, currencies are
 * never combined, and the sidebar shows one currency (GBP-first) while the Tab
 * page itself explains the rest. Rating stays hidden until the Placement Trio
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
import { circleColorFor } from "@/lib/design";
import { formatMoney } from "@/components/tab/money";

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
      })
      .from(circleMembers)
      .innerJoin(circles, eq(circleMembers.circleId, circles.id))
      .where(eq(circleMembers.userId, userId))
      // Newest circle first — the same order listCirclesForUser gives the phone.
      .orderBy(sql`${circles.createdAt} desc`),
  ]);

  const identity = buildIdentity(userId, identityRow);
  const circleIds = circleRows.map((c) => c.id);

  // Viewer with no circles: only the notification count is meaningful.
  if (circleIds.length === 0) {
    return {
      identity,
      circles: [],
      tabNetLine: null,
      tabNetOwing: false,
      unreadNotifications: await getUnreadCount(db, userId),
    };
  }

  // --- circle-scoped reads (all independent; run together) --------------------
  const [nextSessionRows, unreadRows, tabRows, unreadNotifications] = await Promise.all([
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
    // Every unsettled entry the viewer is a party to, across their circles — fed
    // straight into computeNetPosition (which keeps currencies isolated).
    db
      .select({
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

  const shellCircles: ShellCircle[] = circleRows.map((c) => {
    const next = nextByCircle.get(c.id);
    const status = next ? deriveSessionStatus(next, rsvpAgg.get(next.sessionId)) : null;
    return {
      id: c.id,
      name: c.name,
      initials: c.name.slice(0, 2).toUpperCase(),
      emblem: c.emblem,
      color: c.colour ?? circleColorFor(c.id),
      statusLine: status?.statusLine ?? null,
      hasUnreadChat: (unreadByCircle.get(c.id) ?? 0) > 0,
      needsAttention: status?.needsAttention ?? false,
    };
  });

  const { tabNetLine, tabNetOwing } = deriveTabNet(tabRows, userId);

  return {
    identity,
    circles: shellCircles,
    tabNetLine,
    tabNetOwing,
    unreadNotifications,
  };
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

function deriveTabNet(
  rows: Array<{ payerUserId: string; debtorUserId: string; amountMinor: number; currency: string; status: TabEntryLike["status"] }>,
  userId: string,
): { tabNetLine: string | null; tabNetOwing: boolean } {
  const net = computeNetPosition(rows, userId); // Record<currency, netMinor>
  const nonZero = Object.entries(net).filter(([, minor]) => minor !== 0);
  if (nonZero.length === 0) return { tabNetLine: null, tabNetOwing: false };

  // GBP first (the UK-launch primary); otherwise the currency the viewer has
  // the biggest stake in. The Tab page itself explains any other currencies.
  const chosen =
    nonZero.find(([currency]) => currency === "GBP") ??
    [...nonZero].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];

  const [currency, minor] = chosen;
  // Match TabSummaryRow exactly: Intl renders the minus for negatives, we add
  // the "+" for positives.
  return {
    tabNetLine: `${minor > 0 ? "+" : ""}${formatMoney(minor, currency)}`,
    tabNetOwing: minor < 0,
  };
}
