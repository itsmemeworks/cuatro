import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { toggleRespect } from "@/server/feed";

/** Toggle 👏 Respect on a verified match's Feed result post — circle members only. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const { db } = await getGamesClient();
  const outcome = toggleRespect(db, id, user.id);

  if (!outcome.ok) {
    const status = outcome.error === "match_not_found" ? 404 : outcome.error === "not_a_circle_member" ? 403 : 400;
    return NextResponse.json({ ok: false, error: outcome.error }, { status });
  }
  return NextResponse.json({ ok: true, respected: outcome.respected, count: outcome.count });
}
