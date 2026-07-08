/**
 * Refreshes the Supabase auth cookie on every request that hits the root
 * proxy (../../proxy.ts, Next's post-"middleware" convention). This is the
 * piece that keeps a signed-in user's session alive past access-token
 * expiry without them ever noticing —
 * Server Component reads alone (see ../supabase/server.ts) can't write
 * refreshed cookies back to the browser, only middleware/route handlers can.
 *
 * Per @supabase/ssr's documented pattern: don't add logic between
 * createServerClient() and auth.getUser() below — auth.getUser() is what
 * actually triggers the refresh, and skipping/reordering it is a common way
 * to end up with users randomly signed out.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSupabaseSession(request: NextRequest): Promise<NextResponse> {
  // Forwarded so a Server Component that needs to redirect unauthenticated
  // visitors (see (app)/layout.tsx) can rebuild `?next=<path>` without a
  // request object of its own — layouts don't receive one directly.
  request.headers.set("x-pathname", request.nextUrl.pathname + request.nextUrl.search);
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  await supabase.auth.getUser();

  return response;
}
