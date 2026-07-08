import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getVapidPublicKey, saveSubscription, type StoredPushSubscription } from "@/lib/push";

export async function GET() {
  return NextResponse.json({ publicKey: getVapidPublicKey() });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  let sub: StoredPushSubscription;
  try {
    const body = await request.json();
    if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
      throw new Error("missing fields");
    }
    sub = { endpoint: body.endpoint, keys: { p256dh: body.keys.p256dh, auth: body.keys.auth } };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_subscription" }, { status: 400 });
  }

  saveSubscription(user.id, sub);
  return NextResponse.json({ ok: true });
}
