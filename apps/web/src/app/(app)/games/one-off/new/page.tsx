import { inArray } from "drizzle-orm";
import { circles } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { listCirclesForUser } from "@/server/standing-games-service";
import { listVenuesForCircle } from "@/server/venues";
import { createOneOffSessionAction } from "@/server/games-actions";
import { errorCopy } from "@/lib/error-copy";
import { DEFAULT_TZ, localDateKey } from "@/lib/time";
import { Meta, SubmitButton } from "@/components/ui";
import { VenuePicker } from "../../standing/venue-picker";
import { MoneyOptInPicker } from "../../standing/money-opt-in-picker";

export const metadata = { title: "New one-off session · CUATRO" };

// Organiser-facing copy for the codes createOneOffSessionAction can bounce
// back; anything unlisted falls through to the shared errorCopy() so no raw
// slug is ever shown.
const CREATE_ERROR_COPY: Record<string, string> = {
  not_an_organiser: "Only a Circle's organiser can set up its games.",
  invalid_starts_at: "That date and time didn't read right, pick them again.",
  starts_in_past: "That kickoff has already been and gone, pick a time still to come.",
  invalid_booking_platform: "Pick one of the booking platforms and try again.",
  invalid_booking_url: "That booking link didn't read as a web address. Paste the full link, https and all.",
};

const fieldClass =
  "rounded-button p-3 text-[14px] bg-surface border border-ink-hairline-3 text-ink outline-none";

/**
 * The one-off session form (QA4: POST /api/games/sessions existed and the
 * games list already renders "ONE-OFF SESSIONS", but "+ Add a game" only led
 * to the Standing Game form — an organiser had no way to put a single game
 * on). Deliberately short: a one-off works like a fixture, minus the repeat,
 * so it only asks for what one game needs.
 */
export default async function NewOneOffSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ circleId?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;

  const { circleId: preselectedCircleId, error } = await searchParams;
  const { db } = await getGamesClient();
  const organiserCircles = (await listCirclesForUser(db, user.id)).filter((c) => c.role === "organiser");
  const orderingCircleId = preselectedCircleId ?? organiserCircles[0]?.circleId;
  const venueOptions = orderingCircleId ? await listVenuesForCircle(db, orderingCircleId) : [];

  // FRIENDLIES: default to the circle the form opens on, same as the standing
  // form — always an explicit value on submit, never "inherit".
  const organiserCircleIds = organiserCircles.map((c) => c.circleId);
  const defaultTypeRows = organiserCircleIds.length
    ? await db.select({ id: circles.id, defaultGameType: circles.defaultGameType }).from(circles).where(inArray(circles.id, organiserCircleIds))
    : [];
  const defaultTypeByCircle = new Map(defaultTypeRows.map((r) => [r.id, r.defaultGameType]));
  const initialGameType = (orderingCircleId && defaultTypeByCircle.get(orderingCircleId)) ?? "competitive";

  // Soft guard only (the action validates properly, in the venue's timezone).
  const minDate = localDateKey(Date.now(), DEFAULT_TZ);

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <div>
        <h1 className="text-cu-title text-ink">New one-off session</h1>
        <Meta as="p" className="mt-1.5">
          One date, one game. It works like a fixture, minus the repeat.
        </Meta>
      </div>

      {error && (
        <Meta as="p" tone="loss">
          {CREATE_ERROR_COPY[error] ?? errorCopy(error)}
        </Meta>
      )}

      {organiserCircles.length === 0 ? (
        <Meta as="p">You need to be an organiser of a Circle to put one of its games on.</Meta>
      ) : (
        <form action={createOneOffSessionAction} className="flex flex-col gap-4">
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
            Date
            <input type="date" name="date" required min={minDate} className={fieldClass} />
          </label>

          <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
            Start time
            <input type="time" name="startTime" required defaultValue="20:00" className={fieldClass} />
          </label>

          <VenuePicker venues={venueOptions} />

          {/* "Booked on" only — a one-off carries no court cost (issue #21),
              so the Tab row never renders here. */}
          <MoneyOptInPicker allowCost={false} />

          <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
            Game type
            <Meta as="span" className="font-normal">Friendly games keep the score, Reliability and your played-with, but never move Glass. Starts from your Circle&apos;s default.</Meta>
            <select name="gameType" defaultValue={initialGameType} className={fieldClass}>
              <option value="competitive">Competitive, results move Glass</option>
              <option value="friendly">Friendly, Glass stays put</option>
            </select>
          </label>

          <SubmitButton size="lg" fullWidth>
            Put the game on
          </SubmitButton>
        </form>
      )}
    </main>
  );
}
