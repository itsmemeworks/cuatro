import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { decideSessionKnock } from "@/server/discovery";

// The organiser side of a session knock: accept (RSVPs the asker in as a
// session participant) or decline. Organiser-only — the service enforces it.
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
  const knockId = record.knockId;
  const decision = record.decision;
  if (typeof knockId !== "string" || knockId.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  if (decision !== "accept" && decision !== "decline") {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const { db } = await getDb();
  const result = await decideSessionKnock(db, knockId.trim(), user.id, decision);
  if (!result.ok) {
    const status =
      result.error === "knock_not_found" ? 404 : result.error === "not_an_organiser" ? 403 : 409;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, decision: result.decision, filled: result.filled });
}
