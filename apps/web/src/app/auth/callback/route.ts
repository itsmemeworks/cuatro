import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthStore } from "@/lib/auth-store";
import { isSafeRelativePath, resolveRequestOrigin } from "@/lib/safe-redirect";

/**
 * Lands both Supabase auth flows: magic-link OTP (signInWithOtp's
 * emailRedirectTo) and OAuth (signInWithOAuth's redirectTo) both point here
 * with a PKCE `?code=`. Exchanges it for a Supabase session, then provisions
 * (or links) the matching local `users` row — this is the ONE place that
 * provisioning happens; see AuthStore.findOrCreateUserBySupabase.
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
  await store.findOrCreateUserBySupabase({
    supabaseUserId: data.user.id,
    email: data.user.email,
    displayName:
      typeof data.user.user_metadata?.name === "string" ? data.user.user_metadata.name : null,
  });

  return NextResponse.redirect(`${origin}${destination}`);
}
