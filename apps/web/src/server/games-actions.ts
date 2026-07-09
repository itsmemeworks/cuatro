"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "./games-db";
import { createStandingGame, updateStandingGame } from "./standing-games-service";
import { parseAmountToMinor } from "@/components/tab/money";

/** "" -> null (leave/clear), a valid "32.00"-style string -> minor units, anything unparseable -> undefined (ignored) so a typo doesn't silently zero out an existing cost. */
function parseCostField(raw: FormDataEntryValue | null): number | null | undefined {
  if (raw === null) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  return parseAmountToMinor(trimmed) ?? undefined;
}

export async function createStandingGameAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  const circleId = String(formData.get("circleId") ?? "");
  const startTime = String(formData.get("startTime") ?? "");
  if (!circleId || !startTime) return;

  const { db } = await getGamesClient();
  const result = createStandingGame(db, user.id, {
    circleId,
    weekday: Number(formData.get("weekday")),
    startTime,
    durationMinutes: Number(formData.get("durationMinutes") ?? 90),
    slots: Number(formData.get("slots") ?? 4),
    rsvpWindowDays: Number(formData.get("rsvpWindowDays") ?? 6),
    venueName: String(formData.get("venueName") ?? "").trim() || null,
    venueAddress: String(formData.get("venueAddress") ?? "").trim() || null,
    costMinor: parseCostField(formData.get("costAmount")) ?? null,
  });

  revalidatePath("/games/standing");
  if (result.ok) redirect(`/games/standing/${result.value.id}`);
}

export async function updateStandingGameAction(id: string, formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  const { db } = await getGamesClient();
  const venueNameRaw = formData.get("venueName");
  const venueAddressRaw = formData.get("venueAddress");

  updateStandingGame(db, user.id, id, {
    weekday: formData.get("weekday") !== null ? Number(formData.get("weekday")) : undefined,
    startTime: formData.get("startTime") ? String(formData.get("startTime")) : undefined,
    durationMinutes: formData.get("durationMinutes") ? Number(formData.get("durationMinutes")) : undefined,
    slots: formData.get("slots") ? Number(formData.get("slots")) : undefined,
    rsvpWindowDays: formData.get("rsvpWindowDays") ? Number(formData.get("rsvpWindowDays")) : undefined,
    venueName: venueNameRaw !== null ? String(venueNameRaw).trim() || null : undefined,
    venueAddress: venueAddressRaw !== null ? String(venueAddressRaw).trim() || null : undefined,
    costMinor: parseCostField(formData.get("costAmount")),
  });

  revalidatePath("/games/standing");
  revalidatePath(`/games/standing/${id}`);
}

export async function toggleStandingGameActiveAction(id: string, active: boolean): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  const { db } = await getGamesClient();
  updateStandingGame(db, user.id, id, { active });

  revalidatePath("/games/standing");
  revalidatePath(`/games/standing/${id}`);
}
