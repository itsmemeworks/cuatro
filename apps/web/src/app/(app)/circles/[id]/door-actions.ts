"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/session";
import { getCirclesStore, NotMemberError, NotOrganiserError } from "@/server/circles";

export type DoorSettingsResult = { ok: true } | { ok: false; error: string };

/**
 * Organiser door controls for a Circle: the Open Door toggle and the one-line
 * vibe line. A server action (rather than an api/circles route) so it stays
 * inside the Open Door wave's own territory. Only an organiser may call it;
 * server/circles.ts's updateCircleSettings enforces the role. Passing
 * `vibeLine: ""` clears it back to the default card line.
 */
export async function saveDoorSettings(
  circleId: string,
  updates: { openDoor?: boolean; vibeLine?: string },
): Promise<DoorSettingsResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const store = await getCirclesStore();
  try {
    await store.updateCircleSettings(circleId, user.id, {
      openDoor: updates.openDoor,
      vibeLine: updates.vibeLine,
    });
  } catch (err) {
    if (err instanceof NotOrganiserError) return { ok: false, error: "not_an_organiser" };
    if (err instanceof NotMemberError) return { ok: false, error: "not_a_member" };
    throw err;
  }
  revalidatePath(`/circles/${circleId}`);
  return { ok: true };
}
