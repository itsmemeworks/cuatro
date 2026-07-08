import { cookies } from "next/headers";
import { getAuthStore, type SessionUser } from "./auth-store";
import { createClient as createSupabaseServerClient } from "./supabase/server";

export const SESSION_COOKIE = "cuatro_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

/**
 * Legacy custom magic-link flow (request/verify routes, this cookie) only
 * runs when explicitly enabled — it exists so automated E2E tests can sign
 * in without depending on Supabase's hosted email delivery. Everywhere else,
 * Supabase Auth (below) is the only way in.
 */
export function legacyAuthEnabled(): boolean {
  return process.env.AUTH_LEGACY === "1";
}

/** Pure helper (no next/headers) so cookie shape is unit-testable. */
export function buildSessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
  };
}

/**
 * Resolves the signed-in user, Supabase session first. Falls back to the
 * legacy cookie session only when AUTH_LEGACY=1 — see legacyAuthEnabled().
 * A Supabase session with no matching local `users` row (shouldn't happen:
 * /auth/callback always provisions before it ever sets that session) is
 * treated as signed out rather than silently creating an account here.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: supabaseUser },
  } = await supabase.auth.getUser();

  if (supabaseUser) {
    const store = await getAuthStore();
    const user = await store.getUserBySupabaseId(supabaseUser.id);
    if (user) return user;
  }

  if (!legacyAuthEnabled()) return null;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const store = await getAuthStore();
  return store.getSession(token);
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  const cookie = buildSessionCookie(token);
  cookieStore.set(cookie.name, cookie.value, cookie.options);
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
