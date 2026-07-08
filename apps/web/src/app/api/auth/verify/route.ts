import { NextRequest, NextResponse } from "next/server";
import { getAuthStore } from "@/lib/auth-store";
import { legacyAuthEnabled, setSessionCookie } from "@/lib/session";
import { isSafeRelativePath, resolveRequestOrigin } from "@/lib/safe-redirect";

/** Legacy counterpart to ./request/route.ts — same AUTH_LEGACY=1 gate. */
export async function GET(request: NextRequest) {
  if (!legacyAuthEnabled()) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const token = request.nextUrl.searchParams.get("token");
  const next = request.nextUrl.searchParams.get("next");
  const origin = resolveRequestOrigin(request);

  if (!token) {
    return NextResponse.redirect(`${origin}/login?error=missing_token`);
  }

  const store = await getAuthStore();
  const result = await store.consumeMagicLinkToken(token);

  if (!result) {
    return NextResponse.redirect(`${origin}/login?error=invalid_token`);
  }

  const sessionToken = await store.createSession(result.userId);
  await setSessionCookie(sessionToken);

  const destination = isSafeRelativePath(next) ? next : "/home";
  return NextResponse.redirect(`${origin}${destination}`);
}
