import type { Metadata } from "next";
import { getSessionUser } from "@/lib/session";
import { getGuestToken } from "@/lib/guest-session";
import { getGamesClient } from "@/server/games-db";
import { getSessionSummary } from "@/server/games-service";
import { parseRing3ClaimToken } from "@/server/fourth-call";
import { getGuestUserId, GUEST_PLACEHOLDER_NAME } from "@/server/guest";
import { getMatchesStore } from "@/server/matches-db";
import { AvatarStack, Meta } from "@/components/ui";
import { RosterList } from "@/components/games/roster";
import { FourthCallLinkClaim } from "@/components/circle-screens/fourth-call-link-claim";
import { GuestClaimFlow, type GuestFlowInitial } from "@/components/entry/guest-claim-flow";
import { PresenceTracker } from "@/components/realtime/PresenceTracker";

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
  const title = summary ? `${summary.circleName} needs a fourth` : "CUATRO invite";
  const description = summary
    ? `A game is short a player for ${new Date(summary.session.startsAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}. Tap in if you can make it.`
    : "This invite link is invalid or has expired.";

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

  const whenLabel = new Date(summary.session.startsAt).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const alreadyIn = summary.viewerStatus === "in";

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
    const guestConfirmed = guestUserId ? summary.confirmed.find((p) => p.userId === guestUserId) : undefined;
    const guestReserved = guestUserId ? summary.reserves.find((p) => p.userId === guestUserId) : undefined;
    const guestPlayer = guestConfirmed ?? guestReserved;

    if (!guestPlayer) {
      guestFlow = { step: "claim" };
    } else if (guestPlayer.displayName === GUEST_PLACEHOLDER_NAME) {
      guestFlow = { step: "name", status: guestConfirmed ? "in" : "reserve" };
    } else {
      guestFlow = {
        step: "done",
        status: guestConfirmed ? "in" : "reserve",
        displayName: guestPlayer.displayName,
        avatarUrl: guestPlayer.avatarUrl,
      };
    }
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
              <h1 className="text-cu-title mt-1.5 min-[900px]:text-[26px]">{summary.circleName} need a fourth</h1>
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
