import { inArray } from "drizzle-orm";
import { circles } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { listCirclesForUser } from "@/server/standing-games-service";
import { listVenuesForCircle } from "@/server/venues";
import { createStandingGameAction } from "@/server/games-actions";
import { errorCopy } from "@/lib/error-copy";
import { Button, Meta } from "@/components/ui";
import { InfoTerm } from "@/components/ui/info-term";
import { VenuePicker } from "../venue-picker";

// Organiser-facing copy for the validation codes createStandingGameAction can
// bounce back; anything unlisted falls through to the shared errorCopy() so no
// raw slug is ever shown.
const CREATE_ERROR_COPY: Record<string, string> = {
  not_an_organiser: "Only a Circle's organiser can set up its Standing Game.",
  invalid_weekday: "Pick a day of the week and try again.",
  invalid_start_time: "That start time didn't read right, pick it again.",
};

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
  searchParams: Promise<{ circleId?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;

  const { circleId: preselectedCircleId, error } = await searchParams;
  const { db } = await getGamesClient();
  const organiserCircles = (await listCirclesForUser(db, user.id)).filter((c) => c.role === "organiser");
  // Order the venue dropdown by the circle the form will open on (preselected,
  // else the first organiser circle). The full list of known venues shows
  // regardless of circle; only the home-court-first ordering is circle-specific.
  const orderingCircleId = preselectedCircleId ?? organiserCircles[0]?.circleId;
  const venueOptions = orderingCircleId ? await listVenuesForCircle(db, orderingCircleId) : [];

  // FRIENDLIES: the game-type control defaults to the circle's own default. With
  // multiple organiser circles the default reflects the one the form opens on
  // (preselected, else the first); switching the Circle dropdown does not
  // re-default it, so the organiser sets it explicitly — it is always an
  // explicit value on submit, never "inherit".
  const organiserCircleIds = organiserCircles.map((c) => c.circleId);
  const defaultTypeRows = organiserCircleIds.length
    ? await db.select({ id: circles.id, defaultGameType: circles.defaultGameType }).from(circles).where(inArray(circles.id, organiserCircleIds))
    : [];
  const defaultTypeByCircle = new Map(defaultTypeRows.map((r) => [r.id, r.defaultGameType]));
  const initialGameType = (orderingCircleId && defaultTypeByCircle.get(orderingCircleId)) ?? "competitive";

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <div>
        <h1 className="text-cu-title text-ink">New Standing Game</h1>
        <Meta as="p" className="mt-1.5">
          A Standing Game is your weekly fixture, it opens the RSVP on its own so nobody has to chase.
        </Meta>
      </div>

      {error && (
        <Meta as="p" tone="loss">
          {CREATE_ERROR_COPY[error] ?? errorCopy(error)}
        </Meta>
      )}

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

          <VenuePicker venues={venueOptions} />

          <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
            Court cost (optional, splits on the Tab)
            <input type="text" name="costAmount" inputMode="decimal" placeholder="32.00" className={fieldClass} />
          </label>

          <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
            Duration (minutes)
            <Meta as="span" className="font-normal">how long you&apos;ve booked the court for</Meta>
            <input type="number" name="durationMinutes" defaultValue={90} min={30} step={15} className={fieldClass} />
          </label>

          <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
            Slots
            <Meta as="span" className="font-normal">how many players each game holds (4 for doubles)</Meta>
            <input type="number" name="slots" defaultValue={4} min={2} max={8} className={fieldClass} />
          </label>

          <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
            RSVP window (days out)
            <Meta as="span" className="font-normal">how far ahead members can RSVP each week</Meta>
            <input type="number" name="rsvpWindowDays" defaultValue={6} min={1} max={21} className={fieldClass} />
          </label>

          <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
            Game type
            <Meta as="span" className="font-normal">Friendly games keep the score, Reliability and your played-with, but never move Glass. Starts from your Circle&apos;s default.</Meta>
            <select name="gameType" defaultValue={initialGameType} className={fieldClass}>
              <option value="competitive">Competitive, results move Glass</option>
              <option value="friendly">Friendly, Glass stays put</option>
            </select>
          </label>

          <label className="flex items-start gap-3 rounded-button p-3 bg-surface border border-ink-hairline-3 cursor-pointer">
            <input type="checkbox" name="rotationEnabled" className="mt-0.5 size-4 accent-ink" />
            <span className="flex flex-col gap-1 text-cu-body font-semibold text-ink">
              Turn on <InfoTerm term="rotation" label="The Rotation" />
              <Meta as="span" className="font-normal leading-relaxed">
                Members say if they&apos;re available, then CUATRO picks a fair four and rotates who sits out. It runs first-come for the first few weeks, then picks the fairest four once your game has some history.
              </Meta>
            </span>
          </label>

          <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
            Rotation locks
            <Meta as="span" className="font-normal">how long before kickoff the four is settled (rotation games only)</Meta>
            <select name="rotationCutoffHours" defaultValue={24} className={fieldClass}>
              <option value={12}>12 hours before</option>
              <option value={24}>1 day before</option>
              <option value={48}>2 days before</option>
              <option value={72}>3 days before</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
            Rotation mode
            <Meta as="span" className="font-normal">Limited settles the four at the cutoff. Unlimited keeps re-picking the fairest four right up to kickoff.</Meta>
            <select name="rotationMode" defaultValue="limited" className={fieldClass}>
              <option value="limited">Limited, locks at the cutoff</option>
              <option value="unlimited">Unlimited, re-picks until kickoff</option>
            </select>
          </label>

          <Button type="submit" size="lg" fullWidth>
            Create Standing Game
          </Button>
        </form>
      )}
    </main>
  );
}
