"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { users, venues } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";

/**
 * Persist the player-side discovery settings that power The Board / Local Ring
 * / Open Door: `findable` (consent to being discovered) and `homeVenueId` (the
 * anchor club whose pin becomes the player's patch — see server/patch.ts).
 * v1 exposes exactly these two: the explicit patchLat/patchLng fallback stays
 * server-only (seedable, resolvable) but has no UI yet — a home venue covers
 * the launch case and keeps the setting to one honest choice. Guarded to the
 * signed-in user; a homeVenueId is validated to be a real venue before it's
 * written (the column is an FK, but we return quietly rather than 500 on a
 * stale option).
 */
export async function updateDiscoverySettingsAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  // An unchecked checkbox submits nothing, so absence = not findable.
  const findable = formData.get("findable") != null;

  const rawVenue = formData.get("homeVenueId");
  let homeVenueId: string | null = null;
  if (typeof rawVenue === "string" && rawVenue.trim().length > 0) {
    homeVenueId = rawVenue.trim();
  }

  const { db } = await getDb();

  if (homeVenueId) {
    const venue = await db.select({ id: venues.id }).from(venues).where(eq(venues.id, homeVenueId)).limit(1);
    if (venue.length === 0) homeVenueId = null; // stale option — drop it rather than break the FK
  }

  await db.update(users).set({ findable, homeVenueId }).where(eq(users.id, user.id));

  revalidatePath("/profile");
  revalidatePath("/home");
}
