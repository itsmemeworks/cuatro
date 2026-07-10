import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { getCirclesStore } from "@/server/circles";
import { getGamesClient } from "@/server/games-db";
import { listUpcomingSessionsForUser, isFourthCallActive, type SessionSummary } from "@/server/games-service";
import { getMatchesStore, type PendingConfirmationView } from "@/server/matches-db";
import { getTabView } from "@/server/tab";
import { getUnreadCount } from "@/server/notifications";
import { formatMoney } from "@/components/tab/money";
import { type SessionCardData } from "@/components/games/SessionCard";
import { LiveRefresh } from "@/components/realtime/LiveRefresh";
import { Card, Avatar, Meta, Fact } from "@/components/ui";
import { CircleEmblem, RosterNames, RosterStack, circleColour } from "@/components/games/roster";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { NeedsAnswerCard, type NeedsAnswerSession } from "./needs-answer-card";
import { FourthCallCard, type FourthCallHomeSession } from "./fourth-call-card";
import { BoardSection } from "@/components/games/board-section";
import { boardGames } from "@/server/discovery";
import { resolvePatch } from "@/server/patch";
import type { BoardCardProps } from "@/components/games/board-card";

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
      <h2 className="text-cu-secondary font-bold text-ink-muted">{title}</h2>
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

