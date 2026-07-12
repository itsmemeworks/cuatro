import Link from "next/link";
import type { ReactNode } from "react";
import type { PlayerRef, SessionSummary } from "@/server/games-service";
import { StandingGameWeekCard } from "@/components/games/StandingGameWeekCard";
import { VenueMapCard } from "@/components/games/venue-map-card";
import { BookingChip } from "@/components/games/booking-chip";
import { FriendlyBadge } from "@/components/matches/friendly-badge";
import { CircleEmblem } from "@/components/games/roster";
import { CirclePreviewTrigger } from "@/components/discover/circle-preview-sheet";
import { AskToJoinCard } from "@/components/discover/ask-to-join-card";
import { Avatar, Button, DashedSlot, Fact, Meta, SubmitButton } from "@/components/ui";
import { formatMoneyWhole } from "@/components/tab/money";
import { formatGlass } from "@/lib/design";
import { RotationWideMain, RotationWideAside } from "./wide-rotation";
import { rotationModePill } from "./wide-rotation-model";
import { gameBackTarget } from "./wide-game-detail-model";
import { formatDate } from "@/lib/time";

export interface GameDetailProps {
  summary: SessionSummary;
  viewer: { id: string; displayName: string; avatarUrl: string | null };
  glassByUserId: Record<string, number | null>;
  guestByUserId: Record<string, boolean>;
  viewerIsOrganiser: boolean;
  /** The viewer belongs to the game's Circle. Non-members (game reads are ungated) get the shop-window treatment: Discover back-link, circle preview, read-only roster, the ask affordance — never member chrome. */
  viewerIsMember: boolean;
  /** Non-member only: the Circle is discoverable, so its name may open the public preview sheet. */
  circlePreviewEnabled: boolean;
  /** Non-member only: the ask-to-join affordance (null hides it — full, past, window shut, or the viewer already holds a place). */
  outsiderAsk: { initialPending: boolean } | null;
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
  /** Who currently holds the live consent offer on a locked rotation game (server-decided), if anyone. */
  rotationOfferUserId?: string | null;
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
      <Link href={fourthCallHref} className="mt-1.5 block bg-action text-action-contrast rounded-[13px] text-center py-3 font-sans font-extrabold text-[13.5px] transition-cu-state hover:opacity-90">
        Send the call
      </Link>
      <div className="mt-2 text-center font-mono text-[10px] text-ink-muted">closest people first, then wider if it stays quiet</div>
    </div>
  );
}

/**
 * The NON-member roster: who's in, as read-only facts (no RSVP buttons, no
 * rotation controls — those mutations are member-gated server-side, so
 * showing them to an outsider would be a wall of error toasts). Dashed coral
 * circles mark the open spots as ever; a pre-lock rotation game has no held
 * slots, so it says so instead of faking certainty.
 */
