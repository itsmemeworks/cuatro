import { cookies } from "next/headers";
import { getAuthStore, type SessionUser } from "./auth-store";

export const SESSION_COOKIE = "cuatro_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

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

export async function getSessionUser(): Promise<SessionUser | null> {
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
