import Link from "next/link";
import type { ReactNode } from "react";
import type { SessionSummary } from "@/server/games-service";
import { StandingGameWeekCard } from "@/components/games/StandingGameWeekCard";
import { VenueMapCard } from "@/components/games/venue-map-card";
import { FriendlyBadge } from "@/components/matches/friendly-badge";
import { Button, Meta } from "@/components/ui";
import { formatMoney } from "@/components/tab/money";

export interface GameDetailProps {
  summary: SessionSummary;
  viewer: { id: string; displayName: string; avatarUrl: string | null };
  glassByUserId: Record<string, number | null>;
  guestByUserId: Record<string, boolean>;
  viewerIsOrganiser: boolean;
  upcoming: boolean;
  gameFull: boolean;
  isPast: boolean;
  existingMatchId: string | null;
  alreadySplit: boolean;
  createSplitAction: (formData: FormData) => Promise<void>;
  pinLocationAction: ((formData: FormData) => Promise<void>) | null;
  standingGameTitle: string;
  rsvpWindowDays: number;
  durationMinutes: number;
  fourthCallHref: string;
  viewerStatusLine: string | null;
  /** Organiser-only session asks-to-join (Board knocks); the page builds the KnockPanel. */
  knockPanel?: ReactNode;
}

/** The rings visual (design "FOURTH CALL · ORGANISER"): display-only; "Send the call" links into the existing phone Fourth Call flow. */
function FourthCallRingsPanel({ circleName, fourthCallHref }: { circleName: string; fourthCallHref: string }) {
  const rings = [
    { n: "1", title: "The Circle first", sub: `${circleName}, ready to send`, filled: true },
    { n: "2", title: "Extended network", sub: "people you've played with", filled: true },
    { n: "3", title: "Anyone with the link", sub: "looks good in WhatsApp, faces plus one dashed slot", filled: false },
  ];
  return (
    <div className="bg-surface border border-ink-hairline-1 rounded-[20px] p-[18px]">
      <div className="font-sans font-extrabold text-[10px] tracking-[0.12em] text-action-strong">FOURTH CALL · ORGANISER</div>
      <div className="font-mono text-[10.5px] text-ink-muted mt-1.5">widening rings. Closest people first, strangers never</div>
      <div className="mt-2.5">
        {rings.map((r, i) => (
          <div key={r.n} className={`flex items-center gap-2.5 py-[11px] ${i < rings.length - 1 ? "border-b border-ink-hairline-1" : ""}`}>
            <span
              className={`w-6 h-6 rounded-full text-center font-sans font-bold text-[11px] leading-6 flex-none box-border ${
                r.filled ? "bg-ink-hairline-2 text-ink" : "border border-ink-hairline-4 text-ink-muted"
              }`}
            >
              {r.n}
            </span>
            <div className="flex-1 min-w-0">
              <div className={`font-sans font-bold text-[12.5px] ${r.filled ? "text-ink" : "text-ink-muted"}`}>{r.title}</div>
              <div className="font-mono text-[10px] text-ink-muted mt-0.5">{r.sub}</div>
            </div>
          </div>
        ))}
      </div>
      <Link href={fourthCallHref} className="mt-1.5 block bg-action text-action-contrast rounded-[13px] text-center py-3 font-sans font-extrabold text-[13.5px]">
        Send the call
      </Link>
      <div className="mt-2 text-center font-mono text-[10px] text-ink-muted">closest people first, then wider if it stays quiet</div>
    </div>
  );
}

/**
 * Game detail (design "Desktop · Standing game" / "Circle · Rotation game" /
 * "Circle · One-off session"). ONE responsive tree: below 900px it stacks (the
 * roster, cost and venue in a single column); at 900px+ it becomes a two-column
 * layout (roster/RSVP + cost left, venue map + Fourth Call rings right). The
 * roster is a SINGLE StandingGameWeekCard instance (it opens a realtime session
 * subscription on mount), so first-come RSVP, the reserve queue and the whole
 * THE ROTATION state machine render once, whatever the width. c4-wide opts the
 * shell out of the 448 clamp at 900+.
 */
