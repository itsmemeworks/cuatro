/**
 * The cheap heuristic behind the first-run name step (F6, app/welcome/name).
 *
 * A magic-link sign-up with no user_metadata.name gets a display name seeded
 * from the email local-part (auth-store's deriveDisplayName). This detects
 * that still-auto-derived state so /auth/callback can route a fresh sign-up
 * through the one-field name step, and the step itself can skip anyone who
 * already chose a real name. Kept in its own module (not auth-store) so it
 * carries no db dependency and stays trivially mockable/testable. Pure and
 * null-safe — safe to call against a not-yet-resolved user.
 */
export function displayNameLooksDerived(
  displayName: string | null | undefined,
  email: string | null | undefined,
): boolean {
  if (!displayName || !email) return false;
  const localPart = email.trim().toLowerCase().split("@")[0];
  return displayName === localPart;
}
