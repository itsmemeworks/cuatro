/**
 * Cookies the first-run entry flow reads/writes across a redirect boundary.
 *
 * NAME_PROMPTED_COOKIE is a device flag set once the user has seen the
 * one-field name step (app/welcome/name) — whether they chose a name or
 * skipped. /auth/callback reads it so a returning sign-in never re-routes
 * through that step; the name step's server action writes it. Deliberately
 * NOT httpOnly-only-server: it carries no identity, just "don't ask again".
 */
export const NAME_PROMPTED_COOKIE = "cuatro_named";

/** ~1 year — long enough that the name step is a genuine one-time moment. */
export const NAME_PROMPTED_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
