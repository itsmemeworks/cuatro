import type { Metadata } from "next";
import { getSessionUser } from "@/lib/session";
import { getGuestToken } from "@/lib/guest-session";
import { getGamesClient } from "@/server/games-db";
import { getSessionSummary } from "@/server/games-service";
import { parseRing3ClaimToken } from "@/server/fourth-call";
import { getGuestUserId } from "@/server/guest";
import { getMatchesStore } from "@/server/matches-db";
import { formatDateTime } from "@/lib/time";
import { AvatarStack, Meta } from "@/components/ui";
import { RosterList } from "@/components/games/roster";
import { FourthCallLinkClaim } from "@/components/circle-screens/fourth-call-link-claim";
import { GuestClaimFlow, type GuestFlowInitial } from "@/components/entry/guest-claim-flow";
import { RefreshOnFocus } from "@/components/entry/refresh-on-focus";
import { PresenceTracker } from "@/components/realtime/PresenceTracker";
import { resolveGuestFlowInitial } from "./guest-flow-initial";

/**
 * Fourth Call ring 3's public claim page — "anyone with the link"
 * (design/HANDOFF.md screen 6) — and the "10-second promise" join-via-link
 * growth flow (screen 2 / Directions turn 11). No account or circle
 * membership needed to see it (same trust model as /join/[code] and
 * /games/[sessionId]'s generateMetadata — getSessionSummary has no
 * membership gate on reads). Two claim paths depending on who's looking:
 *   - signed in (a circle member, or anyone who already has an account):
 *     the existing FourthCallLinkClaim button, unchanged.
 *   - anonymous: GuestClaimFlow — claim -> name -> done with no sign-in at
 *     all, per server/guest.ts. Account creation is deferred to a quiet
 *     "make it yours" prompt on the done step, converted at /auth/callback.
 */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const parsed = parseRing3ClaimToken(token);
  if (!parsed) return { title: "CUATRO invite" };

  const { db } = await getGamesClient();
  const summary = await getSessionSummary(db, parsed.sessionId, "");
  if (!summary) return { title: "CUATRO invite", description: "This invite link is invalid or has expired." };

  // The preview must tell the same truth as the page (QA6): a full session
  // never advertises an open spot. Explicit timezone — the runtime is UTC.
  const isFull = summary.confirmed.length >= summary.slots;
  const when = formatDateTime(summary.session.startsAt, summary.timezone);
  const title = isFull ? `${summary.circleName} found their fourth` : `${summary.circleName} needs a fourth`;
  const description = isFull
    ? `The four's set for ${when}. If a spot opens up, this link comes back to life.`
    : `A game is short a player for ${when}. Tap in if you can make it.`;

  return { title, description };
}

