import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { getSessionSummary } from "@/server/games-service";
import { parseRing3ClaimToken } from "@/server/fourth-call";
import { getMatchesStore } from "@/server/matches-db";
import { AvatarStack, Meta } from "@/components/ui";
import { FourthCallLinkClaim } from "@/components/circle-screens/fourth-call-link-claim";

/**
 * Fourth Call ring 3's public claim page — "anyone with the link"
 * (design/HANDOFF.md screen 6). No account or circle membership needed to
 * see it (same trust model as /join/[code] and /games/[sessionId]'s
 * generateMetadata — getSessionSummary has no membership gate on reads);
 * claiming the spot does require signing in, via the same `?next=` login
 * detour the join flow uses.
 */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const parsed = parseRing3ClaimToken(token);
  if (!parsed) return { title: "CUATRO invite" };

  const { db } = await getGamesClient();
  const summary = getSessionSummary(db, parsed.sessionId, "");
  const title = summary ? `${summary.circleName} needs a fourth` : "CUATRO invite";
  const description = summary
    ? `A game is short a player for ${summary.session.startsAt.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}. Tap in if you can make it.`
    : "This invite link is invalid or has expired.";

  return { title, description };
}

export default async function FourthCallLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = parseRing3ClaimToken(token);

  if (!parsed) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12 text-center gap-3 bg-ground text-ink">
        <h1 className="text-cu-title">Link not found</h1>
        <p className="text-cu-body text-ink-muted max-w-xs">
          This invite link is invalid or has expired. Ask whoever sent it for a new one.
        </p>
      </main>
    );
  }

  const user = await getSessionUser();
  const { db } = await getGamesClient();
  const summary = getSessionSummary(db, parsed.sessionId, user?.id ?? "");

  if (!summary || summary.session.status !== "upcoming" || Date.now() >= summary.session.startsAt.getTime()) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12 text-center gap-3 bg-ground text-ink">
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

  const whenLabel = summary.session.startsAt.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const alreadyIn = summary.viewerStatus === "in";

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12 text-center gap-8 bg-ground text-ink">
      <div className="flex flex-col items-center gap-4">
        <Meta className="uppercase tracking-[0.12em] text-action-strong font-extrabold">Fourth Call</Meta>
        <AvatarStack people={summary.confirmed.map((p) => ({ src: p.avatarUrl, name: p.displayName }))} size="lg" ring="ground" />
        <div>
          <h1 className="text-cu-title mt-1.5">{summary.circleName} need a fourth</h1>
          <p className="text-cu-body text-ink-muted mt-1 max-w-xs">
            {whenLabel}
            {summary.venue?.name ? ` · ${summary.venue.name}` : ""}
          </p>
        </div>
        {levelMatchLabel && <Meta as="p">{levelMatchLabel}</Meta>}
      </div>

      <div className="w-full max-w-xs">
        {alreadyIn ? (
          <p className="text-cu-body text-win font-bold">You&apos;re in — see you on court</p>
        ) : user ? (
          <FourthCallLinkClaim sessionId={parsed.sessionId} token={token} />
        ) : (
          <Link
            href={`/login?next=${encodeURIComponent(`/fc/${token}`)}`}
            className="rounded-button inline-flex items-center justify-center w-full min-h-12 px-5 text-[15px] font-extrabold bg-action text-action-contrast transition-cu-state active:opacity-80"
          >
            Sign in to claim the spot
          </Link>
        )}
      </div>

      <Meta>no fees · no ads · no dark patterns</Meta>
    </main>
  );
}
