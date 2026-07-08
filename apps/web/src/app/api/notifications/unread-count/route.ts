import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { getUnreadCount } from "@/server/notifications";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { db } = await getGamesClient();
  return NextResponse.json({ ok: true, unreadCount: getUnreadCount(db, user.id) });
}
