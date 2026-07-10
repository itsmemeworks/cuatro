import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { users } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getGuestToken } from "@/lib/guest-session";
import { getGuestUserId } from "@/server/guest";
import { getGamesClient } from "@/server/games-db";
import { saveAvatarJpeg } from "@/lib/avatar-storage";

// A 256px-square JPEG at reasonable quality is a few hundred KB at most;
// the client resizes before sending (selfie-camera.tsx), so anything past
// this is either misuse or a much bigger image than the flow ever produces.
const MAX_DATA_URL_LENGTH = 2_000_000;
const DATA_URL_PATTERN = /^data:image\/(jpeg|png);base64,(.+)$/;

/**
 * Selfie camera's "Use it" -> avatar upload. Works for both a signed-in
 * user and an anonymous guest (identified by the same `cuatro_guest`
 * cookie /api/guest/claim sets) — post-claim avatar capture is explicitly
 * part of the guest flow, not gated behind conversion.
 */
export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  let actorId = sessionUser?.id ?? null;

  const { db } = await getGamesClient();
  if (!actorId) {
    const token = await getGuestToken();
    if (token) actorId = await getGuestUserId(db, token);
  }
  if (!actorId) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  let body: { dataUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const dataUrl = body.dataUrl;
  if (!dataUrl || dataUrl.length > MAX_DATA_URL_LENGTH) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const buffer = Buffer.from(match[2], "base64");
  saveAvatarJpeg(actorId, buffer);

  const avatarUrl = `/api/avatar/${actorId}?v=${Date.now()}`;
  await db.update(users).set({ avatarUrl, updatedAt: Date.now() }).where(eq(users.id, actorId));

  return NextResponse.json({ ok: true, avatarUrl });
}
