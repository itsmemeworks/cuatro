import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { listCirclesForUser, listStandingGamesForCircle } from "@/server/standing-games-service";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function StandingGamesPage() {
  const user = await getSessionUser();
  if (!user) return null;

  const { db } = await getGamesClient();
  const memberships = listCirclesForUser(db, user.id);
  const groups = memberships.map((m) => ({
    ...m,
    standingGames: listStandingGamesForCircle(db, m.circleId),
  }));

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Standing Games</h1>
        <Link href="/games/standing/new" className="text-sm font-medium" style={{ color: "var(--c4-accent)" }}>
          + New
        </Link>
      </div>

      {groups.length === 0 && (
        <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
          Join a Circle to see its Standing Games here.
        </p>
      )}

      {groups.map((group) => (
        <section key={group.circleId} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--c4-text-muted)" }}>
            {group.circleName}
          </h2>
          {group.standingGames.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
              No Standing Game yet.
            </p>
          ) : (
            group.standingGames.map((sg) => (
              <Link
                key={sg.id}
                href={`/games/standing/${sg.id}`}
                className="rounded-2xl p-4 flex items-center justify-between gap-3"
                style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
              >
                <div>
                  <p className="font-medium">
                    {WEEKDAY_LABELS[sg.weekday]} {sg.startTime}
                  </p>
                  <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
                    {sg.slots} slots · RSVP opens {sg.rsvpWindowDays}d out
                  </p>
                </div>
                <span
                  className="text-xs font-semibold rounded-full px-2 py-1"
                  style={{
                    background: sg.active ? "var(--c4-accent)" : "var(--c4-bg-elevated-2)",
                    color: sg.active ? "var(--c4-accent-contrast)" : "var(--c4-text-muted)",
                  }}
                >
                  {sg.active ? "Active" : "Paused"}
                </span>
              </Link>
            ))
          )}
        </section>
      ))}
    </main>
  );
}
