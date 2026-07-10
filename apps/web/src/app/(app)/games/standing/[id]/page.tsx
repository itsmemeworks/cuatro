import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { getStandingGame, isOrganiser } from "@/server/standing-games-service";
import { listVenuesForCircle } from "@/server/venues";
import { ensureUpcomingSessionForStandingGame } from "@/server/games-service";
import { toggleStandingGameActiveAction, updateStandingGameAction } from "@/server/games-actions";
import { Button, Meta } from "@/components/ui";
import { InfoTerm } from "@/components/ui/info-term";
import { VenuePicker } from "../venue-picker";

const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** "20:00" -> "8pm", "20:30" -> "8:30pm" — matches the session page's convention. */
function formatStartTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const period = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return Number(mStr) === 0 ? `${h12}${period}` : `${h12}:${mStr}${period}`;
}

const fieldClass =
  "rounded-button p-3 text-[14px] bg-surface border border-ink-hairline-3 text-ink outline-none";

export default async function EditStandingGamePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; matched?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;

  const { id } = await params;
  const { created, matched } = await searchParams;
  const { db } = await getGamesClient();
  const standingGame = await getStandingGame(db, id);
  if (!standingGame) notFound();

  const venueOptions = await listVenuesForCircle(db, standingGame.circleId);
  const currentCostLabel = standingGame.costMinor != null ? (standingGame.costMinor / 100).toFixed(2) : "";

  const canManage = await isOrganiser(db, standingGame.circleId, user.id);
  const boundUpdate = updateStandingGameAction.bind(null, id);
  const boundToggle = toggleStandingGameActiveAction.bind(null, id, !standingGame.active);

  // Success moment (created just now): materialise the first session — it's
  // otherwise made lazily on first read (games-service.ts) — so we can tell
  // the organiser exactly when it is and when RSVPs open.
  let firstSession: { whenLabel: string; rsvpLabel: string } | null = null;
  if (created && canManage) {
    const session = await ensureUpcomingSessionForStandingGame(db, id);
    const weekdayLabel = WEEKDAYS.find((w) => w.value === standingGame.weekday)?.label ?? "";
    const opensAt = session.startsAt - standingGame.rsvpWindowDays * DAY_MS;
    const daysUntilOpen = Math.ceil((opensAt - Date.now()) / DAY_MS);
    firstSession = {
      whenLabel: `${weekdayLabel} ${formatStartTime(standingGame.startTime)}`,
      rsvpLabel:
        daysUntilOpen <= 0
          ? "RSVPs are open now, tap in on the game."
          : `RSVPs open in ${daysUntilOpen} ${daysUntilOpen === 1 ? "day" : "days"}.`,
    };
  }

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <div>
        <h1 className="text-cu-title text-ink">Standing Game</h1>
        <Meta as="p" className="mt-1.5">
          Your weekly fixture, it opens the RSVP on its own so nobody has to chase.
        </Meta>
      </div>

      {firstSession && (
        <div className="rounded-card bg-surface border border-ink-hairline-1 px-4 py-4 flex flex-col gap-3">
          <div>
            <Meta as="p" tone="win" className="uppercase tracking-[0.12em] font-extrabold">
              Standing Game set
            </Meta>
            <p className="text-cu-card-title text-ink mt-1">Your first game is {firstSession.whenLabel}</p>
            <Meta as="p" className="mt-1">
              {firstSession.rsvpLabel} It repeats every week from here.
            </Meta>
          </div>
          <Link
            href={`/circles/${standingGame.circleId}`}
            className="rounded-button min-h-11 flex items-center justify-center text-[14px] font-extrabold bg-strong-bg text-strong-fg"
          >
            Invite your mates
          </Link>
        </div>
      )}

      {matched && (
        <Meta as="p">Matched your court to {matched}, no duplicate created.</Meta>
      )}

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
              Game type
              <Meta as="span" className="font-normal">Friendly games keep the score, Reliability and your played-with, but never move Glass. New sessions use this. A game already on the calendar keeps the type it opened with.</Meta>
              <select name="gameType" defaultValue={standingGame.gameType} className={fieldClass}>
                <option value="competitive">Competitive, results move Glass</option>
                <option value="friendly">Friendly, Glass stays put</option>
              </select>
            </label>

            <label className="flex items-start gap-3 rounded-button p-3 bg-surface border border-ink-hairline-3 cursor-pointer">
              <input
                type="checkbox"
                name="rotationEnabled"
                defaultChecked={standingGame.rotationEnabled}
                className="mt-0.5 size-4 accent-ink"
              />
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
              <select name="rotationCutoffHours" defaultValue={standingGame.rotationCutoffHours} className={fieldClass}>
                <option value={12}>12 hours before</option>
                <option value={24}>1 day before</option>
                <option value={48}>2 days before</option>
                <option value={72}>3 days before</option>
              </select>
            </label>

            <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
              Rotation mode
              <Meta as="span" className="font-normal">Limited settles the four at the cutoff. Unlimited keeps re-picking the fairest four right up to kickoff.</Meta>
              <select name="rotationMode" defaultValue={standingGame.rotationMode} className={fieldClass}>
                <option value="limited">Limited, locks at the cutoff</option>
                <option value="unlimited">Unlimited, re-picks until kickoff</option>
              </select>
            </label>

            <VenuePicker venues={venueOptions} defaultVenueId={standingGame.venueId} />

            <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
              Court cost (optional, splits on the Tab)
              <input type="text" name="costAmount" inputMode="decimal" placeholder="32.00" defaultValue={currentCostLabel} className={fieldClass} />
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
