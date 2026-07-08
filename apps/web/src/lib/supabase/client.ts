"use client";

/**
 * Browser-side Supabase client — for use inside Client Components (the
 * login page's magic-link/OAuth buttons). Reads/writes the PKCE session
 * cookies directly in the browser; the server-side counterpart is
 * ./server.ts.
 */
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
