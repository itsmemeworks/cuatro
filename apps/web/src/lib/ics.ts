/**
 * Minimal iCalendar (RFC 5545) VEVENT builder — the guest done screen's
 * "Add to calendar" chip (design/HANDOFF.md screen 2; turn 11's step-3
 * mock). One VEVENT is all a game invite ever needs, so this stays a plain
 * string builder rather than pulling in a calendar library.
 */
export interface IcsEventInput {
  uid: string;
  title: string;
  location?: string | null;
  startsAt: Date;
  endsAt: Date;
}

/** UTC, basic format: YYYYMMDDTHHMMSSZ. */
function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** RFC 5545 §3.3.11 text escaping — backslash, semicolon, comma, and literal newlines. */
function escapeIcsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** CRLF-joined VCALENDAR wrapping a single VEVENT, ready to serve as `text/calendar`. */
export function buildIcsEvent(input: IcsEventInput): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CUATRO//game invite//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(input.startsAt)}`,
    `DTEND:${icsDate(input.endsAt)}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
  ];
  if (input.location) lines.push(`LOCATION:${escapeIcsText(input.location)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
