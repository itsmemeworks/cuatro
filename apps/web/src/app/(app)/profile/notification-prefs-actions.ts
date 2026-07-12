"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { users } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";

/**
 * Persist the per-type notification preferences behind the Settings
 * NOTIFICATIONS card: Fourth Calls, lineup locks (the Rotation picked or
 * benched you), and Tab nudges. Enforcement lives in server/notify.ts — an
 * opted-out type creates nothing at all (no row, no push, no realtime).
 * Everything else (seals, promotions, knocks, reschedules) is always-on and
 * deliberately has no field here.
 *
 * All three values are always submitted together (the card owns the trio, the
 * checkbox convention matches discovery-actions: presence = on), so this is a
 * plain overwrite of the signed-in user's own row — no read-decide-write, no
 * lock needed.
 */
export async function updateNotificationPrefsAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  const { db } = await getDb();
  await db
    .update(users)
    .set({
      notifyFourthCall: formData.get("fourthCall") != null,
      notifyRotation: formData.get("rotation") != null,
      notifyTabNudge: formData.get("tabNudge") != null,
    })
    .where(eq(users.id, user.id));

  revalidatePath("/profile");
  revalidatePath("/profile/settings");
}
