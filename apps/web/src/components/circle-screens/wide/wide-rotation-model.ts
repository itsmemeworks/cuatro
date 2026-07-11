/*
 * Pure view-model helpers for THE ROTATION's wide presentation
 * (design/CUATRO-Web-LATEST.dc.html "Circle · Rotation game"). No React, no
 * timezone surprises hidden in JSX — every label the wide panels render comes
 * from here so the copy is unit-testable. Same data as the phone card
 * (StandingGameWeekCard's RotationCardView), different anatomy.
 */

/** "Sat 10am" / "Sat 7:30pm" — the design's lock-instant shorthand. */
export function shortDayTime(ms: number, timeZone = "Europe/London"): string {
  const d = new Date(ms);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(d);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(d);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const period = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").replace(/\./g, "").replace(/\s/g, "").toLowerCase();
  return minute === "00" ? `${weekday} ${hour}${period}` : `${weekday} ${hour}:${minute}${period}`;
}

/** "This Sunday · 12 Jul" — the pre-lock availability card's heading. */
export function thisWeekHeading(startsAtMs: number, timeZone = "Europe/London"): string {
  const d = new Date(startsAtMs);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long" }).format(d);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric" }).format(d);
  const month = new Intl.DateTimeFormat("en-GB", { timeZone, month: "short" }).format(d);
  return `This ${weekday} · ${day} ${month}`;
}

/** "Sun 12 · 10:00" — THE FOUR header's right-hand session stamp. */
export function sessionStamp(startsAtMs: number, timeZone = "Europe/London"): string {
  const d = new Date(startsAtMs);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(d);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${weekday} ${day} · ${time}`;
}

/**
 * "THE FOUR · LOCKED SAT 10AM" — the locked header. Falls back to plain
 * "THE FOUR · LOCKED" if the lock instant isn't known (shouldn't happen for a
 * locked limited game, but unlimited-mode data never carries one).
 */
export function lockedHeaderLabel(lockedAtMs: number | null, timeZone = "Europe/London"): string {
  if (lockedAtMs == null) return "THE FOUR · LOCKED";
  return `THE FOUR · LOCKED ${shortDayTime(lockedAtMs, timeZone).toUpperCase()}`;
}

/** THE BENCH's per-row standing: #1 banks first refusal, the rest queue behind. */
export function benchStatus(index: number): { label: string; tone: "win" | "muted" } {
  if (index === 0) return { label: "first in next week", tone: "win" };
  const ordinals = ["second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
  const ordinal = ordinals[index - 1];
  return { label: ordinal ? `${ordinal} in line` : `number ${index + 1} in line`, tone: "muted" };
}

/**
 * The consent-offer cascade's per-row status (organiser view). `holderIndex`
 * is the bench position currently holding the live offer (-1 when no offer is
 * live, e.g. the page hasn't advanced it yet). Rows before the holder already
 * passed (or let the offer lapse); the holder waits; the next in line is named
 * so the organiser can see exactly where the spot goes if this one passes.
 */
export function cascadeStatus(
  index: number,
  holderIndex: number,
  holderFirstName: string | null,
): { label: string; tone: "action" | "muted" } {
  if (holderIndex === -1) {
    return index === 0 ? { label: "next up for the offer", tone: "muted" } : { label: "in line", tone: "muted" };
  }
  if (index < holderIndex) return { label: "passed", tone: "muted" };
  if (index === holderIndex) return { label: "offered · waiting", tone: "action" };
  if (index === holderIndex + 1 && holderFirstName) return { label: `next if ${holderFirstName} passes`, tone: "muted" };
  return { label: "in line", tone: "muted" };
}

/**
 * The header pill describing the game's rotation contract, e.g.
 * "limited · locks 24h before kickoff" / "unlimited · re-picks to kickoff".
 */
export function rotationModePill(mode: "limited" | "unlimited", cutoffHours: number): string {
  if (mode === "unlimited") return "unlimited · re-picks to kickoff";
  const cutoff = cutoffHours % 24 === 0 && cutoffHours >= 24 ? `${cutoffHours / 24 === 1 ? "24h" : `${cutoffHours / 24} days`}` : `${cutoffHours}h`;
  return `limited · locks ${cutoff} before kickoff`;
}

/** The games-list subline for a rotation fixture: what happens next, honestly. */
export function rotationListStatus(input: { locked: boolean; mode: "limited" | "unlimited"; locksAtMs: number }, timeZone = "Europe/London"): string {
  if (input.locked) return "the four is set";
  if (input.mode === "unlimited") return "re-picks to kickoff";
  return `lineup locks ${shortDayTime(input.locksAtMs, timeZone)}`;
}
