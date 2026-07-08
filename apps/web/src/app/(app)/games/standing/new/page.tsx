import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { listCirclesForUser } from "@/server/standing-games-service";
import { createStandingGameAction } from "@/server/games-actions";

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

export default async function NewStandingGamePage() {
  const user = await getSessionUser();
  if (!user) return null;

  const { db } = await getGamesClient();
  const organiserCircles = listCirclesForUser(db, user.id).filter((c) => c.role === "organiser");

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">New Standing Game</h1>

      {organiserCircles.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
          You need to be an organiser of a Circle to create its Standing Game.
        </p>
      ) : (
        <form action={createStandingGameAction} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Circle
            <select name="circleId" required className="rounded-lg p-3" style={fieldStyle}>
              {organiserCircles.map((c) => (
                <option key={c.circleId} value={c.circleId}>
                  {c.circleName}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Day
            <select name="weekday" required defaultValue={2} className="rounded-lg p-3" style={fieldStyle}>
              {WEEKDAYS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Start time
            <input type="time" name="startTime" required defaultValue="20:00" className="rounded-lg p-3" style={fieldStyle} />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Venue
            <input
              type="text"
              name="venueName"
              placeholder="e.g. Powerleague Shoreditch"
              className="rounded-lg p-3"
              style={fieldStyle}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Duration (minutes)
            <input type="number" name="durationMinutes" defaultValue={90} min={30} step={15} className="rounded-lg p-3" style={fieldStyle} />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Slots
            <input type="number" name="slots" defaultValue={4} min={2} max={8} className="rounded-lg p-3" style={fieldStyle} />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            RSVP window (days out)
            <input type="number" name="rsvpWindowDays" defaultValue={6} min={1} max={21} className="rounded-lg p-3" style={fieldStyle} />
          </label>

          <button
            type="submit"
            className="rounded-xl py-3 text-sm font-semibold"
            style={{ minHeight: "var(--c4-touch-target)", background: "var(--c4-accent)", color: "var(--c4-accent-contrast)" }}
          >
            Create Standing Game
          </button>
        </form>
      )}
    </main>
  );
}
