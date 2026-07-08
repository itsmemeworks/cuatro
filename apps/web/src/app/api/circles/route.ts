import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getCirclesStore } from "@/server/circles";

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

  const { name, emblem, colour, timezone } = (body ?? {}) as Record<string, unknown>;
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "invalid_name" }, { status: 400 });
  }

  const store = await getCirclesStore();
  const circle = await store.createCircle({
    name,
    emblem: typeof emblem === "string" ? emblem : null,
    colour: typeof colour === "string" ? colour : null,
    timezone: typeof timezone === "string" ? timezone : undefined,
    creatorUserId: user.id,
  });

  return NextResponse.json({ ok: true, circle });
}
