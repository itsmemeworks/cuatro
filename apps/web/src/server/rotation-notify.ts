/**
 * THE ROTATION lock notifications — the SINGLE swap point.
 *
 * notify.ts is single-owner (CLAUDE.md convention 3): this feature does not
 * edit it. The lock moment wants two new, honest copy variants:
 *
 *   - "You're in this week"        (selected to play)
 *   - "You're sitting this one out" (benched, first to auto-promote next drop)
 *
 * Those NotificationInput variants + copy are spelled out for the session lead
 * to add to notify.ts (see scratchpad/rotation.md). Until they land, these two
 * wrappers map to the closest HONEST existing type so the feature is testable
 * end-to-end today, and swapping to the real variants is a one-line change in
 * each function below — no call site in games-service.ts changes.
 *
 * The tailored variants are live in notify.ts (rotation_selected /
 * rotation_sitting_out); this wrapper remains the single call point.
 */
import type { CuatroDb } from "@cuatro/db";
import { insertNotification } from "./notify";

/** A rotation-selected player has been locked into this week's four. */
export async function notifyRotationSelected(tx: CuatroDb, userId: string, sessionId: string): Promise<void> {
  await insertNotification(tx, { userId, type: "rotation_selected", payload: { sessionId } });
}

/** A rotation player is sitting out this week (first in the auto-promote queue). */
export async function notifyRotationSittingOut(tx: CuatroDb, userId: string, sessionId: string): Promise<void> {
  await insertNotification(tx, { userId, type: "rotation_sitting_out", payload: { sessionId } });
}
