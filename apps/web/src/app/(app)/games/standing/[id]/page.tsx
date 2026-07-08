import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { getStandingGame, isOrganiser } from "@/server/standing-games-service";
import { toggleStandingGameActiveAction, updateStandingGameAction } from "@/server/games-actions";

const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const fieldStyle = { background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" };

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
      <h1 className="text-2xl font-semibold">Standing Game</h1>

      {!canManage ? (
        <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
          Only Circle organisers can edit this Standing Game.
        </p>
      ) : (
        <>
          <form action={boundToggle}>
            <button
              type="submit"
              className="rounded-xl py-3 px-4 text-sm font-semibold"
              style={{
                background: standingGame.active ? "transparent" : "var(--c4-accent)",
                color: standingGame.active ? "var(--c4-danger)" : "var(--c4-accent-contrast)",
                border: standingGame.active ? "1px solid var(--c4-danger)" : "none",
              }}
            >
              {standingGame.active ? "Pause Standing Game" : "Reactivate Standing Game"}
            </button>
          </form>

          <form action={boundUpdate} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              Day
              <select name="weekday" defaultValue={standingGame.weekday} className="rounded-lg p-3" style={fieldStyle}>
                {WEEKDAYS.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Start time
              <input type="time" name="startTime" defaultValue={standingGame.startTime} className="rounded-lg p-3" style={fieldStyle} />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Duration (minutes)
              <input
                type="number"
                name="durationMinutes"
                defaultValue={standingGame.durationMinutes}
                min={30}
                step={15}
                className="rounded-lg p-3"
                style={fieldStyle}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Slots
              <input type="number" name="slots" defaultValue={standingGame.slots} min={2} max={8} className="rounded-lg p-3" style={fieldStyle} />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              RSVP window (days out)
              <input
                type="number"
                name="rsvpWindowDays"
                defaultValue={standingGame.rsvpWindowDays}
                min={1}
                max={21}
                className="rounded-lg p-3"
                style={fieldStyle}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Venue
              <input type="text" name="venueName" placeholder="Leave blank to keep current venue" className="rounded-lg p-3" style={fieldStyle} />
            </label>

            <button
              type="submit"
              className="rounded-xl py-3 text-sm font-semibold"
              style={{ minHeight: "var(--c4-touch-target)", background: "var(--c4-accent)", color: "var(--c4-accent-contrast)" }}
            >
              Save changes
            </button>
          </form>
        </>
      )}
    </main>
  );
}
