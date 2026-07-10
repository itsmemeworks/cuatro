import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { getUnreadCount, listNotificationsForUser } from "@/server/notifications";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { db } = await getGamesClient();
  const groups = await listNotificationsForUser(db, user.id);
  const unreadCount = await getUnreadCount(db, user.id);
  return NextResponse.json({ ok: true, groups, unreadCount });
}
