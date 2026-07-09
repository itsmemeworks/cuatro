/**
 * The guest device cookie — `cuatro_guest` — identifying an anonymous
 * claimant across requests without any account (design/HANDOFF.md screen 2:
 * "account creation is deferred until AFTER the game"). Mirrors
 * lib/session.ts's cookie plumbing exactly (httpOnly/secure/lax/path=/),
 * just longer-lived: a guest's device needs to still carry their identity
 * whenever they come back to convert, which could be days later, not just
 * for the 30-day window a real session cookie needs.
 *
 * The cookie holds the raw token; only its sha256 (server/guest.ts's
 * hashGuestToken) is ever stored in `users.guest_claim_token_hash` — same
 * "hash at rest" rule as magic_link_tokens/sessions_auth in auth.ts.
 */
import { cookies } from "next/headers";

export const GUEST_COOKIE = "cuatro_guest";
// 180 days: long enough that "any later visit" (the deferred make-it-yours
// prompt) still has a device to recognise, without living forever.
export const GUEST_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

export async function getGuestToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(GUEST_COOKIE)?.value ?? null;
}

export async function setGuestCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(GUEST_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: GUEST_COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearGuestCookie(): Promise<void> {
  const store = await cookies();
  store.delete(GUEST_COOKIE);
}
