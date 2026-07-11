import Link from "next/link";
import { CircleEmblem } from "@/components/games/roster";
import { BookingChip } from "@/components/games/booking-chip";
import { weekCellKind, type WeekData, type WeekDay, type WeekSession } from "@/server/week";
import { gridTime, whenLabel } from "./format";

/**
 * The NEXT 7 DAYS grid (design "Desktop · Your week"): one glance across every
 * Circle for the week. Seven columns from today; each holds the day's
 * session(s) as a state-coloured cell (fourth-call / rotation / needs-answer /
 * you're-in / in-the-diary) derived by weekCellKind, or a muted "·" when
 * empty. Rotation cells never quote a fill count (available-not-grab); they
 * show the lock time instead — same rule as the shell status line.
 */
export function WeekGrid({ data }: { data: WeekData }) {
  return (
    <div className="rounded-card bg-surface border border-ink-hairline-1 overflow-hidden">
      <div className="flex justify-between items-center px-[18px] py-3 bg-ink-hairline-1/60">
        <span className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-muted">NEXT 7 DAYS</span>
        <span className="text-[10px] font-mono text-ink-muted tabular-nums">{data.rangeLabel}</span>
      </div>
      <div className="grid grid-cols-7">
        {data.days.map((day, i) => (
          <DayColumn key={day.key} day={day} last={i === data.days.length - 1} />
        ))}
      </div>
    </div>
  );
}

