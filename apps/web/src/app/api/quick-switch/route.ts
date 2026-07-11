import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { buildQuickSwitchData } from "@/server/quick-switch";

/**
 * GET /api/quick-switch — the ⌘K switcher's lazily-fetched entries (people +
 * upcoming games across the viewer's circles). Read-only; fetched once on the
 * switcher's first open and cached client-side (components/shell/hotkeys.tsx).
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { db } = await getDb();
  const data = await buildQuickSwitchData(db, user.id);
  return NextResponse.json({ ok: true, ...data });
}
