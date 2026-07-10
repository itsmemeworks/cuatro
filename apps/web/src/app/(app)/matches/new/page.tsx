import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getMatchesStore } from "@/server/matches-db";
import { RosterEntry } from "@/components/matches/roster-entry";
import { FriendlyBadge } from "@/components/matches/friendly-badge";
import { Card, Meta } from "@/components/ui";

export default async function NewMatchPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { session: sessionId } = await searchParams;
  if (!sessionId) {
    return (
      <main className="px-4 pt-6 pb-6 flex flex-col gap-4">
        <h1 className="text-cu-title text-ink">How did it go?</h1>
        <Card>
          <p className="text-cu-body text-ink-muted">
            Start this from a played session, open it from Home and tap &ldquo;Log last night&apos;s result&rdquo;.
          </p>
        </Card>
      </main>
    );
  }

  const store = await getMatchesStore();
  const roster = await store.getRosterContext(sessionId, user.id);

  if (!roster) {
    return (
      <main className="px-4 pt-6 pb-6 flex flex-col gap-4">
        <h1 className="text-cu-title text-ink">How did it go?</h1>
        <Card>
          <p className="text-cu-body text-ink-muted">That session couldn&apos;t be found.</p>
        </Card>
      </main>
    );
  }

  return (
    <main className="px-4 pt-6 pb-6 flex flex-col gap-5">
      <Link href={`/games/${sessionId}`} className="text-cu-secondary font-bold text-action">
        ‹ Game
      </Link>

      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-cu-title text-ink">How did it go?</h1>
          {roster.session.gameType === "friendly" && <FriendlyBadge />}
        </div>
        <Meta className="mt-1 block">
          {roster.session.startsAt.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
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
  );
}
