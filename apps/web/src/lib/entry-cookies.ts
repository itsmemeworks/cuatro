/**
 * Cookies the first-run entry flow reads/writes across a redirect boundary.
 *
 * NAME_PROMPTED_COOKIE records WHICH accounts have already seen the one-field
 * name step (app/welcome/name) on this device — whether they chose a name or
 * skipped. The value is a comma-separated list of user ids, NOT a single
 * boolean: a device is shared (a returning phone, a household, a demo laptop),
 * so scoping the "don't ask again" signal per account means the 2nd+ person to
 * sign up on the same device is still prompted for their own name instead of
 * silently inheriting the first user's "already seen it". /auth/callback reads
 * it (hasBeenPrompted, keyed on the resolved user's id) so a returning sign-in
 * never re-routes through the step; the step's server action appends the
 * current user's id (addPromptedUserId). Carries no identity beyond the ids
 * already tied to this authenticated session, so deliberately NOT
 * server-only-httpOnly-sensitive; it's just "who's been asked".
 *
 * FOLLOW-UP (not in this fix, no schema migration wanted here): an
 * account-level `users.name_prompted` column would make a skip hold across
 * devices, not just the one where it happened. The cookie handles the
 * common case; the column is the durable version.
 */
export const NAME_PROMPTED_COOKIE = "cuatro_named";

/** ~1 year — long enough that the name step is a genuine one-time moment. */
export const NAME_PROMPTED_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * Cap on how many accounts we remember per device. A shared device can see
 * many sign-ups over a year; keeping only the most-recent ids bounds the
 * cookie size (oldest fall off first — least likely to sign in here again).
 */
const MAX_PROMPTED_IDS = 20;

/** Parse the cookie into the list of user ids it records (user ids are UUIDs, comma-free). */
export function parsePromptedUserIds(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/** True if this account has already seen the name step on this device. */
export function hasBeenPrompted(value: string | null | undefined, userId: string): boolean {
  return parsePromptedUserIds(value).includes(userId);
}

/**
 * Return the cookie value with `userId` recorded as prompted (moved to the
 * end, de-duplicated, capped). Idempotent for an already-recorded id.
 */
export function addPromptedUserId(value: string | null | undefined, userId: string): string {
  const ids = parsePromptedUserIds(value).filter((id) => id !== userId);
  ids.push(userId);
  return ids.slice(-MAX_PROMPTED_IDS).join(",");
}
