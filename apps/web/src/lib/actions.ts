"use server";

import { revalidatePath } from "next/cache";
import { getAuthStore } from "@/lib/auth-store";
import { getSessionUser } from "@/lib/session";

export async function updateDisplayNameAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  const displayName = String(formData.get("displayName") ?? "").trim();
  if (!displayName) return;

  const store = await getAuthStore();
  await store.updateDisplayName(user.id, displayName);
  revalidatePath("/profile");
}
