import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { getUnreadCountForCircle } from "@/server/circle-unread";

/** This Circle's unread chat count for the viewer (design/DESIGN-AUDIT.md F3) — the "Chat ·N" segment label. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const { db } = await getGamesClient();
  const count = await getUnreadCountForCircle(db, id, user.id);

  return NextResponse.json({ ok: true, count });
}
