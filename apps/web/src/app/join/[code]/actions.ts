"use server";

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getCirclesStore } from "@/server/circles";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function joinCircleAction(formData: FormData): Promise<void> {
  const code = String(formData.get("code") ?? "").trim();
  if (!code) redirect("/circles");

  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/join/${code}`)}`);

  // Shares the authed join budget with POST /api/circles/join (same key). A
  // redirect-based surface can't return 429, so a tripped limit bounces back to
  // the invite page with a warm notice (see page.tsx's rate_limited branch).
  if (enforceRateLimit([{ key: `join:${user.id}`, max: 10, windowMs: 5 * 60_000 }])) {
    redirect(`/join/${code}?error=rate_limited`);
  }

  const store = await getCirclesStore();
  const result = await store.joinCircle({ inviteCode: code, userId: user.id });
  if (!result) redirect("/circles?error=invalid_invite");
  if (result.full) redirect(`/join/${code}?error=circle_full`);

  redirect(`/circles/${result.circleId}`);
}
