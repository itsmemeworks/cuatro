import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { circles } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { circlePreview } from "@/server/open-door";
import { circleDiscoverable } from "@/server/session-viewer";

// A Circle's PUBLIC pre-join preview — the same aggregate-only facts the Open
// Door / Discover cards carry inline (server/open-door.ts circlePreview),
// served lazily so surfaces that only know a circleId (Board cards, Discover
// game cards, an outsider's game page header) can open the preview sheet
// without shipping every roster up front. Discoverable Circles only: a private
// Circle (door shut AND Board off) 404s exactly like a Circle that doesn't
// exist, so this route can't be used to enumerate private groups.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const { db } = await getDb();

  if (!(await circleDiscoverable(db, id))) {
    return NextResponse.json({ ok: false, error: "circle_not_found" }, { status: 404 });
  }

  const preview = await circlePreview(db, id, user.id);
  if (!preview) return NextResponse.json({ ok: false, error: "circle_not_found" }, { status: 404 });

  const [circle] = await db.select({ openDoor: circles.openDoor }).from(circles).where(eq(circles.id, id));

  // Explicit client shape (components/discover/circle-preview-sheet.tsx's
  // CirclePreviewData) — never the whole server view.
  return NextResponse.json({
    ok: true,
    preview: {
      circleId: preview.circleId,
      name: preview.name,
      vibeLine: preview.vibeLine,
      level: preview.level,
      venueArea: preview.venueArea,
      distanceLabel: preview.distanceLabel,
      cadence: preview.cadence,
      memberCount: preview.memberCount,
      members: preview.members,
      openDoor: circle?.openDoor ?? false,
      hasPendingKnock: preview.hasPendingKnock,
    },
  });
}
