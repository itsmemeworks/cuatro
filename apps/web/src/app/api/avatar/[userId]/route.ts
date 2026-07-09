import { NextResponse } from "next/server";
import { readAvatarJpeg } from "@/lib/avatar-storage";

/**
 * Serves a stored avatar (see /api/avatar's POST). Public and unauthenticated
 * on purpose — `users.avatarUrl` is already rendered to anyone who can see
 * the owning circle/session (avatar images carry no more sensitivity than
 * the photo URLs this replaces). The `?v=` query param POST appends on every
 * upload is what invalidates caches, not this route.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;

  let buffer: Buffer | null;
  try {
    buffer = readAvatarJpeg(userId);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (!buffer) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
