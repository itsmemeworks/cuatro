"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/session";
import { getMatchesStore } from "@/server/matches-db";
import type { SetScore } from "@cuatro/db";

function parseSets(formData: FormData): SetScore[] {
  const sets: SetScore[] = [];
  for (let i = 1; i <= 3; i++) {
    const aRaw = formData.get(`set${i}_a`);
    const bRaw = formData.get(`set${i}_b`);
    if (aRaw === null || bRaw === null || aRaw === "" || bRaw === "") continue;
    const a = Number(aRaw);
    const b = Number(bRaw);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    sets.push({ a, b });
  }
  return sets;
}

export async function recordMatchAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  const teamA1 = String(formData.get("teamA1") ?? "");
  const teamA2 = String(formData.get("teamA2") ?? "");
  const teamB1 = String(formData.get("teamB1") ?? "");
  const teamB2 = String(formData.get("teamB2") ?? "");
  if (!sessionId || !teamA1 || !teamA2 || !teamB1 || !teamB2) return;

  const sets = parseSets(formData);
  if (sets.length === 0) return;

  const store = await getMatchesStore();
  const { matchId } = await store.recordMatch({
    sessionId,
    reporterId: user.id,
    teamA: [teamA1, teamA2],
    teamB: [teamB1, teamB2],
    sets,
  });

  revalidatePath("/home");
  redirect(`/matches/${matchId}`);
}

export async function confirmMatchAction(matchId: string, _formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  const store = await getMatchesStore();
  await store.confirmMatch(matchId, user.id);

  revalidatePath(`/matches/${matchId}`);
  revalidatePath("/profile");
  revalidatePath("/profile/ledger");
}

export async function disputeMatchAction(matchId: string, _formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  const store = await getMatchesStore();
  await store.disputeMatch(matchId, user.id);

  revalidatePath(`/matches/${matchId}`);
}
