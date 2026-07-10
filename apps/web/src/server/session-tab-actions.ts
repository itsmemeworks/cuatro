"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "./games-db";
import { createTabSplitForSession } from "./session-tab";

/** "📍 goes on the Tab" one-tap action (design/DESIGN-AUDIT.md F4) — bound with the sessionId on the session detail page. */
export async function createTabSplitForSessionAction(sessionId: string, _formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  const { db } = await getGamesClient();
  await createTabSplitForSession(db, sessionId, user.id);

  revalidatePath(`/games/${sessionId}`);
}
