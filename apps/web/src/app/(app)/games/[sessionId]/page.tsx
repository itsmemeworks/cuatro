import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { notifications } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { checkFourthCallLevel1, getSessionSummary, DEFAULT_SESSION_DURATION_MINUTES } from "@/server/games-service";
import { hasFourthCallInvite } from "@/server/fourth-call";
import { isOrganiser } from "@/server/standing-games-service";
import { getMatchesStore } from "@/server/matches-db";
import { listNotificationsForUser } from "@/server/notifications";
import { hasTabSplitForSession } from "@/server/session-tab";
import { createTabSplitForSessionAction } from "@/server/session-tab-actions";
import { pinVenueLocationAction } from "@/server/pin-location-actions";
import { StandingGameWeekCard } from "@/components/games/StandingGameWeekCard";
import { VenueMapCard } from "@/components/games/venue-map-card";
import { KnockPanel, type KnockRow } from "@/components/games/knock-panel";
import { sessionKnocks } from "@/server/discovery";
import { FourthCallReceive } from "@/components/circle-screens/fourth-call-receive";
import { ToastBoundary } from "@/components/circle-screens/toast-boundary";
import { Button, Meta } from "@/components/ui";
import { sessionOgImageUrl } from "@/lib/og";
import { formatMoney } from "@/components/tab/money";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "20:00" -> "8pm", "20:30" -> "8:30pm" — the standing game's fixed start time, mirrored from games/standing/[id]'s own display convention. */
function formatStartTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const period = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${period}` : `${h12}:${mStr}${period}`;
}

// getSessionSummary has no membership gate on reads (only the RSVP mutations
// do — see server/games-service.ts), so this is safe to build without a
// signed-in viewer: a share-card crawler hits this route with no session
// cookie, same trust model as join/[code]'s generateMetadata.
export async function generateMetadata({ params }: { params: Promise<{ sessionId: string }> }): Promise<Metadata> {
  const { sessionId } = await params;
  const { db } = await getGamesClient();
  const summary = getSessionSummary(db, sessionId, "");

  if (!summary) {
    return { title: "CUATRO game" };
  }

  const when = summary.session.startsAt.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const title = `${summary.circleName} · ${when}`;
  const openSlots = summary.slots - summary.confirmed.length;
  const description =
    openSlots > 0
      ? `${summary.confirmed.length} of ${summary.slots} in, one spot left. Tap to join.`
      : `${summary.circleName}'s four is set for ${when}.`;
  const image = sessionOgImageUrl(sessionId);

  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;

  const { sessionId } = await params;
  const { db } = await getGamesClient();
  const summary = getSessionSummary(db, sessionId, user.id);
  if (!summary) notFound();

  // Lazy trigger: viewing a session's detail page is one of the "views" the
  // Fourth Call level-1 check runs on (see games-service.ts — no cron in v0).
  checkFourthCallLevel1(db, sessionId);

  // "Has this game already happened?" is judged by the session's own
  // status column, which getSessionSummary (via
  // ensureSessionPlayedTransition) just lazily flipped upcoming -> played
  // if startsAt + duration has passed — replaces the old raw
  // startsAt-vs-now comparison, which could gate "Record result" open
  // before a match had actually finished.
  const isPast = summary.session.status === "played";
  const matchesStore = await getMatchesStore();
  const existingMatch = isPast ? await matchesStore.getMatchForSession(sessionId) : null;

  // One-tap claim: a Fourth Call invitee (level 1 or 2) who hasn't already
  // taken the slot lands on a full-screen invite (prototype screen 6,
  // receive) instead of the normal session view.
  const showReceiveScreen =
    !isPast && summary.viewerStatus !== "in" && hasFourthCallInvite(db, sessionId, user.id);

  if (showReceiveScreen) {
    const ratings = (
      await Promise.all(
        summary.confirmed.map(async (p) => (await matchesStore.getProfileGlassView(p.userId))?.rating ?? null),
      )
    ).filter((r): r is number => r != null);
    const viewerGlass = await matchesStore.getProfileGlassView(user.id);

    let levelMatchLabel: string | null = null;
    if (ratings.length > 0) {
      const min = Math.min(...ratings).toFixed(2);
      const max = Math.max(...ratings).toFixed(2);
      const theirs = min === max ? min : `${min}–${max}`;
      levelMatchLabel = `their level ${theirs} · yours ${viewerGlass?.rating != null ? viewerGlass.rating.toFixed(2) : "?.??"}`;
    }

    const notifGroups = listNotificationsForUser(db, user.id);
    const passNotificationId =
      notifGroups
        .flatMap((g) => g.notifications)
        .find((n) => n.type === "fourth_call" && n.href === `/games/${sessionId}`)?.id ?? null;

    // A level-2 (extended-network / Local Ring) fourth_call invite switches the
    // takeover to the "near you" framing; level 1 is the viewer's own Circle.
    const nearby = !!db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, user.id),
          eq(notifications.type, "fourth_call"),
          sql`json_extract(${notifications.payload}, '$.sessionId') = ${sessionId}`,
          sql`json_extract(${notifications.payload}, '$.level') = 2`,
        ),
      )
      .get();

    return (
      <main className="px-5 pt-8 pb-6">
        <ToastBoundary>
          <FourthCallReceive
            sessionId={sessionId}
            circleName={summary.circleName}
            whenLabel={summary.session.startsAt.toLocaleString("en-GB", {
              weekday: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
            venueLabel={summary.venue?.name ?? null}
            confirmed={summary.confirmed}
            levelMatchLabel={levelMatchLabel}
            expiresAt={summary.session.startsAt}
            passNotificationId={passNotificationId}
            viewerId={user.id}
            nearby={nearby}
          />
        </ToastBoundary>
      </main>
    );
  }

  const gameFull = summary.confirmed.length >= summary.slots;
  const upcoming = summary.session.status === "upcoming" && Date.now() < summary.session.startsAt.getTime();
  const viewerIsOrganiser = isOrganiser(db, summary.circleId, user.id);

  // Pending asks-to-join (Board knocks) — only the organiser decides them.
  const knockRows: KnockRow[] = viewerIsOrganiser
    ? (await sessionKnocks(db, sessionId)).map((k) => ({
        knockId: k.knockId,
        displayName: k.displayName,
        avatarUrl: k.avatarUrl,
        message: k.message,
        levelLabel: k.rating != null ? `Glass ${k.rating.toFixed(2)}` : "Unrated",
        reliabilityLabel: k.reliabilityPct != null ? `Shows up ${k.reliabilityPct}%` : null,
        lateCancelCount: k.lateCancelCount,
        distanceLabel: k.distanceLabel,
      }))
    : [];

  const durationMinutes = summary.standingGame?.durationMinutes ?? DEFAULT_SESSION_DURATION_MINUTES;
  const alreadySplit = isPast && summary.costMinor != null ? hasTabSplitForSession(db, sessionId) : false;
  const boundCreateSplit = createTabSplitForSessionAction.bind(null, sessionId);
  const boundPinLocation = summary.venue
    ? pinVenueLocationAction.bind(null, summary.circleId, summary.venue.name, summary.venue.address ?? null)
    : null;

  const standingGameTitle = summary.standingGame
    ? `${WEEKDAY_NAMES[summary.standingGame.weekday]}s, ${formatStartTime(summary.standingGame.startTime)}`
    : summary.session.startsAt.toLocaleString("en-GB", { weekday: "long", hour: "numeric", minute: "2-digit" });
  const rsvpWindowDays = Math.max(1, Math.round((summary.session.startsAt.getTime() - summary.rsvpWindowOpensAt.getTime()) / (24 * 60 * 60 * 1000)));

  // Plain one-line state confirmation at the top — the pattern every
  // Playtomic-fluent user already reads for free ("You are enrolled…").
  // Upcoming games only; the "Played" card below owns the past state.
  const whenShort = summary.session.startsAt.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const rsvpWindowOpen = upcoming && Date.now() >= summary.rsvpWindowOpensAt.getTime();
  let viewerStatusLine: string | null = null;
  if (upcoming) {
    if (summary.viewerStatus === "in") viewerStatusLine = `You're in ✓ · ${whenShort}`;
    else if (summary.viewerStatus === "reserve") viewerStatusLine = `You're on the reserve list · ${whenShort}`;
    else if (summary.viewerStatus === "out") viewerStatusLine = "You said you can't make this one";
    else if (rsvpWindowOpen) viewerStatusLine = "You haven't answered yet";
  }

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-4">
      <Link href="/home" className="text-cu-secondary font-bold text-action">
        ‹ Back
      </Link>

      {viewerStatusLine && (
        <div
          className={`rounded-button px-4 py-2.5 text-cu-body font-bold ${
            summary.viewerStatus === "in" ? "bg-win-tint text-win" : "bg-surface border border-ink-hairline-1 text-ink"
          }`}
        >
          {viewerStatusLine}
        </div>
      )}

      <div>
        <Meta as="p" className="uppercase tracking-[0.12em]">
          Standing Game · {summary.circleName}
        </Meta>
        <h1 className="text-cu-title text-ink mt-1.5 leading-tight">
          {standingGameTitle}
          {summary.venue && (
            <>
              <br />
              {summary.venue.name}
            </>
          )}
        </h1>
        <Meta as="p" className="mt-1.5">
          repeats weekly · RSVPs open {rsvpWindowDays} {rsvpWindowDays === 1 ? "day" : "days"} before
        </Meta>
      </div>

      <ToastBoundary>
        <StandingGameWeekCard
          sessionId={sessionId}
          weekLabel={summary.session.startsAt.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
          slots={summary.slots}
          confirmed={summary.confirmed}
          reserves={summary.reserves}
          viewerUserId={user.id}
          viewerDisplayName={user.displayName || user.email.split("@")[0] || "You"}
          viewerAvatarUrl={user.avatarUrl}
          viewerStatus={summary.viewerStatus}
          rsvpWindowOpensAt={summary.rsvpWindowOpensAt}
          startsAt={summary.session.startsAt}
          canSendFourthCall={upcoming && !gameFull && viewerIsOrganiser}
          fourthCallHref={`/games/${sessionId}/fourth-call`}
        />
      </ToastBoundary>

      {viewerIsOrganiser && knockRows.length > 0 && <KnockPanel knocks={knockRows} />}

      {summary.costMinor != null ? (
        !isPast ? (
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
            <Meta className="whitespace-nowrap">{durationMinutes} min</Meta>
          </div>
        ) : (
          <div className="rounded-button bg-surface border border-ink-hairline-1 px-4 py-3 flex flex-col gap-2.5">
            <p className="text-cu-body text-ink font-mono">
              {formatMoney(summary.costMinor, summary.costCurrency)} court
              {summary.costPerHeadMinor != null && ` · ${formatMoney(summary.costPerHeadMinor, summary.costCurrency)} each`}
              {` · ${durationMinutes} min`}
            </p>
            <form action={boundCreateSplit}>
              <Button type="submit" variant={alreadySplit ? "quiet" : "primary"} disabled={alreadySplit} fullWidth>
                {alreadySplit ? "Split on the Tab ✓" : "Goes on the Tab"}
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
          {viewerIsOrganiser && summary.standingGame && (
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

      {summary.venue && (
        <VenueMapCard venueName={summary.venue.name} venueAddress={summary.venue.address ?? null} pinLocationAction={boundPinLocation} />
      )}

      {isPast &&
        (existingMatch ? (
          <Link
            href={`/matches/${existingMatch.id}`}
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
              <p className="text-cu-body text-ink mt-1">
                Log the result so everyone&apos;s Glass moves, the other team just confirms it.
              </p>
            </div>
            <Link
              href={`/matches/new?session=${sessionId}`}
              className="rounded-button min-h-12 px-5 py-3.5 text-center text-[15px] font-extrabold bg-strong-bg text-strong-fg transition-cu-state active:opacity-80"
            >
              Log last night&apos;s result
            </Link>
          </div>
        ))}
    </main>
  );
}
