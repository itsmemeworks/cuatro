import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { markCircleRead } from "@/server/circle-unread";

/** Marks the viewer's Chat segment as read up to now (design/DESIGN-AUDIT.md F3) — called on chat mount + on new-message-while-open. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const { db } = await getGamesClient();
  const marked = markCircleRead(db, id, user.id);

  return NextResponse.json({ ok: true, marked });
}
