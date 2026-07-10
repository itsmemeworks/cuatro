import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { listCirclesForUser, listStandingGamesForCircle } from "@/server/standing-games-service";
import { Card, Chip, Meta } from "@/components/ui";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function StandingGamesPage() {
  const user = await getSessionUser();
  if (!user) return null;

  const { db } = await getGamesClient();
  const memberships = await listCirclesForUser(db, user.id);
  const groups = await Promise.all(
    memberships.map(async (m) => ({
      ...m,
      standingGames: await listStandingGamesForCircle(db, m.circleId),
    })),
  );

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-cu-title text-ink">Standing Games</h1>
        <Link href="/games/standing/new" className="text-cu-body font-bold text-action">
          + New
        </Link>
      </div>

      {groups.length === 0 && <Meta as="p">Join a Circle to see its Standing Games here.</Meta>}

      {groups.map((group) => (
        <section key={group.circleId} className="flex flex-col gap-3">
          <Meta as="h2" className="uppercase tracking-[0.12em]">
            {group.circleName}
          </Meta>
          {group.standingGames.length === 0 ? (
            <Meta as="p">No Standing Game yet.</Meta>
          ) : (
            group.standingGames.map((sg) => (
              <Link key={sg.id} href={`/games/standing/${sg.id}`} className="block">
                <Card className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-cu-card-title text-ink" style={{ fontSize: 15 }}>
                      {WEEKDAY_LABELS[sg.weekday]} {sg.startTime}
                    </p>
                    <Meta as="p" className="mt-1">
                      {sg.slots} slots · RSVP opens {sg.rsvpWindowDays}d out
                    </Meta>
                  </div>
                  <Chip tone={sg.active ? "positive" : "neutral"}>{sg.active ? "Active" : "Paused"}</Chip>
                </Card>
              </Link>
            ))
          )}
        </section>
      ))}
    </main>
  );
}
