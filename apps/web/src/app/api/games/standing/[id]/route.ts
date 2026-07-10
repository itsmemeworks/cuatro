import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { getStandingGame, updateStandingGame } from "@/server/standing-games-service";
import { rescheduleUpcomingSessionsForStandingGame } from "@/server/games-service";
import { emitCircleEvent, emitSessionEvent } from "@/lib/realtime/broadcast";
import { parseAmountToMinor } from "@/components/tab/money";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const { db } = await getGamesClient();
  const standingGame = await getStandingGame(db, id);
  if (!standingGame) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  return NextResponse.json({ ok: true, standingGame });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const { db } = await getGamesClient();
  const result = await updateStandingGame(db, user.id, id, {
    weekday: body.weekday !== undefined ? Number(body.weekday) : undefined,
    startTime: typeof body.startTime === "string" ? body.startTime : undefined,
    durationMinutes: body.durationMinutes !== undefined ? Number(body.durationMinutes) : undefined,
    slots: body.slots !== undefined ? Number(body.slots) : undefined,
    rsvpWindowDays: body.rsvpWindowDays !== undefined ? Number(body.rsvpWindowDays) : undefined,
    venueId: typeof body.venueId === "string" ? body.venueId : undefined,
    venueName: typeof body.venueName === "string" ? body.venueName : undefined,
    active: typeof body.active === "boolean" ? body.active : undefined,
    // Kept in step with the editor's server action: absent -> undefined
    // (cost preserved), null/"" -> cleared, a "32.00" string or minor-unit
    // number -> set. An omitted cost must never silently null an existing one.
    costMinor: parseCostFromBody(body.costMinor),
  });

  if (!result.ok) {
    const status = result.error === "not_an_organiser" ? 403 : result.error === "not_found" ? 404 : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  // A day/time (or venue) change must move the already-materialised session
  // rather than orphan it (v1 audit, journeys finding 5). No-op otherwise.
  // Realtime fires after the reschedule transaction commits.
  const reschedule = await rescheduleUpcomingSessionsForStandingGame(db, id);
  if (reschedule.circleId && reschedule.movedSessionIds.length > 0) {
    for (const movedId of reschedule.movedSessionIds) {
      emitSessionEvent(movedId, "rsvp", { circleId: reschedule.circleId });
    }
    emitCircleEvent(reschedule.circleId, "rsvp", { sessionIds: reschedule.movedSessionIds });
  }

  return NextResponse.json({ ok: true, standingGame: result.value });
}

/** null/"" -> clear, a "32.00" string or minor-unit number -> set, anything else (incl. absent) -> undefined so an omitted cost is preserved. */
function parseCostFromBody(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw === "number") return Number.isInteger(raw) ? raw : undefined;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return parseAmountToMinor(trimmed) ?? undefined;
  }
  return undefined;
}
