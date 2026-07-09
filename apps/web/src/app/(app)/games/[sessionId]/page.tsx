import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { checkFourthCallLevel1, getSessionSummary, isFourthCallActive } from "@/server/games-service";
import { hasFourthCallInvite } from "@/server/fourth-call";
import { isOrganiser } from "@/server/standing-games-service";
import { getMatchesStore } from "@/server/matches-db";
import { listNotificationsForUser } from "@/server/notifications";
import { SessionCard, type SessionCardData } from "@/components/games/SessionCard";
import { FourthCallReceive } from "@/components/circle-screens/fourth-call-receive";
import { ToastBoundary } from "@/components/circle-screens/toast-boundary";
import { Meta } from "@/components/ui";
import { sessionOgImageUrl } from "@/lib/og";

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
      ? `${summary.confirmed.length} of ${summary.slots} in — one spot left. Tap to join.`
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

  const card: SessionCardData = {
    sessionId: summary.session.id,
    circleId: summary.circleId,
    circleName: summary.circleName,
    venueName: summary.venue?.name ?? null,
    startsAt: summary.session.startsAt,
    slots: summary.slots,
    confirmed: summary.confirmed,
    reserves: summary.reserves,
    viewerStatus: summary.viewerStatus,
    rsvpWindowOpensAt: summary.rsvpWindowOpensAt,
    fourthCallActive: isFourthCallActive(summary),
  };

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
          />
        </ToastBoundary>
      </main>
    );
  }

  const gameFull = summary.confirmed.length >= summary.slots;
  const upcoming = summary.session.status === "upcoming" && Date.now() < summary.session.startsAt.getTime();
  const viewerIsOrganiser = isOrganiser(db, summary.circleId, user.id);

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-4">
      <Link href="/home" className="text-cu-body font-bold text-action-strong">
        ‹ Games
      </Link>

      <ToastBoundary>
        <SessionCard data={card} viewerUserId={user.id} />
      </ToastBoundary>

      {upcoming && !gameFull && viewerIsOrganiser && (
        <Link
          href={`/games/${sessionId}/fourth-call`}
          className="rounded-button border border-ink-hairline-3 text-ink font-bold text-[13px] py-3.5 text-center transition-cu-state active:opacity-80"
        >
          Find a 4th →
        </Link>
      )}

      <Link
        href={`/circles/${summary.circleId}/tab`}
        className="rounded-button bg-surface border border-ink-hairline-1 px-4 py-3 flex items-center gap-3"
      >
        <span className="text-cu-body text-ink flex-1">Court split goes on the Tab</span>
        <Meta tone="action">The Tab →</Meta>
      </Link>

      {isPast && (
        <Link
          href={existingMatch ? `/matches/${existingMatch.id}` : `/matches/new?session=${sessionId}`}
          className={`rounded-button min-h-12 px-5 py-3.5 text-center text-[15px] font-extrabold transition-cu-state active:opacity-80 ${
            existingMatch ? "bg-transparent text-ink border border-ink-hairline-4" : "bg-strong-bg text-strong-fg"
          }`}
        >
          {existingMatch ? "View result" : "Log last night's result"}
        </Link>
      )}
    </main>
  );
}
