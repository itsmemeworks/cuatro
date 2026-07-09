import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthStore } from "@/lib/auth-store";
import { isSafeRelativePath, resolveRequestOrigin } from "@/lib/safe-redirect";
import { GUEST_COOKIE } from "@/lib/guest-session";
import { convertGuestOnAuth, getGuestUserId } from "@/server/guest";
import { getGamesClient } from "@/server/games-db";

/**
 * Lands both Supabase auth flows: magic-link OTP (signInWithOtp's
 * emailRedirectTo) and OAuth (signInWithOAuth's redirectTo) both point here
 * with a PKCE `?code=`. Exchanges it for a Supabase session, then provisions
 * (or links) the matching local `users` row — this is the ONE place that
 * provisioning happens; see AuthStore.findOrCreateUserBySupabase.
 *
 * Additive guest-conversion branch: a guest who tapped GuestClaimFlow's
 * "Make it yours" link carries the `cuatro_guest` device cookie through
 * this whole redirect (it's a plain httpOnly cookie on this domain, and
 * this route lives on it too). If that cookie still resolves to a guest
 * row, server/guest.ts's convertGuestOnAuth either flips it to a real
 * account in place or — on an email conflict — re-points its rsvps onto
 * the pre-existing account findOrCreateUserBySupabase resolved instead.
 * Either way the cookie is cleared here: converted, it's no longer needed;
 * merged, it must not keep resolving to the now-inert guest row.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next");
  const origin = resolveRequestOrigin(request);
  const destination = isSafeRelativePath(next) ? next : "/home";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user?.email) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const store = await getAuthStore();
  const resolvedUser = await store.findOrCreateUserBySupabase({
    supabaseUserId: data.user.id,
    email: data.user.email,
    displayName:
      typeof data.user.user_metadata?.name === "string" ? data.user.user_metadata.name : null,
  });

  const response = NextResponse.redirect(`${origin}${destination}`);

  const guestToken = request.cookies.get(GUEST_COOKIE)?.value;
  if (guestToken) {
    const { db } = await getGamesClient();
    const guestUserId = getGuestUserId(db, guestToken);
    if (guestUserId) convertGuestOnAuth(db, guestUserId, resolvedUser.id);
    response.cookies.delete(GUEST_COOKIE);
  }

  return response;
}
