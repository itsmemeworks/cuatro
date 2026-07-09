import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { addSplitEntry } from "@/server/tab";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const { circleId, totalAmountMinor, debtorUserIds, currency, sessionId, description } = body;
  if (
    typeof circleId !== "string" ||
    typeof totalAmountMinor !== "number" ||
    !Array.isArray(debtorUserIds) ||
    !debtorUserIds.every((id) => typeof id === "string")
  ) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const { db } = await getDb();
  const result = addSplitEntry(db, {
    circleId,
    payerUserId: user.id,
    debtorUserIds,
    totalAmountMinor,
    currency: typeof currency === "string" ? currency : undefined,
    sessionId: typeof sessionId === "string" ? sessionId : null,
    description: typeof description === "string" ? description : null,
  });

  if (!result.ok) {
    const status = result.error === "not_a_circle_member" ? 403 : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, entries: result.entries, payerShareMinor: result.payerShareMinor });
}
