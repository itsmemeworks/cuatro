import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { markAllNotificationsRead } from "@/server/notifications";

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { db } = await getGamesClient();
  const count = markAllNotificationsRead(db, user.id);
  return NextResponse.json({ ok: true, count });
}
