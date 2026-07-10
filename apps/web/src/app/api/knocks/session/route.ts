import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { createSessionKnock, withdrawSessionKnock } from "@/server/discovery";

// A knock is a player asking their way into a game they found on The Board.
// POST creates one (honouring one-open-knock); DELETE withdraws the player's
// own pending knock. The organiser's accept/decline lives in ./decide.
const MAX_MESSAGE_LENGTH = 280;

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const record = (body ?? {}) as Record<string, unknown>;
  const sessionId = record.sessionId;
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  let message: string | null = null;
  if (record.message != null) {
    if (typeof record.message !== "string") {
      return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
    }
    const trimmed = record.message.trim();
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ ok: false, error: "too_long" }, { status: 400 });
    }
    message = trimmed.length > 0 ? trimmed : null;
  }

  const { db } = await getDb();
  const result = await createSessionKnock(db, sessionId.trim(), user.id, message);
  if (!result.ok) {
    // already_knocked / already_member / already_in / already_full are
    // expected conflicts, not server faults — 409.
    const status = result.error === "session_not_found" ? 404 : 409;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, knockId: result.knock.id });
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  // Accept the sessionId from the querystring (?sessionId=) or a JSON body, so
  // a plain fetch(..., { method: "DELETE" }) with either shape works.
  let sessionId = request.nextUrl.searchParams.get("sessionId") ?? undefined;
  if (!sessionId) {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      if (typeof body?.sessionId === "string") sessionId = body.sessionId;
    } catch {
      // no body — fall through to the missing-id check below
    }
  }
  if (!sessionId || sessionId.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const { db } = await getDb();
  const result = await withdrawSessionKnock(db, sessionId.trim(), user.id);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
