import Link from "next/link";
import type { SessionSummary } from "@/server/games-service";
import { formatMoney } from "@/components/tab/money";
import { WidePage, WideHeader, WideCard } from "./wide-shell";

function DayTile({ startsAt }: { startsAt: number }) {
  const d = new Date(startsAt);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" }).format(d).toUpperCase();
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return (
    <div className="w-[46px] text-center flex-none">
      <div className="font-sans font-extrabold text-[15px] leading-none text-ink">{weekday}</div>
      <div className="font-mono text-[10.5px] text-ink-muted mt-0.5">{time}</div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="border border-ink-hairline-2 text-ink-muted rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold">{children}</span>;
}

function dateLabel(startsAt: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric" }).format(new Date(startsAt));
}

function GameRow({ s, isLast }: { s: SessionSummary; isLast: boolean }) {
  const open = s.slots - s.confirmed.length;
  const isOneOff = s.standingGame == null;
  const sub = isOneOff
    ? `${dateLabel(s.session.startsAt)} · ${s.confirmed.length} of ${s.slots} · single session`
    : `next: ${dateLabel(s.session.startsAt)} · ${s.confirmed.length} of ${s.slots} · slots lock 24h before`;
  return (
    <Link
      href={`/games/${s.session.id}`}
      className={`flex items-center gap-3.5 px-[18px] py-[15px] ${isLast ? "" : "border-b border-ink-hairline-1"} transition-cu-state active:bg-ink-hairline-1`}
    >
      <DayTile startsAt={s.session.startsAt} />
      <div className="flex-1 min-w-0">
        <div className="font-sans font-bold text-[13.5px] text-ink truncate">{s.venue?.name ?? "Venue TBC"}</div>
        <div className="font-mono text-[10.5px] text-ink-muted mt-[3px] truncate">{sub}</div>
      </div>
      {isOneOff ? <Pill>one-off</Pill> : s.rotation ? <Pill>Rotation</Pill> : <Pill>first come</Pill>}
      {s.session.gameType === "friendly" && <Pill>friendlies</Pill>}
      {s.costPerHeadMinor != null && <Pill>{formatMoney(s.costPerHeadMinor, s.costCurrency)} each · Tab</Pill>}
      {open > 0 && <span className="font-mono text-[11px] font-bold text-action-strong">{open} SPOT{open === 1 ? "" : "S"}</span>}
      <span className="font-sans font-bold text-[14px] text-ink-muted">›</span>
    </Link>
  );
}

/**
 * Wide Circle Games (design "Circle · Games"): STANDING GAMES over ONE-OFF
 * SESSIONS, each a day/time tile with the venue, the fill count, rotation vs
 * first-come, money-on-the-Tab, and open-spot chips. Rows link into the wide
 * game-detail page. This surface is new (the phone app reaches games via the
 * pinned bar), so the phone form-factor of /circles/[id]/games renders the
 * circle feed instead of a dead end — see the route.
 */
export function WideGames({ circleId, isOrganiser, standingRows, oneOffRows }: {
  circleId: string;
  isOrganiser: boolean;
  standingRows: SessionSummary[];
  oneOffRows: SessionSummary[];
}) {
  return (
    <WidePage>
      <WideHeader
        title="Games"
        subtitle="the fixtures the Lot runs, plus one-offs"
        right={
          isOrganiser ? (
            <Link
              href={`/games/standing/new?circleId=${circleId}`}
              className="border border-ink-hairline-4 text-ink rounded-[12px] px-4 py-2.5 font-sans font-bold text-[12px]"
            >
              + Add a game
            </Link>
          ) : undefined
        }
      />

      <div className="mt-4">
        <WideCard label="STANDING GAMES">
          {standingRows.length === 0 ? (
            <p className="px-[18px] py-4 font-mono text-[11px] text-ink-muted">No standing games yet.</p>
          ) : (
            standingRows.map((s, i) => <GameRow key={s.session.id} s={s} isLast={i === standingRows.length - 1} />)
          )}
        </WideCard>
      </div>

      {oneOffRows.length > 0 && (
        <div className="mt-3.5">
          <WideCard label="ONE-OFF SESSIONS">
            {oneOffRows.map((s, i) => (
              <GameRow key={s.session.id} s={s} isLast={i === oneOffRows.length - 1} />
            ))}
          </WideCard>
        </div>
      )}
    </WidePage>
  );
}
