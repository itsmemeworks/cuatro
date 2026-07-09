import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { getMatchesStore } from "@/server/matches-db";
import { getSessionSummary } from "@/server/games-service";
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
        <Link href={`/games/${sessionId}`} className="text-cu-secondary font-bold text-action">
          ‹ Game
        </Link>
        <h1 className="text-cu-title text-ink">Almost — who played?</h1>
        <Card className="flex flex-col gap-3">
          <p className="text-cu-body text-ink-muted">
            A result needs the four who played marked as in — right now there {players.length === 1 ? "is" : "are"}{" "}
            {players.length}. Open the game to confirm the four (or send a Fourth Call to fill the last spot), then come
            back to log it.
          </p>
          <Link
            href={`/games/${sessionId}`}
            className="rounded-button min-h-11 flex items-center justify-center text-[14px] font-extrabold bg-strong-bg text-strong-fg"
          >
            Go to the game
          </Link>
        </Card>
      </main>
    );
  }

  // Avatars + Circle name aren't on matches-db's own read model (that store
  // has no reason to carry them) — games-service.ts already computes both
  // for this same session, so read from there rather than duplicating a
  // query. Player-list validation above still goes through matches-db's own
  // getSessionForEntry untouched.
  const { db } = await getDb();
  const summary = getSessionSummary(db, sessionId, user.id);
  const avatarById = new Map((summary?.confirmed ?? []).map((p) => [p.userId, p.avatarUrl]));

  const entryPlayers: ResultEntryPlayer[] = await Promise.all(
    players.map(async (p) => {
      const glass = await store.getProfileGlassView(p.id);
      return {
        id: p.id,
        displayName: p.displayName,
        rating: glass?.status === "rated" ? glass.rating : null,
        avatarUrl: avatarById.get(p.id) ?? null,
      };
    }),
  );

  return (
    <main className="px-4 pt-6 pb-6 flex flex-col gap-5">
      <Link href={`/games/${sessionId}`} className="text-cu-secondary font-bold text-action">
        ‹ Game
      </Link>

      <div>
        <h1 className="text-cu-title text-ink">How did it go?</h1>
        <Meta className="mt-1 block">
          {session.startsAt.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
          {summary?.circleName && ` · ${summary.circleName}`}
        </Meta>
      </div>

      <ResultEntryForm sessionId={sessionId} players={entryPlayers} viewerId={user.id} />

      <p className="text-cu-meta text-ink-muted text-center px-6">
        Glass moves only when both teams confirm — no referee, no disputes desk
      </p>
    </main>
  );
}
