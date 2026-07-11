import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { setFourthCallSideHint } from "@/server/fourth-call";

/**
 * Organiser sets (or clears) the optional Fourth Call side hint (issue #21):
 * POST { hint: "left" | "right" | null }. Display copy only — nothing about
 * who can see or claim the call changes (see setFourthCallSideHint). The
 * organiser check happens inside the service transaction.
 */
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  const { sessionId } = await params;

  let hint: unknown;
  try {
    const body = await request.json();
    hint = body && typeof body === "object" ? (body as { hint?: unknown }).hint ?? null : null;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_hint" }, { status: 400 });
  }

  const { db } = await getGamesClient();
  const outcome = await setFourthCallSideHint(db, sessionId, user.id, hint);
  if (!outcome.ok) {
    const status =
      outcome.error === "session_not_found" ? 404 : outcome.error === "not_an_organiser" ? 403 : 400;
    return NextResponse.json({ ok: false, error: outcome.error }, { status });
  }
  return NextResponse.json({ ok: true, sideHint: outcome.sideHint });
}
