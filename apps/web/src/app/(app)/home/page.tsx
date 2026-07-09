import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { getCirclesStore } from "@/server/circles";
import { getGamesClient } from "@/server/games-db";
import { listUpcomingSessionsForUser, isFourthCallActive, type SessionSummary } from "@/server/games-service";
import { getMatchesStore, type PendingConfirmationView } from "@/server/matches-db";
import { getTabView } from "@/server/tab";
import { getUnreadCount } from "@/server/notifications";
import { formatMoney } from "@/components/tab/money";
import { SessionCard, type SessionCardData } from "@/components/games/SessionCard";
import { LiveRefresh } from "@/components/realtime/LiveRefresh";
import { Card, Avatar, Meta, Fact } from "@/components/ui";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { NeedsAnswerCard, type NeedsAnswerSession } from "./needs-answer-card";
import { FourthCallCard, type FourthCallHomeSession } from "./fourth-call-card";

/**
 * `quiet` (design/DESIGN-AUDIT.md H4's "'Manage' quiet") is ink-muted, not
 * coral — this screen's one coral action is the needs-answer card's "I'm
 * in", so every other tap-through link here (Manage, Fourth Call's "See
 * all", etc.) stays quiet per components/ui/button.tsx's "one primary per
 * screen" rule extended to link-style affordances.
 */
function SectionHeader({
  title,
  seeAllHref,
  linkLabel = "See all →",
  linkTone = "action",
}: {
  title: string;
  seeAllHref?: string;
  linkLabel?: string;
  linkTone?: "action" | "quiet";
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-cu-secondary uppercase tracking-wide text-ink-muted">{title}</h2>
      {seeAllHref && (
        <Link
          href={seeAllHref}
          className={`text-cu-secondary font-bold ${linkTone === "action" ? "text-action" : "text-ink-muted"}`}
        >
          {linkLabel}
        </Link>
      )}
    </div>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <p className="text-cu-card-title">{title}</p>
      <p className="text-cu-body text-ink-muted">{body}</p>
    </Card>
  );
}

/** A tap-through row for something that needs attention but isn't THE feature card — see the "one coral action per screen" note on the page component below. */
function AttentionRow({ href, emoji, title, subtitle }: { href: string; emoji: string; title: string; subtitle: string }) {
  return (
    <Link href={href} className="block">
      <Card className="flex items-center gap-3">
        <span className="text-xl shrink-0" aria-hidden>
          {emoji}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-cu-card-title text-[15px] truncate">{title}</p>
          <Meta as="p">{subtitle}</Meta>
        </div>
        <span className="text-ink-muted" aria-hidden>
          ›
        </span>
      </Card>
    </Link>
  );
}

function ConfirmedGameRow({ session }: { session: SessionCardData }) {
  const dayLabel = session.startsAt.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase();
  const timeLabel = session.startsAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const full = session.confirmed.length >= session.slots;
  return (
    <Link href={`/games/${session.sessionId}`} className="block">
      <Card className="flex items-center gap-3">
        <div className="w-11 text-center shrink-0">
          <p className="text-cu-card-title text-[15px] leading-none">{dayLabel}</p>
          <Fact size="meta" tone="muted" className="mt-1 block">
            {timeLabel}
          </Fact>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-cu-card-title text-[13px] truncate">
            {session.circleName}
            {session.venueName ? ` · ${session.venueName}` : ""}
          </p>
          <p className="text-cu-secondary text-ink-muted mt-0.5">
            {session.confirmed.length} of {session.slots}
            {full ? " · court booked" : ""}
          </p>
        </div>
        {session.viewerStatus === "in" && (
          <span className="rounded-chip px-2.5 py-1.5 text-[10.5px] font-bold bg-win-tint text-win whitespace-nowrap">You&apos;re in ✓</span>
        )}
      </Card>
    </Link>
  );
}

/** One row per circle where the viewer owes money — "the Tab never charges fees, it just keeps score" (design/HANDOFF.md screen 10). Aggregated here (getTabView is per-circle) since Home is the one place that summarises across every Circle the viewer is in. */
function TabRow({ circleId, circleName, name, amountMinor, currency }: { circleId: string; circleName: string; name: string; amountMinor: number; currency: string }) {
  return (
    <Card className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-cu-card-title text-[13px] truncate">
          The Tab · you owe {name} <Fact as="span" size="sm" tone="loss">{formatMoney(amountMinor, currency)}</Fact>
        </p>
        <p className="text-cu-secondary text-ink-muted mt-0.5">{circleName}</p>
      </div>
      <Link
        href={`/circles/${circleId}/tab`}
        className="rounded-chip px-3.5 py-2 text-[11.5px] font-bold bg-strong-bg text-strong-fg whitespace-nowrap"
      >
        Settle
      </Link>
    </Card>
  );
}

