import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { listCirclesForUser } from "@/server/standing-games-service";
import { createStandingGameAction } from "@/server/games-actions";
import { Button, Meta } from "@/components/ui";

const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const fieldClass =
  "rounded-button p-3 text-[14px] bg-surface border border-ink-hairline-3 text-ink outline-none";

export default async function NewStandingGamePage({
  searchParams,
}: {
  searchParams: Promise<{ circleId?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;

  const { circleId: preselectedCircleId } = await searchParams;
  const { db } = await getGamesClient();
  const organiserCircles = listCirclesForUser(db, user.id).filter((c) => c.role === "organiser");

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <h1 className="text-cu-title text-ink">New Standing Game</h1>

      {organiserCircles.length === 0 ? (
        <Meta as="p">You need to be an organiser of a Circle to create its Standing Game.</Meta>
      ) : (
        <form action={createStandingGameAction} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
            Circle
            <select name="circleId" required defaultValue={preselectedCircleId} className={fieldClass}>
              {organiserCircles.map((c) => (
                <option key={c.circleId} value={c.circleId}>
                  {c.circleName}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
            Day
            <select name="weekday" required defaultValue={2} className={fieldClass}>
              {WEEKDAYS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
            Start time
            <input type="time" name="startTime" required defaultValue="20:00" className={fieldClass} />
          </label>

          <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
            Venue
            <input type="text" name="venueName" placeholder="e.g. Powerleague Shoreditch" className={fieldClass} />
          </label>

          <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
            Duration (minutes)
            <input type="number" name="durationMinutes" defaultValue={90} min={30} step={15} className={fieldClass} />
          </label>

          <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
            Slots
            <input type="number" name="slots" defaultValue={4} min={2} max={8} className={fieldClass} />
          </label>

          <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
            RSVP window (days out)
            <input type="number" name="rsvpWindowDays" defaultValue={6} min={1} max={21} className={fieldClass} />
          </label>

          <Button type="submit" size="lg" fullWidth>
            Create Standing Game
          </Button>
        </form>
      )}
    </main>
  );
}
