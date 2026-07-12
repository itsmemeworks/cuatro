import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getMatchesStore } from "@/server/matches-db";
import { RosterEntry } from "@/components/matches/roster-entry";
import { AdHocEntry } from "@/components/matches/adhoc-entry";
import { FriendlyBadge } from "@/components/matches/friendly-badge";
import {
  RecordResultOverlay,
  type AdHocCircleRow,
  type RecordableGameRow,
  type WideRosterContext,
} from "@/components/matches/wide/record-result-overlay";
import { Card, Meta } from "@/components/ui";
import { circleColorFor } from "@/lib/design";
import { DEFAULT_TZ, formatDate } from "@/lib/time";

export default async function NewMatchPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; adhoc?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { session: sessionId, adhoc: adhocCircleId } = await searchParams;
  const store = await getMatchesStore();

  // The wide (>=900px) experience is the design's 5-step overlay; its step 1
  // ("Which game was it?") needs the viewer's recent played games whether or
  // not a session was passed, plus the circles an ad-hoc match could anchor
  // on (issue #28). The phone flow below stays exactly as it was.
  const [recordable, adhocOptions] = await Promise.all([store.getRecordableSessions(user.id), store.getAdHocCircles(user.id)]);
  const games: RecordableGameRow[] = recordable.map((g) => ({
    sessionId: g.sessionId,
    startsAtMs: g.startsAt.getTime(),
    circleId: g.circleId,
    circleName: g.circleName,
    venueName: g.venueName,
    gameType: g.gameType,
    match: g.match,
  }));
  const adhocCircles: AdHocCircleRow[] = adhocOptions.map((c) => ({
    circleId: c.circleId,
    circleName: c.circleName,
    gameType: c.gameType,
    memberCount: c.memberCount,
  }));

  // Ad-hoc mode (issue #28): a circle was picked, no session exists — the
  // roster is the circle's members with the recorder pre-seated, and the
  // synthetic session is minted inside the recording transaction.
  if (!sessionId && adhocCircleId) {
    const adhocRoster = await store.getAdHocRosterContext(adhocCircleId, user.id);
    if (adhocRoster) {
      const wideRoster: WideRosterContext = {
        sessionId: null,
        startsAtMs: Date.now(),
        gameType: adhocRoster.gameType,
        circleName: adhocRoster.circleName,
        venueName: null,
        adhoc: { circleId: adhocRoster.circleId },
        confirmed: adhocRoster.confirmed,
        candidates: adhocRoster.candidates,
        viewerGlass: adhocRoster.viewerGlass,
      };
      return (
        <>
          <main className="px-4 pt-6 pb-6 flex flex-col gap-5 min-[900px]:hidden">
            <Link href="/matches/new" className="text-cu-secondary font-bold text-action">
              ‹ Record a result
            </Link>
            <div>
              <h1 className="text-cu-title text-ink">How did it go?</h1>
              <Meta className="mt-1 block">Ad-hoc match · {adhocRoster.circleName}</Meta>
            </div>
            <AdHocEntry
              circleId={adhocRoster.circleId}
              circleName={adhocRoster.circleName}
              defaultGameType={adhocRoster.gameType}
              viewerId={user.id}
              confirmed={adhocRoster.confirmed}
              candidates={adhocRoster.candidates}
            />
          </main>
          <div className="hidden min-[900px]:block">
            <RecordResultOverlay games={games} roster={wideRoster} adhocCircles={adhocCircles} viewerId={user.id} />
          </div>
        </>
      );
    }
    // Not a member (or the circle vanished) — fall through to the picker states below.
  }

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
          {adhocCircles.length > 0 && (
            <Card className="flex flex-col gap-3">
              <div>
                <h2 className="text-cu-card-title text-ink">Ad-hoc match</h2>
                <Meta className="mt-1 block">No session, no problem. Pick the circle it belongs to.</Meta>
              </div>
              <ul className="flex flex-col">
                {adhocCircles.map((c) => (
                  <li key={c.circleId}>
                    <Link
                      href={`/matches/new?adhoc=${c.circleId}`}
                      className="flex items-center gap-2.5 py-2.5 active:opacity-70 hover:bg-ink-hairline-1 transition-cu-state rounded-button"
                    >
                      <span
                        className="w-[26px] h-[26px] rounded-[9px] text-white font-sans font-extrabold text-[10px] leading-[26px] text-center flex-none"
                        style={{ background: circleColorFor(c.circleId) }}
                      >
                        {c.circleName
                          .split(/\s+/)
                          .map((w) => w[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()}
                      </span>
                      <span className="flex-1 min-w-0 text-cu-body font-bold text-ink truncate">{c.circleName}</span>
                      <Meta>
                        {c.memberCount} {c.memberCount === 1 ? "player" : "players"}
                      </Meta>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </main>
        <div className="hidden min-[900px]:block">
          <RecordResultOverlay games={games} roster={null} adhocCircles={adhocCircles} viewerId={user.id} />
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
          <RecordResultOverlay games={games} roster={null} adhocCircles={adhocCircles} viewerId={user.id} />
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
        <RecordResultOverlay games={games} roster={wideRoster} adhocCircles={adhocCircles} viewerId={user.id} />
      </div>
    </>
  );
}
