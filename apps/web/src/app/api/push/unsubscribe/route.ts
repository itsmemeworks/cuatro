import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { removeSubscription } from "@/lib/push";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  let endpoint: string;
  try {
    const body = await request.json();
    if (!body?.endpoint || typeof body.endpoint !== "string") throw new Error("missing endpoint");
    endpoint = body.endpoint;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_subscription" }, { status: 400 });
  }

  await removeSubscription(endpoint);
  return NextResponse.json({ ok: true });
}
