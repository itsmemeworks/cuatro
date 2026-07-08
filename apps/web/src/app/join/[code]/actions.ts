"use server";

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getCirclesStore } from "@/server/circles";

export async function joinCircleAction(formData: FormData): Promise<void> {
  const code = String(formData.get("code") ?? "").trim();
  if (!code) redirect("/circles");

  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/join/${code}`)}`);

  const store = await getCirclesStore();
  const result = await store.joinCircle({ inviteCode: code, userId: user.id });
  if (!result) redirect("/circles?error=invalid_invite");

  redirect(`/circles/${result.circleId}`);
}
