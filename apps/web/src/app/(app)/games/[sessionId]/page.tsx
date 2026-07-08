import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { checkFourthCallLevel1, getSessionSummary, isFourthCallActive } from "@/server/games-service";
import { hasFourthCallInvite } from "@/server/fourth-call";
import { getMatchesStore } from "@/server/matches-db";
import { SessionCard, type SessionCardData } from "@/components/games/SessionCard";
import { ClaimFourthCallButton } from "@/components/games/ClaimFourthCallButton";

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
  const existingMatch = isPast ? await (await getMatchesStore()).getMatchForSession(sessionId) : null;

  // One-tap claim: a Fourth Call invitee (level 1 or 2) who hasn't already
  // taken the slot can tap straight in from here — this is where their
  // notification's deep link lands (see server/notify.ts's deepLinkFor).
  const showClaimButton =
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

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-4">
      <Link href="/games" className="text-sm font-medium" style={{ color: "var(--c4-accent)" }}>
        ← Games
      </Link>
      <SessionCard data={card} viewerUserId={user.id} />

      {showClaimButton && <ClaimFourthCallButton sessionId={sessionId} />}

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
