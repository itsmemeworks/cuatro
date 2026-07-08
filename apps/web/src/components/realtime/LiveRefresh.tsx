"use client";

/**
 * Drop this into a server-rendered page to make it live without giving that
 * page any client-side state of its own: on any circle/session/user
 * broadcast it calls `router.refresh()`, which re-runs the page's server
 * components (fresh data) while leaving already-mounted client components
 * (e.g. CircleChat's own message list) untouched. Pass only the ids that
 * page cares about — an omitted id just means that hook never subscribes
 * (see useCircleLive/useSessionLive/useUserLive's null-id no-op).
 *
 * Renders nothing; it exists purely for its subscription side effects.
 */
import { useRouter } from "next/navigation";
import { useCircleLive, useSessionLive, useUserLive } from "@/lib/realtime/hooks";

export function LiveRefresh({
  circleId,
  sessionId,
  userId,
}: {
  circleId?: string | null;
  sessionId?: string | null;
  userId?: string | null;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();

  useCircleLive(circleId, refresh);
  useSessionLive(sessionId, refresh);
  useUserLive(userId, refresh);

  return null;
}
