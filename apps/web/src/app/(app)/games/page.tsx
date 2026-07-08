import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { listUpcomingSessionsForUser, isFourthCallActive } from "@/server/games-service";
import { SessionCard, type SessionCardData } from "@/components/games/SessionCard";

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
        <h1 className="text-2xl font-semibold">Games</h1>
        <Link href="/games/standing" className="text-sm font-medium" style={{ color: "var(--c4-accent)" }}>
          Manage
        </Link>
      </div>

      {cards.length === 0 ? (
        <div
          className="rounded-2xl p-5 flex flex-col gap-1"
          style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
        >
          <p className="font-medium">No games yet</p>
          <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
            Once a Circle you&apos;re in has an active Standing Game, its next session shows up here
            automatically — RSVP without leaving the app.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {cards.map((c) => (
            <Link key={c.sessionId} href={`/games/${c.sessionId}`} className="block">
              <SessionCard data={c} viewerUserId={user.id} />
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
