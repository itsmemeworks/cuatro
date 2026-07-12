import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getMatchesStore } from "@/server/matches-db";
import { RosterEntry } from "@/components/matches/roster-entry";
import { FriendlyBadge } from "@/components/matches/friendly-badge";
import { RecordResultOverlay, type RecordableGameRow, type WideRosterContext } from "@/components/matches/wide/record-result-overlay";
import { Card, Meta } from "@/components/ui";
import { DEFAULT_TZ, formatDate } from "@/lib/time";

export default async function NewMatchPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { session: sessionId } = await searchParams;
  const store = await getMatchesStore();

  // The wide (>=900px) experience is the design's 5-step overlay; its step 1
  // ("Which game was it?") needs the viewer's recent played games whether or
  // not a session was passed. The phone flow below stays exactly as it was.
  const recordable = await store.getRecordableSessions(user.id);
  const games: RecordableGameRow[] = recordable.map((g) => ({
    sessionId: g.sessionId,
    startsAtMs: g.startsAt.getTime(),
    circleId: g.circleId,
    circleName: g.circleName,
    venueName: g.venueName,
    gameType: g.gameType,
    match: g.match,
  }));

  if (!sessionId) {
    return (
      <>
        <main className="px-4 pt-6 pb-6 flex flex-col gap-4 min-[900px]:hidden">
          <h1 className="text-cu-title text-ink">How did it go?</h1>
          <Card>
            <p className="text-cu-body text-ink-muted">
              Start this from a played session, open it from Home and tap &ldquo;Log last night&apos;s result&rdquo;.
            </p>
          </Card>
        </main>
        <div className="hidden min-[900px]:block">
          <RecordResultOverlay games={games} roster={null} viewerId={user.id} />
        </div>
      </>
    );
  }

  const roster = await store.getRosterContext(sessionId, user.id);

  if (!roster) {
    return (
      <>
        <main className="px-4 pt-6 pb-6 flex flex-col gap-4 min-[900px]:hidden">
          <h1 className="text-cu-title text-ink">How did it go?</h1>
          <Card>
            <p className="text-cu-body text-ink-muted">That session couldn&apos;t be found.</p>
          </Card>
        </main>
        <div className="hidden min-[900px]:block">
          <RecordResultOverlay games={games} roster={null} viewerId={user.id} />
        </div>
      </>
    );
  }

  const wideRoster: WideRosterContext = {
    sessionId,
    startsAtMs: roster.session.startsAt.getTime(),
    gameType: roster.session.gameType,
    circleName: roster.circleName,
    venueName: games.find((g) => g.sessionId === sessionId)?.venueName ?? null,
    confirmed: roster.confirmed,
    candidates: roster.candidates,
    viewerGlass: roster.viewerGlass,
  };

  return (
    <>
      <main className="px-4 pt-6 pb-6 flex flex-col gap-5 min-[900px]:hidden">
        <Link href={`/games/${sessionId}`} className="text-cu-secondary font-bold text-action">
          ‹ Game
        </Link>

        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-cu-title text-ink">How did it go?</h1>
            {roster.session.gameType === "friendly" && <FriendlyBadge />}
          </div>
          <Meta className="mt-1 block">
            {/* DEFAULT_TZ stopgap (F2 §5): the roster context carries no venue/circle tz; correct for UK launch, guard-compliant. */}
            {formatDate(roster.session.startsAt, DEFAULT_TZ)}
            {roster.circleName && ` · ${roster.circleName}`}
          </Meta>
        </div>

        <RosterEntry
          sessionId={sessionId}
          viewerId={user.id}
          confirmed={roster.confirmed}
          candidates={roster.candidates}
        />

        <p className="text-cu-meta text-ink-muted text-center px-6">
          {roster.session.gameType === "friendly"
            ? "This one's a friendly, so Glass stays put. The score, Reliability and your played-with all still count once both teams confirm."
            : "Glass moves only when both teams confirm, no referee, no disputes desk"}
        </p>
      </main>

      <div className="hidden min-[900px]:block">
        <RecordResultOverlay games={games} roster={wideRoster} viewerId={user.id} />
      </div>
    </>
  );
}