function toSessionCardData(s: SessionSummary): SessionCardData {
  return {
    sessionId: s.session.id,
    circleId: s.circleId,
    circleName: s.circleName,
    venueName: s.venue?.name ?? null,
    startsAt: s.session.startsAt,
    slots: s.slots,
    confirmed: s.confirmed,
    reserves: s.reserves,
    viewerStatus: s.viewerStatus,
    rsvpWindowOpensAt: s.rsvpWindowOpensAt,
    fourthCallActive: isFourthCallActive(s),
  };
}

function needsRsvp(s: SessionSummary, now: number): boolean {
  return s.viewerStatus === null && now >= s.rsvpWindowOpensAt.getTime() && now < s.session.startsAt.getTime();
}

export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) return null; // the (app) layout already redirects unauthenticated users to /login

  const name = user.displayName || user.email.split("@")[0] || "there";
  const now = Date.now();

  const [circlesStore, gamesClient, matchesStore] = await Promise.all([
    getCirclesStore(),
    getGamesClient(),
    getMatchesStore(),
  ]);

  const [circles, glass, pendingConfirmations] = await Promise.all([
    circlesStore.listCirclesForUser(user.id),
    matchesStore.getProfileGlassView(user.id),
    matchesStore.getPendingConfirmationsForUser(user.id),
  ]);

  // The bell that used to live in the bottom nav (see bottom-nav.tsx) — the
  // prototype's Home screen has no nav-level notification affordance, so it
  // moves to this header instead, top-right next to the avatar.
  const initialUnreadCount = getUnreadCount(gamesClient.db, user.id);

  const sessionSummaries = listUpcomingSessionsForUser(gamesClient.db, user.id);
  const activeFourthCalls = sessionSummaries.filter((s) => isFourthCallActive(s));

  // THE ONE coral action on this screen (components/ui/button.tsx's rule)
  // goes to the most pressing "answer this" moment: an open RSVP nobody's
  // responded to yet. Everything else below — pending result confirmations,
  // an incoming Fourth Call, the placement nudge — is a tap-through row with
  // no filled coral button of its own, same as the pre-redesign page.
  const featured = sessionSummaries.find((s) => needsRsvp(s, now)) ?? null;
  const restSessionCards = sessionSummaries.filter((s) => s.session.id !== featured?.session.id).map(toSessionCardData);

  const featuredCard: NeedsAnswerSession | null = featured
    ? {
        sessionId: featured.session.id,
        circleName: featured.circleName,
        venueName: featured.venue?.name ?? null,
        startsAt: featured.session.startsAt,
        slots: featured.slots,
        confirmed: featured.confirmed,
      }
    : null;

  const hasNoCircles = circles.length === 0;
  const showPlacementNudge = glass !== null && glass.status === "unrated";

  const attentionItems: { key: string; href: string; emoji: string; title: string; subtitle: string }[] = [
    ...pendingConfirmations.map((m: PendingConfirmationView) => ({
      key: `confirm-${m.matchId}`,
      href: `/matches/${m.matchId}`,
      emoji: "✅",
      title: `Confirm your result vs ${m.opponentNames}`,
      subtitle: "Both teams need to confirm before Glass moves.",
    })),
    ...(showPlacementNudge
      ? [
          {
            key: "placement",
            href: "/profile",
            emoji: "🧊",
            title: "Your Glass number is still hidden",
            subtitle:
              glass!.matchesUntilPlacement === 0
                ? "Placement Trio complete — your number appears once your latest match verifies."
                : `${glass!.matchesUntilPlacement} of 3 placement matches to go — log a result to keep going.`,
          },
        ]
      : []),
  ];

  // The incoming-Fourth-Call card (design/DESIGN-AUDIT.md H4) — everything
  // isFourthCallActive() flags, minus whichever session is already the
  // featured needs-answer card. "their level X–Y" mirrors fc/[token]/
  // page.tsx's own levelMatchLabel derivation (Glass ratings of everyone
  // already confirmed); "yours Z" reuses the `glass` view already fetched
  // above rather than a second lookup.
  const fourthCallCards: FourthCallHomeSession[] = await Promise.all(
    activeFourthCalls
      .filter((s) => s.session.id !== featured?.session.id)
      .map(async (s) => {
        const ratings = (
          await Promise.all(s.confirmed.map(async (p) => (await matchesStore.getProfileGlassView(p.userId))?.rating ?? null))
        ).filter((r): r is number => r != null);
        const levelRangeLabel =
          ratings.length === 0
            ? null
            : Math.min(...ratings) === Math.max(...ratings)
              ? `their level ${Math.min(...ratings).toFixed(2)}`
              : `their level ${Math.min(...ratings).toFixed(2)}–${Math.max(...ratings).toFixed(2)}`;
        const asker = s.confirmed[0] ?? null;
        return {
          sessionId: s.session.id,
          circleName: s.circleName,
          venueName: s.venue?.name ?? null,
          startsAt: s.session.startsAt,
          askerAvatarUrl: asker?.avatarUrl ?? null,
          askerName: asker?.displayName ?? s.circleName,
          levelRangeLabel,
          viewerRating: glass?.rating ?? null,
        };
      }),
  );

  // Tab settle preview: aggregated across every Circle the viewer is in
  // (getTabView is scoped per-circle — see server/tab.ts) since Home is the
  // one surface summarising the whole week, not just one Circle's Tab.
  const owedRows: { circleId: string; circleName: string; name: string; amountMinor: number; currency: string }[] = [];
  for (const circle of circles) {
    const view = getTabView(gamesClient.db, circle.id, user.id);
    if (!view) continue;
    for (const balance of view.balances) {
      if (balance.netMinor >= 0) continue; // only "you owe" rows get a Settle prompt on Home
      const counterparty = view.members.find((m) => m.userId === balance.counterpartyUserId);
      owedRows.push({
        circleId: circle.id,
        circleName: circle.name,
        name: counterparty?.displayName ?? "someone",
        amountMinor: -balance.netMinor,
        currency: balance.currency,
      });
    }
  }
  owedRows.sort((a, b) => b.amountMinor - a.amountMinor);

  const gamesThisWeek = sessionSummaries.length;
  const needAnswerCount = sessionSummaries.filter((s) => needsRsvp(s, now)).length;

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <LiveRefresh userId={user.id} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-cu-title">Your week</h1>
          <Meta as="p" className="mt-1">
            {gamesThisWeek} game{gamesThisWeek === 1 ? "" : "s"}
            {needAnswerCount > 0 ? ` · ${needAnswerCount} need${needAnswerCount === 1 ? "s" : ""} an answer` : ""}
          </Meta>
        </div>
        <div className="flex items-center gap-3">
          <NotificationBell userId={user.id} initialUnreadCount={initialUnreadCount} />
          <Link href="/profile">
            <Avatar src={user.avatarUrl} name={name} size="md" ring="ground" />
          </Link>
        </div>
      </div>

      {featuredCard && <NeedsAnswerCard session={featuredCard} />}

      {attentionItems.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader title="Needs your attention" />
          <div className="flex flex-col gap-2">
            {attentionItems.map((item) => (
              <AttentionRow key={item.key} href={item.href} emoji={item.emoji} title={item.title} subtitle={item.subtitle} />
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        {/* "Manage" (Standing Games) used to be the standalone /games list page's header link — that page now redirects here (see (app)/games/page.tsx), so its one bit of chrome that isn't already on Home moves onto this section instead. */}
        <SectionHeader title="Your games this week" seeAllHref="/games/standing" linkLabel="Manage" linkTone="quiet" />
        {restSessionCards.length === 0 && !featuredCard ? (
          <EmptyCard
            title="No games yet"
            body={
              hasNoCircles
                ? "Once you're in a Circle with a Standing Game, it'll show up here — RSVP without leaving the app."
                : "None of your Circles has an active Standing Game yet — set one up so your weekly four organises itself."
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {restSessionCards.map((c) =>
              c.viewerStatus === "in" ? (
                <ConfirmedGameRow key={c.sessionId} session={c} />
              ) : (
                <SessionCard key={c.sessionId} data={c} viewerUserId={user.id} />
              ),
            )}
          </div>
        )}
      </section>

      {fourthCallCards.length > 0 && (
        <div className="flex flex-col gap-3">
          {fourthCallCards.map((fc) => (
            <FourthCallCard key={fc.sessionId} session={fc} />
          ))}
        </div>
      )}

      {owedRows.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader title="The Tab" />
          <div className="flex flex-col gap-2">
            {owedRows.slice(0, 2).map((row) => (
              <TabRow key={`${row.circleId}-${row.name}-${row.currency}`} {...row} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
