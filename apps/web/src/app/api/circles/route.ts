import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import {
  getCirclesStore,
  InvalidCircleNameError,
  InvalidColourError,
  InvalidEmblemError,
  InvalidHeaderImageError,
  InvalidHomeVenueError,
  InvalidMaxMembersError,
} from "@/server/circles";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const { name, emblem, colour, timezone, headerImage, homeVenueId, maxMembers } = (body ?? {}) as Record<
    string,
    unknown
  >;
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "invalid_name" }, { status: 400 });
  }

  const store = await getCirclesStore();
  let circle;
  try {
    circle = await store.createCircle({
      name,
      emblem: typeof emblem === "string" ? emblem : null,
      colour: typeof colour === "string" ? colour : null,
      headerImage: typeof headerImage === "string" ? headerImage : null,
      homeVenueId: typeof homeVenueId === "string" ? homeVenueId : null,
      maxMembers: typeof maxMembers === "number" ? maxMembers : maxMembers === null ? null : undefined,
      timezone: typeof timezone === "string" ? timezone : undefined,
      creatorUserId: user.id,
    });
  } catch (err) {
    if (err instanceof InvalidCircleNameError) {
      return NextResponse.json({ ok: false, error: "invalid_name" }, { status: 400 });
    }
    if (err instanceof InvalidEmblemError) {
      return NextResponse.json({ ok: false, error: "invalid_emblem" }, { status: 400 });
    }
    if (err instanceof InvalidColourError) {
      return NextResponse.json({ ok: false, error: "invalid_colour" }, { status: 400 });
    }
    if (err instanceof InvalidHeaderImageError) {
      return NextResponse.json({ ok: false, error: "invalid_header_image" }, { status: 400 });
    }
    if (err instanceof InvalidHomeVenueError) {
      return NextResponse.json({ ok: false, error: "invalid_home_venue" }, { status: 400 });
    }
    if (err instanceof InvalidMaxMembersError) {
      return NextResponse.json({ ok: false, error: "invalid_max_members" }, { status: 400 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true, circle });
}
