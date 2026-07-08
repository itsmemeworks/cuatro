/**
 * Server-side Supabase client — for use in Server Components, Route
 * Handlers, and Server Actions (getSessionUser, /auth/callback, logout).
 * Reads/writes the auth cookie set via @supabase/ssr's PKCE flow through
 * next/headers' cookies(), which is why every caller of createClient() here
 * must be async.
 *
 * `setAll` can throw when called from a Server Component (cookies are
 * read-only there) — safe to swallow because the proxy
 * (./middleware.ts + ../../proxy.ts) is what actually refreshes the
 * session cookie on every request.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component — ignored, middleware refreshes instead.
          }
        },
      },
    }
  );
}
