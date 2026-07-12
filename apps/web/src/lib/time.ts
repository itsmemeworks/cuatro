/**
 * THE timezone-explicit date/time formatters. Every render of an instant in
 * the app goes through here (or passes an explicit `timeZone` to Intl
 * directly — the regression guard in time-tz-guard.test.ts enforces one or
 * the other).
 *
 * WHY: the Fly runtime is TZ=UTC. Any `toLocaleString`/`Intl.DateTimeFormat`
 * call without an explicit timeZone renders raw UTC — one hour early for a
 * UK user in BST (QA4/QA7/QA8, the "same game, two times on one screen"
 * class). So every formatter here REQUIRES an IANA timezone argument; there
 * is deliberately no defaulted parameter.
 *
 * WHICH timezone to pass (world-ready rule, CLAUDE.md #5):
 * - Session/game/match instants: the session's effective timezone — venue's,
 *   else the Circle's (`server/week.ts` precedent; `getSessionSummary` and
 *   friends expose it as `timezone`).
 * - Viewer-anchored instants with no venue/circle anchor (notification rows,
 *   chat timestamps): `DEFAULT_TZ` until per-user timezone exists.
 *
 * All functions accept epoch-ms or Date. Locale is pinned to en-GB (the
 * app's launch voice); i18n later swaps ONE place.
 */

/** UK-launch fallback timezone. Use ONLY where no venue/circle timezone can anchor the instant (e.g. viewer-local notification rows). Session times must use the session's own timezone instead. */
export const DEFAULT_TZ = "Europe/London";

type Instant = number | Date;
const LOCALE = "en-GB";

function toDate(instant: Instant): Date {
  return instant instanceof Date ? instant : new Date(instant);
}

/** "19:30" — 24h clock time. */
export function formatTime(instant: Instant, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(toDate(instant));
}

/** "Thu" — short weekday. */
export function formatWeekday(instant: Instant, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone, weekday: "short" }).format(toDate(instant));
}

/** "Thursday" — full weekday. */
export function formatWeekdayLong(instant: Instant, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone, weekday: "long" }).format(toDate(instant));
}

/** "Thu 19:30" — the standard game-card shape (weekday + 24h time, no comma). */
export function formatDayTime(instant: Instant, timeZone: string): string {
  return `${formatWeekday(instant, timeZone)} ${formatTime(instant, timeZone)}`;
}

/** "Thursday 19:30" — the long-form game-hero shape. */
export function formatDayTimeLong(instant: Instant, timeZone: string): string {
  return `${formatWeekdayLong(instant, timeZone)} ${formatTime(instant, timeZone)}`;
}

/** "Thu 16 Jul" — short date with weekday. */
export function formatDate(instant: Instant, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone, weekday: "short", day: "numeric", month: "short" }).format(toDate(instant));
}

/** "Thu 16" — weekday + day of month (Tab activity feed shape). */
export function formatWeekdayDay(instant: Instant, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone, weekday: "short", day: "numeric" }).format(toDate(instant));
}

/** "16 Jul" — day + month, no weekday. */
export function formatDayMonth(instant: Instant, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone, day: "numeric", month: "short" }).format(toDate(instant));
}

/** "Thu 16 Jul, 19:30" — full date + time (notification bodies, page titles). */
export function formatDateTime(instant: Instant, timeZone: string): string {
  return `${formatDate(instant, timeZone)}, ${formatTime(instant, timeZone)}`;
}

/** "Tue 8pm" / "Thu 7:30pm" — the compact shell/week shape (minutes only when non-zero). */
export function formatDayTimeCompact(instant: Instant, timeZone: string): string {
  const date = toDate(instant);
  const weekday = formatWeekday(date, timeZone);
  const parts = new Intl.DateTimeFormat(LOCALE, { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const period = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toLowerCase().replace(/\s/g, "");
  return `${weekday} ${hour}${minute === "00" ? "" : `:${minute}`}${period}`;
}

/** "July 2026" — month header shape (callers upcase for the Ledger). */
export function formatMonthYear(instant: Instant, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone, month: "long", year: "numeric" }).format(toDate(instant));
}

/** "2026-07-16" — the local calendar-date key of an instant (grouping/day-bucket maths; en-CA gives ISO order). */
export function localDateKey(instant: Instant, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(toDate(instant));
}
