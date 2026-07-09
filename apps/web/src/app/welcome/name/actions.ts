"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthStore } from "@/lib/auth-store";
import { getSessionUser } from "@/lib/session";
import { isSafeRelativePath } from "@/lib/safe-redirect";
import { NAME_PROMPTED_COOKIE, NAME_PROMPTED_MAX_AGE_SECONDS } from "@/lib/entry-cookies";

/**
 * Saves the name chosen on the first-run name step (app/welcome/name), then
 * continues to the original ?next= destination. Skipping submits the same
 * action with no usable name — that just records the "seen it" cookie and
 * moves on, so the step never nags again. Either way the cookie is set (see
 * lib/entry-cookies.ts) and control returns to `next`.
 */
export async function saveNameAction(formData: FormData): Promise<void> {
  const rawNext = String(formData.get("next") ?? "");
  const next = isSafeRelativePath(rawNext) ? rawNext : "/home";

  const displayName = String(formData.get("displayName") ?? "").trim();
  const skipped = formData.get("intent") === "skip";

  if (!skipped && displayName) {
    const user = await getSessionUser();
    if (user) {
      const store = await getAuthStore();
      await store.updateDisplayName(user.id, displayName);
    }
  }

  const cookieStore = await cookies();
  cookieStore.set(NAME_PROMPTED_COOKIE, "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: NAME_PROMPTED_MAX_AGE_SECONDS,
  });

  redirect(next);
}