function DayColumn({ day, last }: { day: WeekDay; last: boolean }) {
  const hasNeedsAnswer = day.sessions.some((s) => weekCellKind(s) === "needs-answer");
  return (
    <div
      className={[
        "min-h-[148px] px-2.5 pt-3 pb-3.5 flex flex-col gap-2.5",
        last ? "" : "border-r border-ink-hairline-1",
        hasNeedsAnswer ? "bg-action/5" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={`text-[11px] font-extrabold ${day.isToday ? "text-action-on-feature-link" : "text-ink-muted"}`}>
        {day.weekday.toUpperCase()} <span className="font-mono text-[10px] tabular-nums">{day.dayNum}</span>
        {day.isToday ? " · today" : ""}
      </div>
      {day.sessions.length === 0 ? (
        <div className="text-[11px] font-mono text-ink-muted/40 mt-2">·</div>
      ) : (
        day.sessions.map((s) => <DayCell key={s.sessionId} session={s} />)
      )}
    </div>
  );
}

/** venue · fill, e.g. "Powerleague · 3 of 4"; drops the venue when there isn't one. */
function fillMeta(s: WeekSession): string {
  const fill = `${s.confirmedCount} of ${s.slots}`;
  return s.venueName ? `${s.venueName} · ${fill}` : fill;
}

/**
 * The cell's mono meta line, with the two-letter booked-on tile in front when
 * the game carries a booking signpost (issue #21; renders nothing extra
 * otherwise). `url` is deliberately stripped: the whole cell is a Link to the
 * game detail (a nested outbound <a> would be invalid HTML), and the tappable
 * "pay on X ↗" chip lives there.
 */
function FillMeta({ session, onFeature = false }: { session: WeekSession; onFeature?: boolean }) {
  // The needs-answer cell sits on the fixed-dark surface-feature card, where
  // theme-reactive ink-muted goes dark-on-dark — use the on-feature muted ink
  // there (same rule as components/ui/button.tsx's onFeature). The booking
  // tile is skipped on that card too: BookingChip's theme-reactive tile is
  // equally invisible there, and the design's needs-answer cell carries no
  // chip — the game detail behind the cell's link has the full signpost.
  const mutedClass = onFeature ? "text-ink-on-feature-muted" : "text-ink-muted";
  const booking = !onFeature && session.moneyOptIn?.kind === "booking" ? session.moneyOptIn.booking : null;
  if (!booking) return <div className={`text-[10px] font-mono mt-1 ${mutedClass}`}>{fillMeta(session)}</div>;
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <BookingChip booking={{ platform: booking.platform, url: null }} size={16} showLabel={false} />
      <span className={`text-[10px] font-mono ${mutedClass}`}>{fillMeta(session)}</span>
    </div>
  );
}

/**
 * Every rendered game is actionable (Pete, 2026-07-11): each cell is a Link to
 * its game detail with a visible hover state — neutral cells tint to
 * hairline-1, the two colour-tinted cells (you're-in, needs-answer) ease
 * opacity, matching Button's built-in hover idiom.
 */
function DayCell({ session }: { session: WeekSession }) {
  const kind = weekCellKind(session);
  const time = gridTime(session.startsAt, session.timezone);
  const title = `${time} · ${session.circleName}`;

  const body = (() => {
    if (kind === "fourth-call") {
      return (
        <Box className="border-[1.5px] border-dashed border-action/60 hover:bg-ink-hairline-1">
          <Label className="text-action-on-feature-label tracking-[0.1em]">FOURTH CALL</Label>
          <Title>{title}</Title>
          <Mono>need a 4th</Mono>
        </Box>
      );
    }

    if (kind === "rotation") {
      // Design "Desktop · Your week": a booked-on game shows its two-letter
      // platform tile beside the lock time (issue #21's home week card chip);
      // without a signpost the Circle's own emblem keeps the spot.
      const booking = session.moneyOptIn?.kind === "booking" ? session.moneyOptIn.booking : null;
      return (
        <Box className="bg-surface border border-ink-hairline-2 hover:bg-ink-hairline-1">
          <Label className="text-ink-muted tracking-[0.08em]">ROTATION</Label>
          <Title>{title}</Title>
          <div className="flex items-center gap-1.5 mt-1">
            {booking ? (
              <BookingChip booking={{ platform: booking.platform, url: null }} size={16} showLabel={false} />
            ) : (
              <CircleEmblem seed={session.circleId} name={session.circleName} emblem={session.circleEmblem} colour={session.circleColour} px={16} />
            )}
            <span className="text-[10px] font-mono text-ink-muted">
              {session.locksAt != null ? `locks ${whenLabel(session.locksAt, session.timezone)}` : "rolling four"}
            </span>
          </div>
        </Box>
      );
    }

    if (kind === "youre-in") {
      return (
        <Box className="bg-win-tint border border-win/35 hover:opacity-90">
          <Label className="text-win tracking-[0.1em]">YOU&apos;RE IN ✓</Label>
          <Title>{title}</Title>
          <FillMeta session={session} />
        </Box>
      );
    }

    if (kind === "needs-answer") {
      return (
        <Box className="bg-surface-feature border border-action/50 hover:opacity-90">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-action shrink-0" aria-hidden />
            <Label className="text-action-on-feature-label tracking-[0.08em]">NEEDS ANSWER</Label>
          </div>
          <Title className="text-ink-on-feature">{title}</Title>
          <FillMeta session={session} onFeature />
        </Box>
      );
    }

    // "confirmed" — a game just in the diary (full and not you, or you're out).
    return (
      <Box className="bg-surface border border-ink-hairline-1 hover:bg-ink-hairline-1">
        <Label className="text-ink-muted tracking-[0.08em]">IN THE DIARY</Label>
        <Title>{title}</Title>
        <FillMeta session={session} />
      </Box>
    );
  })();

  return (
    <Link href={`/games/${session.sessionId}`} className="block">
      {body}
    </Link>
  );
}

function Box({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[12px] px-2.5 py-[9px] transition-cu-state ${className}`}>{children}</div>;
}

function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-[10px] font-extrabold ${className}`}>{children}</div>;
}

function Title({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-[11.5px] leading-[1.3] font-bold text-ink mt-1 ${className}`}>{children}</div>;
}

function Mono({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-mono text-ink-muted mt-1">{children}</div>;
}
