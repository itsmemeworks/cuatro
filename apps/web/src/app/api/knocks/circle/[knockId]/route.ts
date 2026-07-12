import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { knocks } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { decideCircleKnock } from "@/server/open-door";

// Organiser's decision on a Circle knock: accept (→ a real membership, one
// synchronous transaction) or decline. Both notify the knocker. Only an
// organiser of the knock's target Circle may decide; server/open-door.ts
// enforces that and the "already decided" race.
export async function POST(request: NextRequest, { params }: { params: Promise<{ knockId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { knockId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const action = (body as Record<string, unknown>)?.action;
  if (action !== "accept" && action !== "decline") {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const { db } = await getDb();
  const result = await decideCircleKnock(db, { knockId, organiserId: user.id, action });

  if (!result.ok) {
    const status = result.error === "knock_not_found" ? 404 : result.error === "not_organiser" ? 403 : 409;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  // The decision changed the circle's knock queue — and on accept, its ROSTER
  // (fix wave F3's join/knock revalidation cluster): revalidate the circle
  // subtree ("layout" reaches /members and /settings) plus the lists, so no
  // cached RSC payload can serve the pre-decision roster. One indexed read for
  // the circle id; decideCircleKnock deliberately returns only ok/error.
  const [knock] = await db.select({ targetId: knocks.targetId }).from(knocks).where(eq(knocks.id, knockId)).limit(1);
  if (knock) {
    revalidatePath(`/circles/${knock.targetId}`, "layout");
    revalidatePath("/circles");
    revalidatePath("/home");
  }

  return NextResponse.json({ ok: true });
}
