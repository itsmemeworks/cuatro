"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/session";
import {
  getCirclesStore,
  InvalidCircleNameError,
  InvalidColourError,
  InvalidEmblemError,
  InvalidHeaderImageError,
  InvalidHomeVenueError,
  InvalidMaxMembersError,
  NotMemberError,
  NotOrganiserError,
} from "@/server/circles";

export type DoorSettingsResult = { ok: true } | { ok: false; error: string };

/**
 * Organiser visibility controls for a Circle: the Open Door toggle, the Board
 * toggle (together these set the tier — open / invite-only / private), and the
 * one-line vibe line. A server action (rather than an api/circles route) so it
 * stays inside the Open Door wave's own territory. Only an organiser may call
 * it; server/circles.ts's updateCircleSettings enforces the role. Passing
 * `vibeLine: ""` clears it back to the default card line.
 */
export async function saveDoorSettings(
  circleId: string,
  updates: { openDoor?: boolean; boardEnabled?: boolean; vibeLine?: string; defaultGameType?: "competitive" | "friendly" },
): Promise<DoorSettingsResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const store = await getCirclesStore();
  try {
    await store.updateCircleSettings(circleId, user.id, {
      openDoor: updates.openDoor,
      boardEnabled: updates.boardEnabled,
      vibeLine: updates.vibeLine,
      defaultGameType: updates.defaultGameType,
    });
  } catch (err) {
    if (err instanceof NotOrganiserError) return { ok: false, error: "not_an_organiser" };
    if (err instanceof NotMemberError) return { ok: false, error: "not_a_member" };
    throw err;
  }
  revalidatePath(`/circles/${circleId}`);
  return { ok: true };
}

/**
 * Organiser edit of a Circle's identity: name, colour, emblem. Same server
 * action shape as saveDoorSettings (kept here so all organiser Circle-settings
 * writes share one file). updateCircleSettings enforces the organiser role and
 * validates each field; raw error classes are mapped to UI-safe codes here.
 */
export async function saveCircleSettings(
  circleId: string,
  updates: {
    name?: string;
    colour?: string;
    emblem?: string | null;
    headerImage?: string | null;
    homeVenueId?: string | null;
    maxMembers?: number | null;
  },
): Promise<DoorSettingsResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const store = await getCirclesStore();
  try {
    await store.updateCircleSettings(circleId, user.id, updates);
  } catch (err) {
    if (err instanceof NotOrganiserError) return { ok: false, error: "not_an_organiser" };
    if (err instanceof NotMemberError) return { ok: false, error: "not_a_member" };
    if (err instanceof InvalidCircleNameError) return { ok: false, error: "invalid_circle_name" };
    if (err instanceof InvalidEmblemError) return { ok: false, error: "invalid_emblem" };
    if (err instanceof InvalidColourError) return { ok: false, error: "invalid_colour" };
    if (err instanceof InvalidHeaderImageError) return { ok: false, error: "invalid_header_image" };
    if (err instanceof InvalidHomeVenueError) return { ok: false, error: "invalid_home_venue" };
    if (err instanceof InvalidMaxMembersError) return { ok: false, error: "invalid_max_members" };
    throw err;
  }
  revalidatePath(`/circles/${circleId}`);
  return { ok: true };
}
