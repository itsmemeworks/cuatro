import { NextRequest, NextResponse } from "next/server";
import { getAuthStore } from "@/lib/auth-store";
import { getMailer } from "@/lib/mailer";
import { legacyAuthEnabled } from "@/lib/session";
import { isSafeRelativePath, resolveRequestOrigin } from "@/lib/safe-redirect";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";

const FIFTEEN_MIN = 15 * 60_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Legacy custom magic-link request — only reachable with AUTH_LEGACY=1 (see
 * ../../../lib/session.ts). Supabase Auth (signInWithOtp, called from the
 * login page) is the primary flow now; this stays wired up purely so
 * automated E2E tests can sign in without hosted email delivery.
 */
export async function POST(request: NextRequest) {
  if (!legacyAuthEnabled()) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  let email: unknown;
  let next: unknown;
  try {
    const body = await request.json();
    email = body?.email;
    next = body?.next;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }

  // Email flood guard: tight per-email cap (a single inbox can't be bombed),
  // looser per-IP cap (one client can't enumerate many addresses). Keyed after
  // validation so junk requests don't churn buckets.
  const limited = enforceRateLimit([
    { key: `auth:email:${email.toLowerCase()}`, max: 5, windowMs: FIFTEEN_MIN },
    { key: `auth:ip:${clientIp(request)}`, max: 20, windowMs: FIFTEEN_MIN },
  ]);
  if (limited) return limited;

  const store = await getAuthStore();
  const user = await store.findOrCreateUserByEmail(email);
  const token = await store.createMagicLinkToken(user.id, user.email);

  const origin = resolveRequestOrigin(request);
  let verifyUrl = `${origin}/api/auth/verify?token=${token}`;
  // `next` (e.g. "/join/ABC123") carries the post-verify destination through
  // the magic-link email — only ever a validated same-origin relative path,
  // never trusted as-is. Silently dropped rather than erroring the whole
  // request when it fails validation.
  if (isSafeRelativePath(next)) {
    verifyUrl += `&next=${encodeURIComponent(next)}`;
  }

  const mailer = getMailer();
  await mailer.sendMagicLink(user.email, verifyUrl);

  return NextResponse.json({ ok: true });
}
