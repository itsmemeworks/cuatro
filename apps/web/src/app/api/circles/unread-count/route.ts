import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { listCirclesForUser } from "@/server/standing-games-service";
import { hasUnreadMessages } from "@/server/circle-unread";

/**
 * Aggregate across every Circle the viewer belongs to (design/
 * DESIGN-AUDIT.md F3/N2) — same {hasUnread: boolean} dot shape as
 * /api/tab/has-open-entries, ready for the nav Circle-item dot. Not wired
 * into components/bottom-nav.tsx from here — that file is the pixel-perfect
 * wave's (nav is out of scope for this pass).
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { db } = await getGamesClient();
  const circleIds = (await listCirclesForUser(db, user.id)).map((c) => c.circleId);
  const hasUnread = await hasUnreadMessages(db, circleIds, user.id);

  return NextResponse.json({ ok: true, hasUnread });
}
