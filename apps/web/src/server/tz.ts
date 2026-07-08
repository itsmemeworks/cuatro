/**
 * Timezone-correct "next occurrence" math for Standing Games, with zero
 * external dependencies (Node ships full ICU, so Intl.DateTimeFormat +
 * Intl's IANA tz database is all we need).
 *
 * Standing Games store `weekday` (0=Sunday..6=Saturday, matching JS's
 * Date#getUTCDay()) + `startTime` ("HH:MM") *local to the Circle/venue
 * timezone*. Sessions store the resolved instant as UTC. This module is the
 * only place that bridges the two, so DST transitions are handled in
 * exactly one spot.
 */

type ZonedParts = {
  year: number
  month: number // 0-based, matches Date#getUTCMonth()
  day: number
  hour: number
  minute: number
  second: number
}

/** How `utcMillis` reads on a wall clock in `timeZone`. */
function getZonedParts(utcMillis: number, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const map: Record<string, string> = {}
  for (const part of dtf.formatToParts(new Date(utcMillis))) {
    if (part.type !== "literal") map[part.type] = part.value
  }
  return {
    year: Number(map.year),
    month: Number(map.month) - 1,
    // h23 can format local midnight as "24" under some ICU builds.
    day: Number(map.day),
    hour: map.hour === "24" ? 0 : Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

/** The UTC offset (in ms, positive for zones ahead of UTC) in effect at `utcMillis` in `timeZone`. */
function offsetMsAt(utcMillis: number, timeZone: string): number {
  const p = getZonedParts(utcMillis, timeZone)
  const asUtc = Date.UTC(p.year, p.month, p.day, p.hour, p.minute, p.second)
  return asUtc - utcMillis
}

/**
 * Converts a wall-clock date/time as observed in `timeZone` into the precise
 * UTC instant it represents. Iterates to convergence to handle DST
 * transitions correctly (2-3 passes always suffice for real IANA data);
 * for a wall-clock time that doesn't exist (spring-forward gap) or is
 * ambiguous (autumn-back overlap) it converges to a nearby, well-defined
 * instant rather than throwing.
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number, // 0-based
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const target = Date.UTC(year, month, day, hour, minute, 0)
  let utcGuess = target
  for (let i = 0; i < 3; i++) {
    const offset = offsetMsAt(utcGuess, timeZone)
    const nextGuess = target - offset
    if (nextGuess === utcGuess) break
    utcGuess = nextGuess
  }
  return new Date(utcGuess)
}

/** Calendar weekday (0=Sunday..6=Saturday) of `date` as observed in `timeZone`. */
export function zonedWeekday(date: Date, timeZone: string): number {
  const p = getZonedParts(date.getTime(), timeZone)
  return new Date(Date.UTC(p.year, p.month, p.day)).getUTCDay()
}

/**
 * The next occurrence of `weekday` at `startTime` ("HH:MM") local to
 * `timeZone`, strictly after `now`. `weekday`: 0=Sunday..6=Saturday.
 */
export function computeNextOccurrence(
  weekday: number,
  startTime: string,
  timeZone: string,
  now: Date,
): Date {
  const match = /^(\d{2}):(\d{2})$/.exec(startTime)
  if (!match) throw new Error(`computeNextOccurrence: invalid startTime "${startTime}", expected "HH:MM"`)
  const hour = Number(match[1])
  const minute = Number(match[2])

  const todayInTz = getZonedParts(now.getTime(), timeZone)
  const todayDateOnly = Date.UTC(todayInTz.year, todayInTz.month, todayInTz.day)
  const todayWeekday = new Date(todayDateOnly).getUTCDay()
  let dayOffset = (weekday - todayWeekday + 7) % 7

  for (let attempt = 0; attempt < 8; attempt++) {
    const candidateDateOnly = new Date(todayDateOnly + dayOffset * 86_400_000)
    const candidateUtc = zonedWallTimeToUtc(
      candidateDateOnly.getUTCFullYear(),
      candidateDateOnly.getUTCMonth(),
      candidateDateOnly.getUTCDate(),
      hour,
      minute,
      timeZone,
    )
    if (candidateUtc.getTime() > now.getTime()) return candidateUtc
    dayOffset += 7
  }
  throw new Error(
    `computeNextOccurrence: could not converge for weekday=${weekday} startTime=${startTime} tz=${timeZone}`,
  )
}
