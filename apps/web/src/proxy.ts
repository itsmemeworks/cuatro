import { type NextRequest } from "next/server";
import { updateSupabaseSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSupabaseSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on everything except static assets, the PWA/manifest files, and
     * the Apple App Site Association endpoints — none of those carry auth
     * state, and AASA in particular must be a zero-overhead unauthenticated
     * static response (iOS fetches it with no cookies at all).
     */
    "/((?!_next/static|_next/image|favicon|manifest.json|sw.js|icons/|\\.well-known/apple-app-site-association|apple-app-site-association|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