function EmptyCard({ title, body, action }: { title: string; body: string; action?: { href: string; label: string } }) {
  return (
    <Card className="flex flex-col gap-1">
      <p className="text-cu-card-title">{title}</p>
      <p className="text-cu-body text-ink-muted">{body}</p>
      {action && (
        <Link href={action.href} className="text-cu-secondary font-bold text-action mt-1 self-start">
          {action.label}
        </Link>
      )}
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

/**
 * A tap-through row for a game in "Your games this week". Secondary upcoming
 * games render here rather than as full coral SessionCards so Home keeps a
 * single coral action (the NeedsAnswerCard); tapping opens the session detail
 * where the RSVP lives (audit-design #5). Shows the "you're in" chip only once
 * the viewer holds a slot.
 */
function GameRow({ session }: { session: SessionCardData }) {
  const dayLabel = session.startsAt.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase();
  const timeLabel = session.startsAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const openCount = Math.max(0, session.slots - session.confirmed.length);
  const reserveCount = session.reserves.length;
  return (
    <Link href={`/games/${session.sessionId}`} className="block">
      {/* padded={false} so the Circle-colour edge strip runs the full height flush to the card edge; the row pads itself. */}
      <Card padded={false} className="overflow-hidden flex items-stretch">
        <span aria-hidden className="w-1.5 shrink-0" style={{ background: circleColour(session.circleId, session.circleColour) }} />
        <div className="flex items-center gap-3 flex-1 min-w-0 px-3.5 py-3">
          <div className="w-11 text-center shrink-0">
            <p className="text-cu-card-title text-[15px] leading-none">{dayLabel}</p>
            <Fact size="meta" tone="muted" className="mt-1 block">
              {timeLabel}
            </Fact>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <CircleEmblem seed={session.circleId} name={session.circleName} emblem={session.circleEmblem} colour={session.circleColour} px={20} />
              <p className="text-cu-card-title text-[13px] truncate">
                {session.circleName}
                {session.venueName ? ` · ${session.venueName}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <RosterStack confirmed={session.confirmed} slots={session.slots} size="sm" />
              <span className="text-cu-secondary text-ink-muted truncate">
                {openCount === 0 ? "court booked" : `${openCount} spot${openCount === 1 ? "" : "s"} open`}
                {reserveCount > 0 ? ` · ${reserveCount} waiting` : ""}
              </span>
            </div>
            {session.confirmed.length > 0 && (
              <p className="text-cu-secondary text-ink-muted truncate mt-1">
                {/* linkPlayers off: the whole row is already a Link, so nested profile anchors would be invalid HTML. */}
                <RosterNames players={session.confirmed} firstNameOnly linkPlayers={false} prefix="with " />
              </p>
            )}
          </div>
          {session.viewerStatus === "in" && (
            <span className="rounded-chip px-2.5 py-1.5 text-[10.5px] font-bold bg-win-tint text-win whitespace-nowrap">You&apos;re in ✓</span>
          )}
          <span className="text-ink-muted shrink-0" aria-hidden>
            ›
          </span>
        </div>
      </Card>
    </Link>
  );
}

/** One row per circle where the viewer owes money — "the Tab never charges fees, it just keeps score" (design/HANDOFF.md screen 10). Aggregated here (getTabView is per-circle) since Home is the one place that summarises across every Circle the viewer is in. */
function TabRow({
  circleId,
  circleName,
  name,
  amountMinor,
  currency,
  description,
}: {
  circleId: string;
  circleName: string;
  name: string;
  amountMinor: number;
  currency: string;
  /** The most recent unsettled entry's "what for" (server/tab.ts's TabEntryView.descriptionLabel) — null when there's nothing to say beyond who and how much. */
  description: string | null;
}) {
  return (
    <Card className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-cu-card-title text-[13px] truncate">
          The Tab · you owe {name} <Fact as="span" size="sm" tone="loss">{formatMoney(amountMinor, currency)}</Fact>
        </p>
        <p className="text-cu-secondary text-ink-muted mt-0.5">{circleName}</p>
        {description && <p className="text-cu-secondary text-ink-muted mt-0.5">from {description}</p>}
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
  // Rotation games carry their four/sit-out in `rotation` — show the
  // provisional (pre-lock) or locked four in the slot grid, and suppress the
  // Fourth Call chip until the lineup actually locks.
  const rotationLocked = s.rotation?.lockedAt != null;
  return {
    sessionId: s.session.id,
    circleId: s.circleId,
    circleName: s.circleName,
    circleColour: s.circleColour,
    circleEmblem: s.circleEmblem,
    venueName: s.venue?.name ?? null,
    startsAt: s.session.startsAt,
    slots: s.slots,
    confirmed: s.rotation ? s.rotation.lineup : s.confirmed,
    reserves: s.rotation ? s.rotation.sitting : s.reserves,
    viewerStatus: s.viewerStatus,
    rsvpWindowOpensAt: s.rsvpWindowOpensAt,
    fourthCallActive: s.rotation && !rotationLocked ? false : isFourthCallActive(s),
    rotation: s.rotation ? { locked: rotationLocked, viewerAvailable: s.rotation.viewerAvailable } : null,
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
        circleId: featured.circleId,
        circleName: featured.circleName,
        circleColour: featured.circleColour,
        circleEmblem: featured.circleEmblem,
        venueName: featured.venue?.name ?? null,
        startsAt: featured.session.startsAt,
        slots: featured.slots,
        confirmed: featured.confirmed,
      }
    : null;

  const hasNoCircles = circles.length === 0;
  // The placement nudge tells the user to "log a result to keep going" — but a
  // user with no Circles can't log anything yet, so it's noise until they've
  // joined or created one (audit-onboarding LOW note / audit-design #1).
  const showPlacementNudge = glass !== null && glass.status === "unrated" && !hasNoCircles;

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
                ? "Placement Trio complete. Your number appears once your latest match verifies."
                : `${glass!.matchesUntilPlacement} of 3 placement matches to go. Log a result to keep going, nobody's a number yet.`,
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
  const owedRows: { circleId: string; circleName: string; name: string; amountMinor: number; currency: string; description: string | null }[] = [];
  for (const circle of circles) {
    const view = getTabView(gamesClient.db, circle.id, user.id);
    if (!view) continue;
    for (const balance of view.balances) {
      if (balance.netMinor >= 0) continue; // only "you owe" rows get a Settle prompt on Home
      const counterparty = view.members.find((m) => m.userId === balance.counterpartyUserId);
      // getTabView's balances are netted across every unsettled entry with
      // this counterparty (see server/tab.ts) — there's no single entry
      // "the" balance came from, so the most recent unsettled one between
      // this pair stands in for "what for" (same spirit as the netted
      // balance itself: the freshest fact wins).
      const mostRecentEntry = view.activity
        .filter(
          (e) =>
            e.status !== "settled" &&
            ((e.payerUserId === user.id && e.debtorUserId === balance.counterpartyUserId) ||
              (e.debtorUserId === user.id && e.payerUserId === balance.counterpartyUserId)),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      owedRows.push({
        circleId: circle.id,
        circleName: circle.name,
        name: counterparty?.displayName ?? "someone",
        amountMinor: -balance.netMinor,
        currency: balance.currency,
        description: mostRecentEntry?.descriptionLabel ?? null,
      });
    }
  }
  owedRows.sort((a, b) => b.amountMinor - a.amountMinor);

  const gamesThisWeek = sessionSummaries.length;
  const needAnswerCount = sessionSummaries.filter((s) => needsRsvp(s, now)).length;

  // The Board — open slots in games near the viewer's patch. Discovery only
  // becomes active once a patch resolves (server/patch.ts), so we check that
  // separately from the games list to tell "no home venue set" apart from
  // "placed, but nothing nearby" (see BoardSection's states).
  const [patch, board] = await Promise.all([
    resolvePatch(gamesClient.db, user.id),
    boardGames(gamesClient.db, user.id),
  ]);
  const boardCards: BoardCardProps[] = board.map((g) => ({
    sessionId: g.sessionId,
    circleId: g.circleId,
    circleName: g.circleName,
    circleColour: g.circleColour,
    circleEmblem: g.circleEmblem,
    venueName: g.venueName,
    whenLabel: g.startsAt.toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }),
    distanceLabel: g.distanceLabel,
    levelLine: g.levelLine,
    slotsOpen: g.slotsOpen,
    confirmed: g.confirmed,
    initialPending: g.viewerHasPendingKnock,
  }));

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

      {featuredCard && (
        <NeedsAnswerCard
          session={featuredCard}
          viewer={{ userId: user.id, displayName: user.displayName || name, avatarUrl: user.avatarUrl }}
        />
      )}

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

      {hasNoCircles ? (
        // The one coral action a brand-new, circle-less user's Home should
        // spend its budget on: getting them into a Circle (audit-onboarding
        // F4 / audit-design #1). Same recipe as the Feed/Tab empty states.
        <Card className="flex flex-col gap-3">
          <div>
            <p className="text-cu-card-title text-ink">Start with a Circle</p>
            <p className="text-cu-body text-ink-muted mt-1">
              A Circle is your padel group, basically a group chat that occasionally plays padel. Create one and your weekly four organises itself.
            </p>
          </div>
          <Link
            href="/circles/new"
            className="rounded-button min-h-11 flex items-center justify-center text-[14px] font-extrabold bg-action text-action-contrast"
          >
            Create your first Circle
          </Link>
          <p className="text-cu-secondary text-ink-muted text-center">Got an invite link? Just open it.</p>
        </Card>
      ) : (
        <section className="flex flex-col gap-3">
          {/* "Manage" (Standing Games) used to be the standalone /games list page's header link — that page now redirects here (see (app)/games/page.tsx), so its one bit of chrome that isn't already on Home moves onto this section instead. */}
          <SectionHeader title="Your games this week" seeAllHref="/games/standing" linkLabel="Manage" linkTone="quiet" />
          {restSessionCards.length === 0 && !featuredCard ? (
            <EmptyCard
              title="No games yet"
              body="None of your Circles has a Standing Game yet. Set one up so nobody has to be the one who says 'anyone free Thursday'."
              action={{ href: "/games/standing/new", label: "Set one up →" }}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {restSessionCards.map((c) => (
                <GameRow key={c.sessionId} session={c} />
              ))}
            </div>
          )}
        </section>
      )}

      {fourthCallCards.length > 0 && (
        <div className="flex flex-col gap-3">
          {fourthCallCards.map((fc, i) => (
            // One coral action per screen: the coral belongs to the
            // NeedsAnswerCard when present, otherwise to the first Fourth Call.
            // Everything else downgrades to `strong` (audit-design #5).
            <FourthCallCard key={fc.sessionId} session={fc} demote={!!featuredCard || i > 0} />
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

      <BoardSection hasPatch={patch !== null} games={boardCards} />
    </main>
  );
}
