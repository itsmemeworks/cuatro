import { NextRequest, NextResponse } from "next/server";
import { getAuthStore } from "@/lib/auth-store";
import { getMailer } from "@/lib/mailer";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  let email: unknown;
  try {
    const body = await request.json();
    email = body?.email;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }

  const store = await getAuthStore();
  const user = await store.findOrCreateUserByEmail(email);
  const token = await store.createMagicLinkToken(user.id, user.email);

  const origin = request.nextUrl.origin;
  const verifyUrl = `${origin}/api/auth/verify?token=${token}`;

  const mailer = getMailer();
  await mailer.sendMagicLink(user.email, verifyUrl);

  return NextResponse.json({ ok: true });
}
