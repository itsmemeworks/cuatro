import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { EmptyMessageError, MessageTooLongError, NotMemberError, getCirclesStore } from "@/server/circles";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { id } = await params;

  // Poll-fallback / backfill query: the client passes the timestamp (ms
  // since epoch) of the last message it has and asks for anything newer —
  // used for the initial catch-up if the SSE stream (see
  // messages/stream/route.ts) ever misses a gap.
  const afterParam = request.nextUrl.searchParams.get("after");
  const after = afterParam ? new Date(Number(afterParam)) : undefined;

  const store = await getCirclesStore();
  try {
    const messages = await store.listMessages(id, user.id, after ? { after } : undefined);
    return NextResponse.json({ ok: true, messages });
  } catch (err) {
    if (err instanceof NotMemberError) {
      return NextResponse.json({ ok: false, error: "not_member" }, { status: 403 });
    }
    throw err;
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
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

  const store = await getCirclesStore();
  try {
    const message = await store.postMessage({ circleId: id, userId: user.id, body: text });
    return NextResponse.json({ ok: true, message });
  } catch (err) {
    if (err instanceof NotMemberError) {
      return NextResponse.json({ ok: false, error: "not_member" }, { status: 403 });
    }
    if (err instanceof MessageTooLongError) {
      return NextResponse.json({ ok: false, error: "too_long" }, { status: 400 });
    }
    if (err instanceof EmptyMessageError) {
      return NextResponse.json({ ok: false, error: "empty" }, { status: 400 });
    }
    throw err;
  }
}
