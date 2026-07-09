"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LAST_CIRCLE_STORAGE_KEY } from "./remember-last-circle";

/**
 * Resolves "which Circle" for the Circle and Tab nav tabs client-side —
 * localStorage isn't available during the server render that (app)/feed and
 * (app)/tab's page.tsx components do — then replaces the URL with the
 * canonical detail route. `/circles/[id]` remains the canonical Circle
 * page and `/circles/[id]/tab` the canonical Tab page; these nav tabs are
 * thin resolvers in front of them.
 */
export function CircleTabRedirect({ circleIds, suffix = "" }: { circleIds: string[]; suffix?: string }) {
  const router = useRouter();

  useEffect(() => {
    let target = circleIds[0];
    try {
      const last = window.localStorage.getItem(LAST_CIRCLE_STORAGE_KEY);
      if (last && circleIds.includes(last)) target = last;
    } catch {
      // fall through to the first Circle
    }
    router.replace(`/circles/${target}${suffix}`);
  }, [circleIds, suffix, router]);

  return null;
}
