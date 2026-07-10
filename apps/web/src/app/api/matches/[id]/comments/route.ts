import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { addComment, listComments } from "@/server/comments";

function statusFor(error: string): number {
  if (error === "match_not_found") return 404;
  if (error === "not_a_circle_member") return 403;
  return 400;
}

/** The comment thread for a verified match's Feed result post — circle members only. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const { db } = await getGamesClient();
  const outcome = await listComments(db, id, user.id);

  if (!outcome.ok) return NextResponse.json({ ok: false, error: outcome.error }, { status: statusFor(outcome.error) });
  return NextResponse.json({ ok: true, comments: outcome.comments });
}

/** Post a 💬 comment on a verified match's Feed result post — circle members only. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const text = (body as Record<string, unknown>)?.body;
  if (typeof text !== "string") {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const { db } = await getGamesClient();
  const outcome = await addComment(db, id, user.id, text);

  if (!outcome.ok) return NextResponse.json({ ok: false, error: outcome.error }, { status: statusFor(outcome.error) });
  return NextResponse.json({ ok: true, comment: outcome.comment, count: outcome.count });
}
