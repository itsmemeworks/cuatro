import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { getCirclesStore } from "@/server/circles";
import { hasOpenEntriesAgainstViewer } from "@/server/tab";

/** Backs the Tab nav item's coral dot (see components/bottom-nav.tsx) — refetched on every realtime event on the viewer's user channel, same pattern as /api/notifications/unread-count. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { db } = await getDb();
  const store = await getCirclesStore();
  const circles = await store.listCirclesForUser(user.id);
  const hasOpenEntries = await hasOpenEntriesAgainstViewer(
    db,
    circles.map((c) => c.id),
    user.id,
  );
  return NextResponse.json({ ok: true, hasOpenEntries });
}
