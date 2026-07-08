import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { getStandingGame, isOrganiser } from "@/server/standing-games-service";
import { toggleStandingGameActiveAction, updateStandingGameAction } from "@/server/games-actions";
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

export default async function EditStandingGamePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return null;

  const { id } = await params;
  const { db } = await getGamesClient();
  const standingGame = getStandingGame(db, id);
  if (!standingGame) notFound();

  const canManage = isOrganiser(db, standingGame.circleId, user.id);
  const boundUpdate = updateStandingGameAction.bind(null, id);
  const boundToggle = toggleStandingGameActiveAction.bind(null, id, !standingGame.active);

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <h1 className="text-cu-title text-ink">Standing Game</h1>

      {!canManage ? (
        <Meta as="p">Only Circle organisers can edit this Standing Game.</Meta>
      ) : (
        <>
          <form action={boundToggle}>
            <Button type="submit" variant={standingGame.active ? "destructiveQuiet" : "primary"} fullWidth>
              {standingGame.active ? "Pause Standing Game" : "Reactivate Standing Game"}
            </Button>
          </form>

          <form action={boundUpdate} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
              Day
              <select name="weekday" defaultValue={standingGame.weekday} className={fieldClass}>
                {WEEKDAYS.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
              Start time
              <input type="time" name="startTime" defaultValue={standingGame.startTime} className={fieldClass} />
            </label>

            <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
              Duration (minutes)
              <input
                type="number"
                name="durationMinutes"
                defaultValue={standingGame.durationMinutes}
                min={30}
                step={15}
                className={fieldClass}
              />
            </label>

            <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
              Slots
              <input type="number" name="slots" defaultValue={standingGame.slots} min={2} max={8} className={fieldClass} />
            </label>

            <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
              RSVP window (days out)
              <input
                type="number"
                name="rsvpWindowDays"
                defaultValue={standingGame.rsvpWindowDays}
                min={1}
                max={21}
                className={fieldClass}
              />
            </label>

            <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
              Venue
              <input type="text" name="venueName" placeholder="Leave blank to keep current venue" className={fieldClass} />
            </label>

            <Button type="submit" size="lg" fullWidth>
              Save changes
            </Button>
          </form>
        </>
      )}
    </main>
  );
}