export function GameDetail(props: GameDetailProps) {
  const { summary, viewer } = props;
  const isRotation = summary.rotation != null;
  const isOneOff = summary.standingGame == null;
  const open = summary.slots - summary.confirmed.length;

  // A rotation game keeps its Fourth Call / offer handling inside the roster
  // card; a plain standing game surfaces the rings panel instead (never both).
  const rotationCanSendFourthCall = isRotation && props.viewerIsOrganiser && props.upcoming && !props.gameFull;
  const showRingsPanel = props.viewerIsOrganiser && props.upcoming && !props.gameFull && !isOneOff && !isRotation;

  const eyebrow = isOneOff ? "ONE-OFF SESSION" : isRotation ? "STANDING GAME · THE ROTATION" : "STANDING GAME";
  const subline = isOneOff
    ? "single session · no recurrence"
    : `repeats weekly · RSVPs open ${props.rsvpWindowDays} ${props.rsvpWindowDays === 1 ? "day" : "days"} before`;

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-4 c4-wide min-[900px]:px-[30px] min-[900px]:pt-0 min-[900px]:pb-0 min-[900px]:max-w-[1000px] min-[900px]:mx-auto">
      <Link href={`/circles/${summary.circleId}/games`} className="text-cu-secondary font-bold text-action">
        ‹ Games
      </Link>

      {props.viewerStatusLine && (
        <div
          className={`rounded-button px-4 py-2.5 text-cu-body font-bold min-[900px]:hidden ${
            summary.viewerStatus === "in" ? "bg-win-tint text-win" : "bg-surface border border-ink-hairline-1 text-ink"
          }`}
        >
          {props.viewerStatusLine}
        </div>
      )}

      <div className="flex items-end gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Meta as="span" className="uppercase tracking-[0.12em]">
              {eyebrow}
            </Meta>
            {summary.session.gameType === "friendly" && <FriendlyBadge />}
          </div>
          <h1 className="text-cu-title text-ink mt-1.5 leading-tight min-[900px]:text-[26px]">
            {props.standingGameTitle}
            {summary.venue && (
              <>
                <span className="min-[900px]:hidden">
                  <br />
                  {summary.venue.name}
                </span>
                <span className="hidden min-[900px]:inline"> · {summary.venue.name}</span>
              </>
            )}
          </h1>
          <Meta as="p" className="mt-1.5">
            {subline}
          </Meta>
        </div>
        {props.upcoming && open > 0 && (
          <span className="hidden min-[900px]:block font-mono text-[11.5px] font-bold text-action-strong pb-1 whitespace-nowrap">
            {open} SPOT{open === 1 ? "" : "S"} OPEN
          </span>
        )}
      </div>

      <div className="flex flex-col gap-4 min-[900px]:grid min-[900px]:grid-cols-2 min-[900px]:gap-4 min-[900px]:items-start">
        <div className="flex flex-col gap-4 min-w-0">
          <StandingGameWeekCard
            sessionId={summary.session.id}
            circleId={summary.circleId}
            circleName={summary.circleName}
            circleColour={summary.circleColour}
            circleEmblem={summary.circleEmblem}
            weekLabel={new Date(summary.session.startsAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
            slots={summary.slots}
            confirmed={summary.confirmed}
            reserves={summary.reserves}
            viewerUserId={viewer.id}
            viewerDisplayName={viewer.displayName}
            viewerAvatarUrl={viewer.avatarUrl}
            viewerStatus={summary.viewerStatus}
            rsvpWindowOpensAt={summary.rsvpWindowOpensAt}
            startsAt={new Date(summary.session.startsAt)}
            canSendFourthCall={rotationCanSendFourthCall}
            fourthCallHref={props.fourthCallHref}
            glassByUserId={props.glassByUserId}
            guestByUserId={props.guestByUserId}
            rotation={
              summary.rotation
                ? {
                    mode: summary.rotation.mode,
                    locked: summary.rotation.lockedAt != null,
                    coldStart: summary.rotation.coldStart,
                    locksAtMs: summary.rotation.locksAt.getTime(),
                    available: summary.rotation.available,
                    lineup: summary.rotation.lineup,
                    sitting: summary.rotation.sitting,
                    reasons: summary.rotation.reasons,
                    viewerAvailable: summary.rotation.viewerAvailable,
                  }
                : null
            }
          />

          {props.knockPanel}

          {summary.costMinor != null ? (
            !props.isPast ? (
              <div className="rounded-button bg-surface border border-ink-hairline-1 px-4 py-3 flex items-center gap-3">
                <p className="text-cu-body text-ink flex-1">
                  {formatMoney(summary.costMinor, summary.costCurrency)} court
                  {summary.costPerHeadMinor != null && (
                    <>
                      {" · "}
                      <strong>{formatMoney(summary.costPerHeadMinor, summary.costCurrency)} each</strong>
                    </>
                  )}
                  {" · goes on the Tab"}
                </p>
                <Meta className="whitespace-nowrap">{props.durationMinutes} min</Meta>
              </div>
            ) : (
              <div className="rounded-button bg-surface border border-ink-hairline-1 px-4 py-3 flex flex-col gap-2.5">
                <p className="text-cu-body text-ink font-mono">
                  {formatMoney(summary.costMinor, summary.costCurrency)} court
                  {summary.costPerHeadMinor != null && ` · ${formatMoney(summary.costPerHeadMinor, summary.costCurrency)} each`}
                  {` · ${props.durationMinutes} min`}
                </p>
                <form action={props.createSplitAction}>
                  <Button type="submit" variant={props.alreadySplit ? "quiet" : "primary"} disabled={props.alreadySplit} fullWidth>
                    {props.alreadySplit ? "Split on the Tab ✓" : "Goes on the Tab"}
                  </Button>
                </form>
              </div>
            )
          ) : (
            <div className="rounded-button bg-surface border border-ink-hairline-1 px-4 py-3 flex flex-col gap-2">
              <Link href={`/circles/${summary.circleId}/tab`} className="flex items-center gap-3">
                <span className="text-cu-body text-ink flex-1">Court split goes on the Tab</span>
                <Meta tone="action">The Tab →</Meta>
              </Link>
              {props.viewerIsOrganiser && summary.standingGame && (
                <Meta as="p">
                  Set a court cost on the{" "}
                  <Link href={`/games/standing/${summary.standingGame.id}`} className="font-bold text-action-strong">
                    Standing Game
                  </Link>{" "}
                  and it splits in one tap here.
                </Meta>
              )}
            </div>
          )}

          {props.isPast &&
            (props.existingMatchId ? (
              <Link
                href={`/matches/${props.existingMatchId}`}
                className="rounded-button min-h-12 px-5 py-3.5 text-center text-[15px] font-extrabold transition-cu-state active:opacity-80 bg-transparent text-ink border border-ink-hairline-4"
              >
                View result
              </Link>
            ) : (
              <div className="rounded-card bg-surface border border-ink-hairline-1 px-4 py-4 flex flex-col gap-2.5">
                <div>
                  <Meta as="p" className="uppercase tracking-[0.12em] font-extrabold">
                    Played
                  </Meta>
                  <p className="text-cu-body text-ink mt-1">Log the result so everyone&apos;s Glass moves, the other team just confirms it.</p>
                </div>
                <Link
                  href={`/matches/new?session=${summary.session.id}`}
                  className="rounded-button min-h-12 px-5 py-3.5 text-center text-[15px] font-extrabold bg-strong-bg text-strong-fg transition-cu-state active:opacity-80"
                >
                  Log last night&apos;s result
                </Link>
              </div>
            ))}
        </div>

        <div className="flex flex-col gap-3">
          {summary.venue && (
            <VenueMapCard venueName={summary.venue.name} venueAddress={summary.venue.address ?? null} pinLocationAction={props.pinLocationAction} />
          )}
          {showRingsPanel && <FourthCallRingsPanel circleName={summary.circleName} fourthCallHref={props.fourthCallHref} />}
          {isOneOff && (
            <div className="font-mono text-[10px] leading-relaxed text-ink-muted">
              one-offs work like fixtures, minus the repeat. No rotation, no reserve queue, no money unless the organiser adds it
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
