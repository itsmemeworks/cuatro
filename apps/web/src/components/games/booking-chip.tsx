import { bookingPlatform, type BookingSignpost } from "@/lib/booking";

/*
 * The "Booked on" chip (issue #21, design/CUATRO-Web-LATEST.dc.html circle
 * settings panel): a two-letter tile in the circle-flag style — never a
 * third-party logo — plus the platform name in mono. Tappable outbound when
 * a booking URL exists. Renders NOTHING when no signpost is set: the default
 * state of money on a game is silence.
 * Lead-seeded for Wave C — shared across territories, edit via the lead.
 */

export function BookingChip({
  booking,
  size = 24,
  showLabel = true,
}: {
  booking: BookingSignpost | null;
  size?: number;
  showLabel?: boolean;
}) {
  const platform = bookingPlatform(booking?.platform);
  if (!booking || !platform) return null;

  const body = (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="flex flex-none items-center justify-center bg-ink-hairline-2 text-ink/75"
        style={{
          width: size,
          height: size,
          borderRadius: 8,
          fontFamily: "var(--font-archivo), sans-serif",
          fontWeight: 800,
          fontSize: 10,
        }}
      >
        {platform.tile}
      </span>
      {showLabel ? (
        <span className="font-mono text-[10px] text-ink-muted">
          {booking.url ? `pay on ${platform.label} ↗` : platform.label}
        </span>
      ) : null}
    </span>
  );

  if (!booking.url) return body;
  return (
    <a
      href={booking.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Booked on ${platform.label}, opens in a new tab`}
      className="hover:opacity-80"
    >
      {body}
    </a>
  );
}
