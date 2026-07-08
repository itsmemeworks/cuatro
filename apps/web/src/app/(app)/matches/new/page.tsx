import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getMatchesStore } from "@/server/matches-db";
import { ResultEntryForm, type ResultEntryPlayer } from "@/components/matches/result-entry-form";
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
            Start this from a played session — open it from Home and tap &ldquo;Log last night&apos;s result&rdquo;.
          </p>
        </Card>
      </main>
    );
  }

  const store = await getMatchesStore();
  const data = await store.getSessionForEntry(sessionId);

  if (!data) {
    return (
      <main className="px-4 pt-6 pb-6 flex flex-col gap-4">
        <h1 className="text-cu-title text-ink">How did it go?</h1>
        <Card>
          <p className="text-cu-body text-ink-muted">That session couldn&apos;t be found.</p>
        </Card>
      </main>
    );
  }

  const { players, session } = data;

  if (players.length !== 4) {
    return (
      <main className="px-4 pt-6 pb-6 flex flex-col gap-4">
        <h1 className="text-cu-title text-ink">How did it go?</h1>
        <Card>
          <p className="text-cu-body text-ink-muted">
            This session needs exactly four confirmed players before a result can be recorded (currently {players.length}).
          </p>
        </Card>
      </main>
    );
  }

  const entryPlayers: ResultEntryPlayer[] = await Promise.all(
    players.map(async (p) => {
      const glass = await store.getProfileGlassView(p.id);
      return { id: p.id, displayName: p.displayName, rating: glass?.status === "rated" ? glass.rating : null };
    }),
  );

  return (
    <main className="px-4 pt-6 pb-6 flex flex-col gap-5">
      <div>
        <h1 className="text-cu-title text-ink">How did it go?</h1>
        <Meta className="mt-1 block">
          {session.startsAt.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </Meta>
      </div>

      <ResultEntryForm sessionId={sessionId} players={entryPlayers} viewerId={user.id} />

      <p className="text-cu-meta text-ink-muted text-center px-6">
        Glass moves only when both teams confirm — no referee, no disputes desk
      </p>
    </main>
  );
}
