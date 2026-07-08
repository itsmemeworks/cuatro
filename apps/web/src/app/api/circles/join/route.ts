import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getCirclesStore } from "@/server/circles";

// Fetch-based counterpart to the join/[code] server action, used by any
// client-side join affordance (e.g. re-join from an already-open tab).
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const inviteCode = (body as Record<string, unknown>)?.inviteCode;
  if (typeof inviteCode !== "string" || inviteCode.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "invalid_invite_code" }, { status: 400 });
  }

  const store = await getCirclesStore();
  const result = await store.joinCircle({ inviteCode: inviteCode.trim(), userId: user.id });
  if (!result) {
    return NextResponse.json({ ok: false, error: "invalid_invite_code" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, ...result });
}
