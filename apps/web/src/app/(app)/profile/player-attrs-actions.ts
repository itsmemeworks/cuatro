"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { users } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { courtSide, dominantHand } from "@/lib/player-attrs";

/**
 * Persist the ON COURT player attributes (GitHub issue #21): dominant hand +
 * preferred court side. SOFT SIGNALS ONLY — nothing anywhere reads these to
 * gate joining, filter a Fourth Call, or move Glass/rotation. Both optional
 * and nullable forever: "" (or an unrecognised value) writes null, so
 * "skip" and "clear" are the same quiet non-event. Both fields are always
 * submitted together (one form owns the pair), so this is a plain overwrite
 * of the signed-in user's own row — no read-decide-write, no lock needed.
 */
export async function updatePlayerAttrsAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  const hand = dominantHand(String(formData.get("dominantHand") ?? ""))?.id ?? null;
  const side = courtSide(String(formData.get("courtSide") ?? ""))?.id ?? null;

  const { db } = await getDb();
  await db.update(users).set({ dominantHand: hand, courtSide: side }).where(eq(users.id, user.id));

  revalidatePath("/profile");
  revalidatePath("/profile/settings");
}
