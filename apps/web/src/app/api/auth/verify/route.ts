import { NextRequest, NextResponse } from "next/server";
import { getAuthStore } from "@/lib/auth-store";
import { setSessionCookie } from "@/lib/session";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
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

  return NextResponse.redirect(`${origin}/home`);
}
