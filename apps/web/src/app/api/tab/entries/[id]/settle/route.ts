import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { proposeOrConfirmSettle } from "@/server/tab";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const { db } = await getDb();
  const outcome = await proposeOrConfirmSettle(db, id, user.id);

  if (!outcome.ok) {
    const status = outcome.error === "not_found" ? 404 : 403;
    return NextResponse.json({ ok: false, error: outcome.error }, { status });
  }
  return NextResponse.json(outcome);
}
