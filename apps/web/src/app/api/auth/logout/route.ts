import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthStore } from "@/lib/auth-store";
import { clearSessionCookie, SESSION_COOKIE } from "@/lib/session";

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    const store = await getAuthStore();
    await store.deleteSession(token);
  }
  await clearSessionCookie();

  return NextResponse.redirect(new URL("/", request.url));
}
