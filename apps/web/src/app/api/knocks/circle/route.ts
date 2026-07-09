import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { createCircleKnock, withdrawCircleKnock } from "@/server/open-door";

// Open Door knocks on a Circle. POST creates a knock (the player asks their way
// in); DELETE withdraws the player's own open knock. The organiser's decision
// lives at ./[knockId]/route.ts. All reads/writes go through server/open-door.ts.

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
  const circleId = record.circleId;
  const message = record.message;
  if (typeof circleId !== "string" || circleId.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  if (message !== undefined && typeof message !== "string") {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const { db } = await getDb();
  const result = await createCircleKnock(db, {
    circleId: circleId.trim(),
    userId: user.id,
    message: typeof message === "string" ? message : null,
  });

  if (!result.ok) {
    const status = result.error === "circle_not_found" ? 404 : 409;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, knockId: result.knockId });
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const circleId = (body as Record<string, unknown>)?.circleId;
  if (typeof circleId !== "string" || circleId.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const { db } = await getDb();
  await withdrawCircleKnock(db, { circleId: circleId.trim(), userId: user.id });
  return NextResponse.json({ ok: true });
}
