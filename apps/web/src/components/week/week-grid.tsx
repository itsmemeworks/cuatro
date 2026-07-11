import { CircleEmblem } from "@/components/games/roster";
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

function DayCell({ session }: { session: WeekSession }) {
  const kind = weekCellKind(session);
  const time = gridTime(session.startsAt, session.timezone);
  const title = `${time} · ${session.circleName}`;

  if (kind === "fourth-call") {
    return (
      <Box className="border-[1.5px] border-dashed border-action/60">
        <Label className="text-action-on-feature-label tracking-[0.1em]">FOURTH CALL</Label>
        <Title>{title}</Title>
        <Mono>need a 4th</Mono>
      </Box>
    );
  }

  if (kind === "rotation") {
    return (
      <Box className="bg-surface border border-ink-hairline-2">
        <Label className="text-ink-muted tracking-[0.08em]">ROTATION</Label>
        <Title>{title}</Title>
        <div className="flex items-center gap-1.5 mt-1">
          <CircleEmblem seed={session.circleId} name={session.circleName} emblem={session.circleEmblem} colour={session.circleColour} px={16} />
          <span className="text-[10px] font-mono text-ink-muted">
            {session.locksAt != null ? `locks ${whenLabel(session.locksAt, session.timezone)}` : "rolling four"}
          </span>
        </div>
      </Box>
    );
  }

  if (kind === "youre-in") {
    return (
      <Box className="bg-win-tint border border-win/35">
        <Label className="text-win tracking-[0.1em]">YOU&apos;RE IN ✓</Label>
        <Title>{title}</Title>
        <Mono>{fillMeta(session)}</Mono>
      </Box>
    );
  }

  if (kind === "needs-answer") {
    return (
      <Box className="bg-surface-feature border border-action/50">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-action shrink-0" aria-hidden />
          <Label className="text-action-on-feature-label tracking-[0.08em]">NEEDS ANSWER</Label>
        </div>
        <Title className="text-ink-on-feature">{title}</Title>
        <Mono>{fillMeta(session)}</Mono>
      </Box>
    );
  }

  // "confirmed" — a game just in the diary (full and not you, or you're out).
  return (
    <Box className="bg-surface border border-ink-hairline-1">
      <Label className="text-ink-muted tracking-[0.08em]">IN THE DIARY</Label>
      <Title>{title}</Title>
      <Mono>{fillMeta(session)}</Mono>
    </Box>
  );
}

function Box({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[12px] px-2.5 py-[9px] ${className}`}>{children}</div>;
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