function OutsiderRosterPanel({
  confirmed,
  slots,
  upcoming,
  rotationForming,
  glassByUserId,
  viewerId,
}: {
  confirmed: PlayerRef[];
  slots: number;
  upcoming: boolean;
  rotationForming: boolean;
  glassByUserId: Record<string, number | null>;
  viewerId: string;
}) {
  const open = Math.max(0, slots - confirmed.length);
  return (
    <div className="rounded-card bg-surface border border-ink-hairline-1 px-4 py-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Meta as="p" className="uppercase tracking-[0.12em] font-extrabold">
          Who&apos;s in
        </Meta>
        <Fact size="meta" tone="muted">
          {confirmed.length} of {slots}
        </Fact>
      </div>
      {confirmed.map((p) => {
        const glass = glassByUserId[p.userId] ?? null;
        const row = (
          <>
            <Avatar src={p.avatarUrl} name={p.displayName} size="md" />
            <span className="text-cu-body text-ink flex-1 min-w-0 truncate">
              {p.displayName}
              {p.userId === viewerId ? " (you)" : ""}
            </span>
            {glass != null ? (
              <Fact size="md" weight="bold">
                {formatGlass(glass)}
              </Fact>
            ) : (
              <Meta>not rated yet</Meta>
            )}
          </>
        );
        // Guests have no profile to link to; everyone else links to their public profile.
        return p.isGuest || p.userId === viewerId ? (
          <div key={p.userId} className="flex items-center gap-3">
            {row}
          </div>
        ) : (
          <Link
            key={p.userId}
            href={`/players/${p.userId}`}
            className="flex items-center gap-3 -mx-2 px-2 py-1 rounded-button transition-cu-state hover:bg-ink-hairline-1"
          >
            {row}
          </Link>
        );
      })}
      {rotationForming ? (
        <Meta as="p">THE ROTATION picks this four closer to game time</Meta>
      ) : (
        upcoming &&
        open > 0 && (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5" aria-hidden>
              {Array.from({ length: Math.min(open, 4) }, (_, i) => (
                <DashedSlot key={i} size="md" label="" overlap={i > 0} />
              ))}
            </span>
            <Meta as="span">
              {open === 1 ? "one spot open" : `${open} spots open`}
            </Meta>
          </div>
        )
      )}
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
  // Booking signpost XOR court cost XOR silence (issue #21), resolved by
  // getSessionSummary — a resolved booking silences cost by construction,
  // so render from THIS and never re-derive cost chrome.
  const moneyOptIn = summary.moneyOptIn;
  const rotationLocked = summary.rotation?.lockedAt != null;
  // One client-safe rotation view, shared by the phone card and the wide panels.
  const rotationView = summary.rotation
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
    : null;

  // A rotation game keeps its Fourth Call / offer handling inside the roster
  // card; a plain standing game surfaces the rings panel instead (never both).
  const rotationCanSendFourthCall = isRotation && props.viewerIsOrganiser && props.upcoming && !props.gameFull;
  const showRingsPanel = props.viewerIsOrganiser && props.upcoming && !props.gameFull && !isOneOff && !isRotation;

  const eyebrow = isOneOff ? "ONE-OFF SESSION" : isRotation ? "STANDING GAME · THE ROTATION" : "STANDING GAME";
  const subline = isOneOff
    ? "single session · no recurrence"
    : `repeats weekly · RSVPs open ${props.rsvpWindowDays} ${props.rsvpWindowDays === 1 ? "day" : "days"} before`;

  // Members go back to their Circle's games; a non-member gets Discover — the
  // circle pages are members-only and 404 on outsiders (Pete, 2026-07-11).
  const back = gameBackTarget(props.viewerIsMember, summary.circleId);

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-4 c4-wide min-[900px]:px-[30px] min-[900px]:pt-0 min-[900px]:pb-0 min-[900px]:max-w-[1000px] min-[900px]:mx-auto">
      <Link href={back.href} className="text-cu-secondary font-bold text-action transition-cu-state hover:underline">
        {back.label}
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
          {/* NON-member only: the circle identity, tappable into the Circle's
              public preview sheet — the natural "who are these people" moment
              (members arrive from the circle, so they get no extra row). A
              private Circle's name stays plain text. */}
          {!props.viewerIsMember &&
            (props.circlePreviewEnabled ? (
              <CirclePreviewTrigger
                circleId={summary.circleId}
                circleName={summary.circleName}
                className="mt-2.5 flex items-center gap-2 max-w-full min-w-0 text-left group"
              >
                <CircleEmblem
                  seed={summary.circleId}
                  name={summary.circleName}
                  emblem={summary.circleEmblem}
                  colour={summary.circleColour}
                  px={20}
                />
                <span className="text-cu-secondary font-bold text-ink truncate transition-cu-state group-hover:underline">
                  {summary.circleName}
                </span>
              </CirclePreviewTrigger>
            ) : (
              <span className="mt-2.5 flex items-center gap-2 min-w-0">
                <CircleEmblem
                  seed={summary.circleId}
                  name={summary.circleName}
                  emblem={summary.circleEmblem}
                  colour={summary.circleColour}
                  px={20}
                />
                <span className="text-cu-secondary font-bold text-ink truncate">{summary.circleName}</span>
              </span>
            ))}
        </div>
        {/* Wide-only header meta (design "Circle · Rotation game"): the Booked-on
            pill, the rotation contract pill, and — where slots are literal —
            the open-spot count. A pre-lock rotation game has no held slots, so
            its "open" count would be a lie; the pills carry the state instead. */}
        {moneyOptIn?.kind === "booking" && (
          <span className="hidden min-[900px]:inline-flex items-center rounded-full border border-ink-hairline-2 py-1 pl-1 pr-2.5 mb-1 whitespace-nowrap">
            <BookingChip booking={moneyOptIn.booking} size={20} />
          </span>
        )}
        {isRotation && summary.standingGame && (
          <span className="hidden min-[900px]:inline-block rounded-full border border-ink-hairline-2 px-3 py-[5px] mb-1 font-mono text-[10px] font-semibold text-ink-muted whitespace-nowrap">
            {rotationModePill(summary.standingGame.rotationMode, summary.standingGame.rotationCutoffHours)}
          </span>
        )}
        {props.upcoming && open > 0 && (!isRotation || rotationLocked) && (
          <span className="hidden min-[900px]:block font-mono text-[11.5px] font-bold text-action-strong pb-1 whitespace-nowrap">
            {open} SPOT{open === 1 ? "" : "S"} OPEN
          </span>
        )}
      </div>

      <div className="flex flex-col gap-4 min-[900px]:grid min-[900px]:grid-cols-2 min-[900px]:gap-4 min-[900px]:items-start">
        <div className="flex flex-col gap-4 min-w-0">
          {/* NON-member (shop window): read-only roster + the ask affordance,
              never the RSVP/rotation machinery (member-gated mutations). */}
          {!props.viewerIsMember && (
            <>
              <OutsiderRosterPanel
                confirmed={summary.confirmed}
                slots={summary.slots}
                upcoming={props.upcoming}
                rotationForming={isRotation && !rotationLocked}
                glassByUserId={props.glassByUserId}
                viewerId={viewer.id}
              />
              {props.outsiderAsk && (
                <AskToJoinCard
                  sessionId={summary.session.id}
                  gameLabel={`${summary.circleName} · ${props.standingGameTitle}${summary.venue ? ` · ${summary.venue.name}` : ""}`}
                  slotsOpen={open}
                  initialPending={props.outsiderAsk.initialPending}
                />
              )}
            </>
          )}

          {/* A rotation game swaps this phone card for the design's wide
              anatomy at 900+ (RotationWideMain/Aside below). The card stays
              MOUNTED (display:contents, then display:none at 900+) because it
              holds the session's single realtime subscription — its
              router.refresh() is what keeps the wide panels live. */}
          {props.viewerIsMember && (
          <div className={isRotation ? "contents min-[900px]:hidden" : "contents"}>
            <StandingGameWeekCard
              sessionId={summary.session.id}
              circleId={summary.circleId}
              circleName={summary.circleName}
              circleColour={summary.circleColour}
              circleEmblem={summary.circleEmblem}
              weekLabel={formatDate(summary.session.startsAt, summary.timezone)}
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
              rotation={rotationView}
            />
          </div>
          )}

          {props.viewerIsMember && rotationView && (
            <div className="hidden min-[900px]:block">
              <RotationWideMain
                sessionId={summary.session.id}
                slots={summary.slots}
                startsAtMs={summary.session.startsAt}
                timeZone={summary.timezone}
                rsvpWindowOpensAtMs={summary.rsvpWindowOpensAt.getTime()}
                viewerUserId={viewer.id}
                viewerStatus={summary.viewerStatus}
                rotation={rotationView}
                canSendFourthCall={rotationCanSendFourthCall}
                fourthCallHref={props.fourthCallHref}
                glassByUserId={props.glassByUserId}
                guestByUserId={props.guestByUserId}
              />
            </div>
          )}

          {props.knockPanel}

          {/* The money opt-in row (issue #21): a booked-on game shows its
              signpost and NOTHING else — the booking silenced the cost by
              construction, so no split/cost chrome may render beside it.
              SILENCE (no opt-in, the default) shows NOTHING AT ALL: a game
              carries no money unless the organiser opted in, so any Tab
              module here would be payment chrome on a money-less game
              (issue #21 acceptance; QA4 blocker 2). */}
          {moneyOptIn?.kind === "booking" ? (
            <div className="rounded-button bg-surface border border-ink-hairline-1 px-4 py-3 flex items-center gap-3">
              <BookingChip booking={moneyOptIn.booking} />
              <Meta className="flex-1 text-right whitespace-nowrap">booked and paid there, the Tab stays out of it</Meta>
            </div>
          ) : moneyOptIn?.kind === "cost" && props.viewerIsMember ? (
            !props.isPast ? (
              <div className="rounded-button bg-surface border border-ink-hairline-1 px-4 py-3 flex items-center gap-3">
                <p className="text-cu-body text-ink flex-1">
                  {formatMoneyWhole(moneyOptIn.amountMinor, moneyOptIn.currency)} court
                  {summary.costPerHeadMinor != null && (
                    <>
                      {" · "}
                      <strong>{formatMoneyWhole(summary.costPerHeadMinor, moneyOptIn.currency)} each</strong>
                    </>
                  )}
                  {" · goes on the Tab"}
                </p>
                <Meta className="whitespace-nowrap">{props.durationMinutes} min</Meta>
              </div>
            ) : (
              <div className="rounded-button bg-surface border border-ink-hairline-1 px-4 py-3 flex flex-col gap-2.5">
                <p className="text-cu-body text-ink font-mono">
                  {formatMoneyWhole(moneyOptIn.amountMinor, moneyOptIn.currency)} court
                  {summary.costPerHeadMinor != null && ` · ${formatMoneyWhole(summary.costPerHeadMinor, moneyOptIn.currency)} each`}
                  {` · ${props.durationMinutes} min`}
                </p>
                <form action={props.createSplitAction}>
                  <SubmitButton variant={props.alreadySplit ? "quiet" : "primary"} disabled={props.alreadySplit} fullWidth>
                    {props.alreadySplit ? "Split on the Tab ✓" : "Goes on the Tab"}
                  </SubmitButton>
                </form>
              </div>
            )
          ) : null}

          {/* Result chrome is members' business — recording who played and the
              Tab are inside-the-circle acts, so the outsider page stops at the
              facts above. */}
          {props.viewerIsMember &&
            props.isPast &&
            (props.existingMatchId ? (
              <Link
                href={`/matches/${props.existingMatchId}`}
                className="rounded-button min-h-12 px-5 py-3.5 text-center text-[15px] font-extrabold transition-cu-state hover:bg-ink-hairline-1 active:opacity-80 bg-transparent text-ink border border-ink-hairline-4"
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
                  className="rounded-button min-h-12 px-5 py-3.5 text-center text-[15px] font-extrabold bg-strong-bg text-strong-fg transition-cu-state hover:opacity-90 active:opacity-80"
                >
                  Log last night&apos;s result
                </Link>
              </div>
            ))}
        </div>

        <div className="flex flex-col gap-3">
          {/* Rotation, wide: the fair-share ranked list (pre-lock) or the
              consent-offer cascade (locked + a spot open, organiser view). */}
          {props.viewerIsMember && rotationView && props.upcoming && (
            <div className="hidden min-[900px]:block">
              <RotationWideAside
                slots={summary.slots}
                viewerUserId={viewer.id}
                rotation={rotationView}
                viewerIsOrganiser={props.viewerIsOrganiser}
                offerUserId={props.rotationOfferUserId ?? null}
                guestByUserId={props.guestByUserId}
              />
            </div>
          )}
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
