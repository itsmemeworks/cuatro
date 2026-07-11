/**
 * Display formatters for the wide "Your week" surface. All pure and
 * timezone-explicit — the aggregate returns facts (epoch-ms + tz), these turn
 * them into the strings the design uses. Facts render in IBM Plex Mono at the
 * call site (Fact / font-mono); these just shape the value.
 */

/** 24-hour clock in the session's timezone, e.g. "20:00" — the grid cell time. */
export function gridTime(startsAtMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(startsAtMs));
}

/** Weekday + compact 12-hour time, e.g. "Tue 8pm" / "Sat 10am" — the side-panel title + lock time (mirrors the shell status line). */
export function whenLabel(startsAtMs: number, timeZone: string): string {
  const date = new Date(startsAtMs);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(date);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const period = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toLowerCase().replace(/\s/g, "");
  return `${weekday} ${hour}${minute === "00" ? "" : `:${minute}`}${period}`;
}

/** "expires in 2h" — whole hours to kickoff, floored at 1 (a Fourth Call inside the hour still reads "1h", never "0h"). */
export function expiresInLabel(startsAtMs: number, nowMs: number): string {
  const hours = Math.max(1, Math.round((startsAtMs - nowMs) / (60 * 60 * 1000)));
  return `expires in ${hours}h`;
}

/** "their level 4.2–4.9" from confirmed players' Glass ratings, or null when none are rated. */
export function levelBandLabel(ratings: number[]): string | null {
  if (ratings.length === 0) return null;
  const min = Math.min(...ratings);
  const max = Math.max(...ratings);
  return min === max ? `their level ${min.toFixed(2)}` : `their level ${min.toFixed(2)}–${max.toFixed(2)}`;
}