export default async function FourthCallLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = parseRing3ClaimToken(token);

  if (!parsed) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12 text-center gap-3 bg-ground text-ink min-[900px]:bg-transparent">
        <h1 className="text-cu-title">Link not found</h1>
        <p className="text-cu-body text-ink-muted max-w-xs">
          This invite link is invalid or has expired. Ask whoever sent it for a new one.
        </p>
      </main>
    );
  }

  const user = await getSessionUser();
  const { db } = await getGamesClient();
  const summary = await getSessionSummary(db, parsed.sessionId, user?.id ?? "");

  if (!summary || summary.session.status !== "upcoming" || Date.now() >= summary.session.startsAt) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12 text-center gap-3 bg-ground text-ink min-[900px]:bg-transparent">
        <h1 className="text-cu-title">This game&apos;s kicked off</h1>
        <p className="text-cu-body text-ink-muted max-w-xs">
          This invite is for a game that&apos;s already started or been played.
        </p>
      </main>
    );
  }

  const matchesStore = await getMatchesStore();
  const ratings = (
    await Promise.all(summary.confirmed.map(async (p) => (await matchesStore.getProfileGlassView(p.userId))?.rating ?? null))
  ).filter((r): r is number => r != null);

  let levelMatchLabel: string | null = null;
  if (ratings.length > 0) {
    const min = Math.min(...ratings).toFixed(2);
    const max = Math.max(...ratings).toFixed(2);
    levelMatchLabel = min === max ? `their level ${min}` : `their level ${min}–${max}`;
  }

  // The session's effective timezone (venue else circle) comes resolved on the
  // summary. The old bare toLocaleString rendered raw UTC on the Fly runtime.
  const whenLabel = formatDateTime(summary.session.startsAt, summary.timezone);

  const alreadyIn = summary.viewerStatus === "in";
  // The truth gate (QA6): once the four is set, nothing on this page may still
  // say "I can play". Confirmed players resume their own state regardless.
  const isFull = summary.confirmed.length >= summary.slots;

  // Anonymous branch: no signed-in `user` at all. Rather than gate on
  // sign-in (the old "Sign in to claim the spot" link below, still used
  // when `user` is set — a circle member or a returning organiser opening
  // their own ring-3 link), this is the "10-second promise" — join-via-link
  // works with no account. A guest cookie may already identify a
  // in-progress claim on THIS session (resume at "name") or a completed one
  // (resume at "done"); anyone else starts cold at "claim".
  let guestFlow: GuestFlowInitial | null = null;
  if (!user) {
    const guestToken = await getGuestToken();
    const guestUserId = guestToken ? await getGuestUserId(db, guestToken) : null;
    guestFlow = resolveGuestFlowInitial({
      isFull,
      confirmed: guestUserId ? summary.confirmed.find((p) => p.userId === guestUserId) : undefined,
      reserved: guestUserId ? summary.reserves.find((p) => p.userId === guestUserId) : undefined,
    });
  }

  const confirmedPeople = summary.confirmed.map((p) => ({ src: p.avatarUrl, name: p.displayName }));

  return (
    // Below 900 this is the phone column exactly as before (the layout keeps
    // the 448 clamp there); at 900px+ the clamp lifts (see fc/layout.tsx) and
    // the design's desktop landing takes over: content top-anchored with the
    // per-step column widths living on the flow's own wrappers, all via
    // additive min-[900px]: classes so nothing below 900 shifts.
    <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12 text-center gap-8 bg-ground text-ink min-[900px]:justify-start min-[900px]:pt-12 min-[900px]:pb-16 min-[900px]:bg-transparent">
      {/* Anonymous viewer — always an ephemeral id, never this page's signed-in `user` (if any), per design/HANDOFF.md screen 6's ring-3 trust model. */}
      <PresenceTracker sessionId={parsed.sessionId} />
      {/* Invite links get left open in a tab; re-check the fill state when the visitor comes back so the CTA never goes stale (QA6). */}
      <RefreshOnFocus />
      {guestFlow ? (
        <div className="w-full max-w-xs min-[900px]:max-w-[520px]">
          <GuestClaimFlow
            sessionId={parsed.sessionId}
            token={token}
            circleName={summary.circleName}
            whenLabel={whenLabel}
            venue={summary.venue ? { name: summary.venue.name, address: summary.venue.address } : null}
            confirmedPeople={confirmedPeople}
            initial={guestFlow}
            sideHint={summary.session.fourthCallSideHint ?? null}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-col items-center gap-4">
            <Meta className="uppercase tracking-[0.12em] text-action-strong font-extrabold">Fourth Call</Meta>
            <AvatarStack people={confirmedPeople} size="lg" ring="ground" />
            <div>
              <h1 className="text-cu-title mt-1.5 min-[900px]:text-[26px]">
                {summary.circleName} {isFull ? "have their four" : "need a fourth"}
              </h1>
              <p className="text-cu-body text-ink-muted mt-1 max-w-xs">
                {whenLabel}
                {summary.venue?.name ? ` · ${summary.venue.name}` : ""}
              </p>
            </div>
            {levelMatchLabel && <Meta as="p">{levelMatchLabel}</Meta>}
          </div>

          {summary.confirmed.length > 0 && (
            <div className="w-full max-w-xs text-left min-[900px]:max-w-[440px]">
              <Meta as="p" className="uppercase tracking-[0.12em] mb-2">
                Who&apos;s in
              </Meta>
              {/* Signed-in branch only (the guest flow renders separately) — profile links resolve for this viewer. */}
              <RosterList players={summary.confirmed} />
            </div>
          )}

          <div className="w-full max-w-xs min-[900px]:max-w-[440px]">
            {alreadyIn ? (
              <p className="text-cu-body text-win font-bold">You&apos;re in, see you on court</p>
            ) : summary.viewerStatus === "reserve" ? (
              <p className="text-cu-body text-ink font-bold">
                You&apos;re on the list, you&apos;ll hear the moment a slot opens
              </p>
            ) : isFull ? (
              // Honest full state for the signed-in viewer too — no live claim
              // CTA on a set four (QA6's "beaten to it" language, pre-tap).
              <div>
                <p className="text-cu-body font-bold text-ink">Beaten to it, the four&apos;s set</p>
                <Meta as="p" className="mt-1.5">
                  if a spot opens up, this link comes back to life
                </Meta>
              </div>
            ) : (
              <FourthCallLinkClaim sessionId={parsed.sessionId} token={token} sideHint={summary.session.fourthCallSideHint ?? null} />
            )}
          </div>
        </>
      )}

      <Meta>no fees · no ads · no dark patterns</Meta>
    </main>
  );
}
