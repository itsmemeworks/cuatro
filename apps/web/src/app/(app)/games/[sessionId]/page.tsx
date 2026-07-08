import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { checkFourthCallLevel1, getSessionSummary, isFourthCallActive } from "@/server/games-service";
import { getMatchesStore } from "@/server/matches-db";
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

  // Cross-link to result entry: v0 has no cron to flip a session's status
  // to "played" (see games-service.ts's session-instantiation comments), so
  // "has this game already happened?" is judged the same way the rest of
  // the app judges it — by kickoff time, not the (mostly unused) status
  // column.
  const isPast = summary.session.startsAt.getTime() < Date.now();
  const existingMatch = isPast ? await (await getMatchesStore()).getMatchForSession(sessionId) : null;

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

      {isPast && (
        <Link
          href={existingMatch ? `/matches/${existingMatch.id}` : `/matches/new?session=${sessionId}`}
          className="rounded-xl py-3.5 text-center text-sm font-semibold"
          style={{
            minHeight: "var(--c4-touch-target)",
            background: existingMatch ? "transparent" : "var(--c4-accent)",
            color: existingMatch ? "var(--c4-accent)" : "var(--c4-accent-contrast)",
            border: existingMatch ? "1px solid var(--c4-accent)" : "none",
          }}
        >
          {existingMatch ? "View result" : "Record result"}
        </Link>
      )}
    </main>
  );
}
