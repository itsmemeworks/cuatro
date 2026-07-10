"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/session";
import { getMatchesStore, MatchAlreadyRecordedError, type PendingGuest } from "@/server/matches-db";
import type { SetScore } from "@cuatro/db";

/**
 * The roster editor may swap in named substitutes who have no account yet.
 * Each is submitted as a client-side token in the four team slots, with the
 * token→name pairs carried in a single `guests` JSON field. recordMatch
 * turns them into guest `users` rows inside its own transaction; here we only
 * shape and bound the input. Anything malformed is dropped rather than
 * trusted — an unresolved token in a slot then fails recordMatch's own
 * "four distinct players" check, never a silent bad write.
 */
function parseGuests(formData: FormData): PendingGuest[] {
  const raw = formData.get("guests");
  if (typeof raw !== "string" || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const guests: PendingGuest[] = [];
  for (const item of parsed) {
    if (item && typeof item === "object" && typeof (item as PendingGuest).token === "string" && typeof (item as PendingGuest).name === "string") {
      guests.push({ token: (item as PendingGuest).token, name: (item as PendingGuest).name });
    }
  }
  return guests.slice(0, 4);
}

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

  // A retired match may legitimately have no score at all (ended before a
  // set finished) — only a normal completed result needs at least one set;
  // matches-db.recordMatch enforces the same rule server-side.
  const retired = formData.get("retired") === "retired";
  const sets = parseSets(formData);
  if (sets.length === 0 && !retired) return;

  const newGuests = parseGuests(formData);

  const store = await getMatchesStore();
  let matchId: string;
  try {
    ({ matchId } = await store.recordMatch({
      sessionId,
      reporterId: user.id,
      teamA: [teamA1, teamA2],
      teamB: [teamB1, teamB2],
      sets,
      outcome: retired ? "retired" : "completed",
      newGuests,
    }));
  } catch (err) {
    // One match per session: if someone beat this reporter to it, send them
    // to the existing result to confirm it instead of minting a duplicate
    // (which would double-run Glass and Reliability).
    if (err instanceof MatchAlreadyRecordedError) {
      revalidatePath("/home");
      redirect(`/matches/${err.existingMatchId}?already=1`);
    }
    throw err;
  }

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
