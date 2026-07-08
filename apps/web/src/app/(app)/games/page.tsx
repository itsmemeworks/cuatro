import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { listUpcomingSessionsForUser, isFourthCallActive } from "@/server/games-service";
import { SessionCardWithToast } from "@/components/circle-screens/session-card-with-toast";
import { ToastBoundary } from "@/components/circle-screens/toast-boundary";
import { Card } from "@/components/ui";
import type { SessionCardData } from "@/components/games/SessionCard";

export default async function GamesPage() {
  const user = await getSessionUser();
  if (!user) return null; // (app) layout already redirects unauthenticated visitors

  const { db } = await getGamesClient();
  const summaries = listUpcomingSessionsForUser(db, user.id);

  const cards: SessionCardData[] = summaries.map((s) => ({
    sessionId: s.session.id,
    circleId: s.circleId,
    circleName: s.circleName,
    venueName: s.venue?.name ?? null,
    startsAt: s.session.startsAt,
    slots: s.slots,
    confirmed: s.confirmed,
    reserves: s.reserves,
    viewerStatus: s.viewerStatus,
    rsvpWindowOpensAt: s.rsvpWindowOpensAt,
    fourthCallActive: isFourthCallActive(s),
  }));

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-cu-title text-ink">Games</h1>
        <Link href="/games/standing" className="text-cu-body font-bold text-action">
          Manage
        </Link>
      </div>

      {cards.length === 0 ? (
        <Card className="flex flex-col gap-1">
          <p className="text-cu-card-title text-ink">No games yet</p>
          <p className="text-cu-body text-ink-muted">
            Once a Circle you&apos;re in has an active Standing Game, its next session shows up here automatically —
            RSVP without leaving the app.
          </p>
        </Card>
      ) : (
        <ToastBoundary>
          <div className="flex flex-col gap-4">
            {cards.map((c) => (
              <SessionCardWithToast key={c.sessionId} data={c} viewerUserId={user.id} linkToSession />
            ))}
          </div>
        </ToastBoundary>
      )}
    </main>
  );
}
