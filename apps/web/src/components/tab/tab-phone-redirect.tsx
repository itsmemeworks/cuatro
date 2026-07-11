"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { BP_TABLET_MIN } from "@/components/shell/contract";
import { LAST_CIRCLE_STORAGE_KEY } from "@/components/circles/remember-last-circle";

/**
 * The phone `/tab` has always been a thin resolver that redirects to the
 * last-viewed (or first) Circle's canonical Tab page — see
 * components/circles/circle-tab-redirect.tsx, whose behaviour this reproduces.
 * Wave B adds a real wide "all Circles" Tab at that same route, so the redirect
 * must only fire on the phone: at >= 900px the wide aggregate view renders in
 * its place, and redirecting away from it would defeat the point.
 *
 * The width check runs once on mount (matchMedia, not a resize listener): the
 * shell branches on the same breakpoint via CSS, and a viewport that starts
 * wide stays on the aggregate. Below 900 this is byte-for-byte the old
 * CircleTabRedirect, so the phone `/tab` is unchanged.
 */
export function TabPhoneRedirect({ circleIds }: { circleIds: string[] }) {
  const router = useRouter();

  useEffect(() => {
    if (window.matchMedia(`(min-width: ${BP_TABLET_MIN}px)`).matches) return; // wide: the aggregate view owns this route

    let target = circleIds[0];
    try {
      const last = window.localStorage.getItem(LAST_CIRCLE_STORAGE_KEY);
      if (last && circleIds.includes(last)) target = last;
    } catch {
      // fall through to the first Circle
    }
    router.replace(`/circles/${target}/tab`);
  }, [circleIds, router]);

  return null;
}
