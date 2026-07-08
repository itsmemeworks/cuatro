import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { checkFourthCallLevel1, getSessionSummary, isFourthCallActive } from "@/server/games-service";
import { SessionCard, type SessionCardData } from "@/components/games/SessionCard";

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

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-4">
      <Link href="/games" className="text-sm font-medium" style={{ color: "var(--c4-accent)" }}>
        ← Games
      </Link>
      <SessionCard data={card} viewerUserId={user.id} />
    </main>
  );
}
