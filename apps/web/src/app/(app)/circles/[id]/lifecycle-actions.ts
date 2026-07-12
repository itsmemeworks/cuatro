"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/session";
import {
  CannotRemoveSelfError,
  CannotTransferToGuestError,
  CannotTransferToSelfError,
  getCirclesStore,
  LastOrganiserError,
  NotMemberError,
  NotOrganiserError,
  TargetNotMemberError,
} from "@/server/circles";

export type LifecycleResult = { ok: true } | { ok: false; error: string };

/**
 * Circle lifecycle server actions: leave, remove a member, hand over the
 * organiser role. Kept in their own file (alongside door-actions.ts) so all of
 * a Circle's mutating server actions share the settings/members territory.
 * Every guard lives in server/circles.ts's store methods; here we only resolve
 * the signed-in caller, map raw error classes to UI-safe codes (never a raw
 * message reaches the client — hard convention 9), and revalidate the page.
 */

/** A member leaves a Circle. The only-organiser-left case is blocked server-side. */
export async function leaveCircleAction(circleId: string): Promise<LifecycleResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const store = await getCirclesStore();
  try {
    await store.leaveCircle(circleId, user.id);
  } catch (err) {
    if (err instanceof LastOrganiserError) return { ok: false, error: "last_organiser" };
    if (err instanceof NotMemberError) return { ok: false, error: "not_a_member" };
    throw err;
  }
  // "layout" so the whole circle subtree (/members, /settings, …) revalidates,
  // not just the feed route — membership changes surface on the sub-routes
  // (fix wave F3's join/knock/leave/transfer revalidation cluster).
  revalidatePath(`/circles/${circleId}`, "layout");
  revalidatePath("/circles");
  return { ok: true };
}

/** An organiser removes another member. */
export async function removeMemberAction(circleId: string, targetUserId: string): Promise<LifecycleResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const store = await getCirclesStore();
  try {
    await store.removeMember(circleId, user.id, targetUserId);
  } catch (err) {
    if (err instanceof NotOrganiserError) return { ok: false, error: "not_an_organiser" };
    if (err instanceof NotMemberError) return { ok: false, error: "not_a_member" };
    if (err instanceof TargetNotMemberError) return { ok: false, error: "target_not_a_member" };
    if (err instanceof CannotRemoveSelfError) return { ok: false, error: "cannot_remove_self" };
    throw err;
  }
  revalidatePath(`/circles/${circleId}`, "layout");
  return { ok: true };
}

/** An organiser hands the Circle to another member. */
export async function transferOrganiserAction(circleId: string, targetUserId: string): Promise<LifecycleResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const store = await getCirclesStore();
  try {
    await store.transferOrganiser(circleId, user.id, targetUserId);
  } catch (err) {
    if (err instanceof NotOrganiserError) return { ok: false, error: "not_an_organiser" };
    if (err instanceof NotMemberError) return { ok: false, error: "not_a_member" };
    if (err instanceof TargetNotMemberError) return { ok: false, error: "target_not_a_member" };
    if (err instanceof CannotTransferToSelfError) return { ok: false, error: "cannot_transfer_to_self" };
    if (err instanceof CannotTransferToGuestError) return { ok: false, error: "cannot_transfer_to_guest" };
    throw err;
  }
  revalidatePath(`/circles/${circleId}`, "layout");
  return { ok: true };
}
