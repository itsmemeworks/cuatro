import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { notifications, users } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { checkFourthCallLevel1, getSessionSummary, lockRotationIfDue, offerRotationSlotIfNeeded, DEFAULT_SESSION_DURATION_MINUTES } from "@/server/games-service";
import { hasFourthCallInvite } from "@/server/fourth-call";
import { isOrganiser } from "@/server/standing-games-service";
import { getMatchesStore } from "@/server/matches-db";
import { listNotificationsForUser } from "@/server/notifications";
import { hasTabSplitForSession } from "@/server/session-tab";
import { createTabSplitForSessionAction } from "@/server/session-tab-actions";
import { pinVenueLocationAction } from "@/server/pin-location-actions";
import { KnockPanel, type KnockRow } from "@/components/games/knock-panel";
import { sessionKnocks } from "@/server/discovery";
import { FourthCallReceive } from "@/components/circle-screens/fourth-call-receive";
import { ToastBoundary } from "@/components/circle-screens/toast-boundary";
import { sessionOgImageUrl } from "@/lib/og";
import { GameDetail } from "@/components/circle-screens/wide/wide-game-detail";

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
  const summary = await getSessionSummary(db, sessionId, "");

  if (!summary) {
    return { title: "CUATRO game" };
  }

  const when = new Date(summary.session.startsAt).toLocaleString("en-GB", {
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
  // Lazy trigger (no cron in v0): a rotation game at/after T-24h locks its four
  // on this first view, before the summary is read, so the page shows the
  // locked lineup and the lock notifications fire. No-op for non-rotation games.
  await lockRotationIfDue(db, sessionId);
  const summary = await getSessionSummary(db, sessionId, user.id);
  if (!summary) notFound();

  // Lazy triggers (no cron in v0): a locked rotation game offers an open spot
  // to the next sit-out first; the Fourth Call only broadcasts once that chain
  // is exhausted (or the game isn't a locked rotation game).
  const offer = await offerRotationSlotIfNeeded(db, sessionId);
  if (offer.state === "exhausted" || offer.state === "not_applicable") {
    await checkFourthCallLevel1(db, sessionId);
  }

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
    !isPast && summary.viewerStatus !== "in" && (await hasFourthCallInvite(db, sessionId, user.id));

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

    const notifGroups = await listNotificationsForUser(db, user.id);
    const passNotificationId =
      notifGroups
        .flatMap((g) => g.notifications)
        .find((n) => n.type === "fourth_call" && n.href === `/games/${sessionId}`)?.id ?? null;

    // A level-2 (extended-network / Local Ring) fourth_call invite switches the
    // takeover to the "near you" framing; level 1 is the viewer's own Circle.
    // Postgres JSONB operators (`->>`), NOT SQLite's json_extract — this arm
    // only runs for an invite-holding viewer, so the SQLite-era syntax survived
    // the Postgres conversion unnoticed until the rotation-offer flow hit it.
    const [nearbyRow] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, user.id),
          eq(notifications.type, "fourth_call"),
          sql`${notifications.payload} ->> 'sessionId' = ${sessionId}`,
          sql`${notifications.payload} ->> 'level' = '2'`,
        ),
      );
    const nearby = !!nearbyRow;

    return (
      <main className="px-5 pt-8 pb-6">
        <ToastBoundary>
          <FourthCallReceive
            sessionId={sessionId}
            circleName={summary.circleName}
            whenLabel={new Date(summary.session.startsAt).toLocaleString("en-GB", {
              weekday: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
            venueLabel={summary.venue?.name ?? null}
            confirmed={summary.confirmed}
            levelMatchLabel={levelMatchLabel}
            expiresAt={new Date(summary.session.startsAt)}
            passNotificationId={passNotificationId}
            viewerId={user.id}
            nearby={nearby}
            sideHint={summary.session.fourthCallSideHint ?? null}
          />
        </ToastBoundary>
      </main>
    );
  }

  const gameFull = summary.confirmed.length >= summary.slots;
  const upcoming = summary.session.status === "upcoming" && Date.now() < summary.session.startsAt;
  const viewerIsOrganiser = await isOrganiser(db, summary.circleId, user.id);

  // Pending asks-to-join (Board knocks) — only the organiser decides them.
  const knockRows: KnockRow[] = viewerIsOrganiser
    ? (await sessionKnocks(db, sessionId)).map((k) => ({
        knockId: k.knockId,
        userId: k.userId,
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
  const alreadySplit = isPast && summary.costMinor != null ? await hasTabSplitForSession(db, sessionId) : false;
  const boundCreateSplit = createTabSplitForSessionAction.bind(null, sessionId);
  const boundPinLocation = summary.venue
    ? pinVenueLocationAction.bind(null, summary.circleId, summary.venue.name, summary.venue.address ?? null)
    : null;

  const standingGameTitle = summary.standingGame
    ? `${WEEKDAY_NAMES[summary.standingGame.weekday]}s, ${formatStartTime(summary.standingGame.startTime)}`
    : new Date(summary.session.startsAt).toLocaleString("en-GB", { weekday: "long", hour: "numeric", minute: "2-digit" });
  const rsvpWindowDays = Math.max(1, Math.round((summary.session.startsAt - summary.rsvpWindowOpensAt.getTime()) / (24 * 60 * 60 * 1000)));

  // Plain one-line state confirmation at the top — the pattern every
  // Playtomic-fluent user already reads for free ("You are enrolled…").
  // Upcoming games only; the "Played" card below owns the past state.
  // Roster enrichment for the hero: each player's Glass (the roster is the
  // reason you open this screen, so level reads at a glance) and their guest
  // flag (guests have no profile, so they render unlinked). Page-level reads
  // over the existing stores — small (a four plus a short reserve queue), and
  // Glass reuses the same getProfileGlassView the Fourth Call path above uses.
  const rosterPlayers = [
    ...summary.confirmed,
    ...summary.reserves,
    // Rotation games carry their four/sit-out in `rotation` (confirmed/reserves
    // are empty pre-lock), so include those players in the Glass enrichment too.
    ...(summary.rotation ? [...summary.rotation.lineup, ...summary.rotation.sitting] : []),
  ].filter((p, i, arr) => arr.findIndex((q) => q.userId === p.userId) === i);
  const glassByUserId: Record<string, number | null> = {};
  await Promise.all(
    [{ userId: user.id }, ...rosterPlayers].map(async (p) => {
      glassByUserId[p.userId] = (await matchesStore.getProfileGlassView(p.userId))?.rating ?? null;
    }),
  );
  const guestByUserId: Record<string, boolean> = {};
  if (rosterPlayers.length > 0) {
    const guestRows = await db
      .select({ id: users.id, isGuest: users.isGuest })
      .from(users)
      .where(inArray(users.id, rosterPlayers.map((p) => p.userId)));
    for (const row of guestRows) guestByUserId[row.id] = row.isGuest;
  }

  const whenShort = new Date(summary.session.startsAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const rsvpWindowOpen = upcoming && Date.now() >= summary.rsvpWindowOpensAt.getTime();
  let viewerStatusLine: string | null = null;
  if (upcoming) {
    const rotationLocked = summary.rotation?.lockedAt != null;
    if (summary.viewerStatus === "in")
      viewerStatusLine = summary.rotation && rotationLocked ? `You're in this week ✓ · ${whenShort}` : `You're in ✓ · ${whenShort}`;
    else if (summary.viewerStatus === "reserve")
      viewerStatusLine = summary.rotation && rotationLocked ? `You're sitting out this week, first in next · ${whenShort}` : `You're on the reserve list · ${whenShort}`;
    else if (summary.rotation && !rotationLocked && summary.rotation.viewerAvailable)
      viewerStatusLine = `You're available this week · ${whenShort}`;
    else if (summary.viewerStatus === "out")
      viewerStatusLine = summary.rotation ? "You said you're not available this week" : "You said you can't make this one";
    else if (rsvpWindowOpen) viewerStatusLine = "You haven't answered yet";
  }

  return (
    <ToastBoundary>
      <GameDetail
        summary={summary}
        viewer={{ id: user.id, displayName: user.displayName || user.email.split("@")[0] || "You", avatarUrl: user.avatarUrl }}
        glassByUserId={glassByUserId}
        guestByUserId={guestByUserId}
        viewerIsOrganiser={viewerIsOrganiser}
        upcoming={upcoming}
        gameFull={gameFull}
        isPast={isPast}
        existingMatchId={existingMatch?.id ?? null}
        alreadySplit={alreadySplit}
        createSplitAction={boundCreateSplit}
        pinLocationAction={boundPinLocation}
        standingGameTitle={standingGameTitle}
        rsvpWindowDays={rsvpWindowDays}
        durationMinutes={durationMinutes}
        fourthCallHref={`/games/${sessionId}/fourth-call`}
        viewerStatusLine={viewerStatusLine}
        knockPanel={viewerIsOrganiser && knockRows.length > 0 ? <KnockPanel knocks={knockRows} /> : null}
        rotationOfferUserId={offer.state === "waiting" || offer.state === "offered" ? offer.userId : null}
      />
    </ToastBoundary>
  );
}
