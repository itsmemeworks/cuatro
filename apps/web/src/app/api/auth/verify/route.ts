import { NextRequest, NextResponse } from "next/server";
import { getAuthStore } from "@/lib/auth-store";
import { setSessionCookie } from "@/lib/session";
import { isSafeRelativePath } from "@/lib/safe-redirect";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const next = request.nextUrl.searchParams.get("next");
  const origin = request.nextUrl.origin;

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
