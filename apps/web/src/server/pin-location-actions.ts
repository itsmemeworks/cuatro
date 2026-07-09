"use server";

/**
 * "📍 Pin location to the Lot's chat" (design/DESIGN-AUDIT.md S1/F5) — posts
 * a formatted location message into the Circle's chat via server/circles.ts's
 * postMessage, so it shows up exactly like any other chat message (same
 * realtime broadcast, same backfill).
 */
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/session";
import { getCirclesStore } from "./circles";
import { googleMapsUrl } from "@/lib/directions";

export async function pinVenueLocationAction(
  circleId: string,
  venueName: string,
  venueAddress: string | null,
  _formData: FormData,
): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  const mapsUrl = googleMapsUrl(venueAddress || venueName);
  const body = venueAddress ? `📍 ${venueName} — ${venueAddress} ${mapsUrl}` : `📍 ${venueName} ${mapsUrl}`;

  const store = await getCirclesStore();
  try {
    await store.postMessage({ circleId, userId: user.id, body });
  } catch {
    // Best-effort: a since-removed member (or an empty/too-long body, which
    // can't actually happen here since `body` is server-built) just no-ops
    // rather than crashing the session page.
  }

  revalidatePath(`/circles/${circleId}`);
}
