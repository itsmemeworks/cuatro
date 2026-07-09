import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import {
  getSessionSummary,
  checkFourthCallLevel1,
  checkFourthCallLocalRing,
  checkFourthCallPlayedWith,
  playedWithInvitedUserIds,
} from "@/server/games-service";
import { playedWithCandidates } from "@/server/played-with";
import { findFourthCallClaimant } from "@/server/fourth-call";
import { isOrganiser } from "@/server/standing-games-service";
import { getMatchesStore } from "@/server/matches-db";
import { FourthCallSend, type RingState, type PlayedWithRow } from "@/components/circle-screens/fourth-call-send";
import { Avatar, Meta } from "@/components/ui";
import { formatGlass } from "@/lib/design";

export default async function FourthCallSendPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const user = await getSessionUser();
  if (!user) return null;

  const { sessionId } = await params;
  const { db } = await getGamesClient();
  const summary = getSessionSummary(db, sessionId, user.id);
  if (!summary) notFound();

  if (!isOrganiser(db, summary.circleId, user.id)) redirect(`/games/${sessionId}`);

  // Ladder order matters: ring 1, then played-with (ring 2a), then the geo
  // Local Ring (ring 2b) — the geo ring's auto-open gate waits until
  // played-with has had its first-refusal turn (see checkFourthCallLocalRing),
  // so played-with MUST run before it on this same view.
  const result1 = checkFourthCallLevel1(db, sessionId);
  await checkFourthCallPlayedWith(db, sessionId);
  const result2 = await checkFourthCallLocalRing(db, sessionId);

  const gameFull = summary.confirmed.length >= summary.slots;
  const upcoming = summary.session.status === "upcoming" && Date.now() < summary.session.startsAt.getTime();

  const ring1Sent = result1.fired || result1.reason === "already_notified";
  const ring1Label = gameFull
    ? "not needed, the four's full"
    : !upcoming
      ? "this game has already started or been played"
      : ring1Sent
        ? "sent ✓, 20 min first-refusal window"
        : "opens automatically within 48h of kickoff";
  const ring1State: RingState = gameFull || !upcoming || ring1Sent ? "sent" : "pending";

  let ring2State: RingState = "pending";
  let ring2Label = "reaches nearby players at this game's level";
  if (result2.fired) {
    ring2State = "sent";
    ring2Label = `sent to ${result2.notifiedUserIds.length} nearby player${result2.notifiedUserIds.length === 1 ? "" : "s"}, first to tap in gets it`;
  } else if (result2.reason === "already_notified") {
    ring2State = "sent";
    ring2Label = "sent to nearby players, first to tap in gets it";
  } else if (result2.reason === "already_full") {
    ring2State = "done";
    ring2Label = "not needed, the four's full";
  } else if (result2.reason === "no_candidates") {
    ring2State = "done";
    ring2Label = "no nearby players matched this time, try the link instead";
  } else if (result2.reason === "session_not_upcoming") {
    ring2State = "done";
    ring2Label = "this game has already started or been played";
  }

  // Played-with ring (2a). Its faces + per-person invite state come from the
  // candidate query; "sent to N" counts the via="played_with" invites already
  // out (including anyone who has since claimed and dropped off the candidate
  // list). Available candidates exclude circle members, guests, opted-out
  // players, and current session participants — see server/played-with.ts.
  const pwInvitedIds = new Set(playedWithInvitedUserIds(db, sessionId));
  const pwCandidates = await playedWithCandidates(db, sessionId, { limit: 8 });
  const playedWith: PlayedWithRow[] = pwCandidates.map((c) => ({
    userId: c.userId,
    displayName: c.displayName,
    avatarUrl: c.avatarUrl,
    rating: c.rating,
    sharedMatchCount: c.sharedMatchCount,
    lastPlayedWithLabel: c.lastPlayedWithLabel,
    invited: pwInvitedIds.has(c.userId),
  }));
  const pwSentCount = pwInvitedIds.size;

  let playedWithState: RingState = "pending";
  let playedWithLabel = "reaches people from your past games";
  if (gameFull) {
    playedWithState = "done";
    playedWithLabel = "not needed, the four's full";
  } else if (!upcoming) {
    playedWithState = "done";
    playedWithLabel = "this game has already started or been played";
  } else if (pwSentCount > 0) {
    playedWithState = "sent";
    playedWithLabel = `sent to ${pwSentCount} ${pwSentCount === 1 ? "person" : "people"} you've played with, first to tap in gets it`;
  } else if (pwCandidates.length > 0) {
    playedWithState = "pending";
    playedWithLabel = "reaches people from your past games";
  } else {
    playedWithState = "done";
    playedWithLabel = "nobody from your past games is free this time";
  }

  const canEscalate = upcoming && !gameFull && ring2State === "pending";
  const ring3Available = upcoming && !gameFull;

  // "Claimed" — findFourthCallClaimant reads the rsvps.source flag
  // (design/HANDOFF.md gap #5), set only by claimFourthCallSlot's level-2 /
  // ring-3 paths, so this is exact rather than the old hasFourthCallInvite
  // heuristic.
  let claimant: { displayName: string; avatarUrl: string | null; rating: number | null } | null = null;
  const claimantId = findFourthCallClaimant(db, sessionId);
  if (claimantId) {
    const p = summary.confirmed.find((c) => c.userId === claimantId);
    if (p) {
      const glass = await (await getMatchesStore()).getProfileGlassView(p.userId);
      claimant = { displayName: p.displayName, avatarUrl: p.avatarUrl, rating: glass?.rating ?? null };
    }
  }

  const whenLabel = summary.session.startsAt.toLocaleString("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-4">
      <Link href={`/games/${sessionId}`} className="text-cu-body font-bold text-action-strong">
        ‹ Game
      </Link>

      <div>
        <Meta className="uppercase tracking-[0.12em] text-action-strong font-extrabold">Fourth Call · Organiser</Meta>
        <h1 className="text-cu-title text-ink mt-1">
          Find a fourth
          <br />
          for {whenLabel}
        </h1>
        <Meta as="p" className="mt-1.5">
          widening rings, closest people first, strangers never
        </Meta>
      </div>

      <FourthCallSend
        sessionId={sessionId}
        ring1State={ring1State}
        ring1Label={ring1Label}
        playedWithState={playedWithState}
        playedWithLabel={playedWithLabel}
        playedWith={playedWith}
        ring2State={ring2State}
        ring2Label={ring2Label}
        canEscalate={canEscalate}
        ring3Available={ring3Available}
        claimed={!!claimant}
        organiserId={user.id}
      />

      {claimant && (
        <div className="rounded-card bg-win-tint border border-win px-4 py-3.5 flex items-center gap-3">
          <Avatar src={claimant.avatarUrl} name={claimant.displayName} size="md" />
          <div className="min-w-0">
            <p className="text-cu-body font-extrabold text-win">{claimant.displayName} claimed it. That&apos;s four, no &ldquo;let me check and get back to you&rdquo;</p>
            <Meta as="p" className="mt-0.5">
              Glass {formatGlass(claimant.rating)} · the Circle&apos;s been told
            </Meta>
          </div>
        </div>
      )}
    </main>
  );
}
