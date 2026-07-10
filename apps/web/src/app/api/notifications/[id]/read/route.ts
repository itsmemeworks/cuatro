import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { markNotificationRead } from "@/server/notifications";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const { db } = await getGamesClient();
  const changed = await markNotificationRead(db, id, user.id);
  return NextResponse.json({ ok: true, changed });
}
