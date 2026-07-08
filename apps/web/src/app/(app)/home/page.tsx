import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { getCirclesStore, type CircleSummary } from "@/server/circles";
import { getGamesClient } from "@/server/games-db";
import { listUpcomingSessionsForUser, isFourthCallActive, type SessionSummary } from "@/server/games-service";
import { getMatchesStore, type PendingConfirmationView } from "@/server/matches-db";
import { SessionCard, type SessionCardData } from "@/components/games/SessionCard";

const cardStyle = { background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" } as const;

function SectionHeader({ title, seeAllHref }: { title: string; seeAllHref?: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--c4-text-muted)" }}>
        {title}
      </h2>
      {seeAllHref && (
        <Link href={seeAllHref} className="text-sm font-medium" style={{ color: "var(--c4-accent)" }}>
          See all →
        </Link>
      )}
    </div>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl p-5 flex flex-col gap-1" style={cardStyle}>
      <p className="font-medium">{title}</p>
      <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
        {body}
      </p>
    </div>
  );
}

/** One row in the "needs your attention" feed — same pill treatment for every kind of action item. */
function ActionItem({
  href,
  emoji,
  title,
  subtitle,
}: {
  href: string;
  emoji: string;
  title: string;
  subtitle: string;
}) {
  return (
    <Link href={href} className="rounded-2xl p-4 flex items-center gap-3" style={cardStyle}>
      <span className="text-xl shrink-0" aria-hidden>
        {emoji}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{title}</p>
        <p className="text-xs" style={{ color: "var(--c4-text-muted)" }}>
          {subtitle}
        </p>
      </div>
      <span style={{ color: "var(--c4-text-muted)" }}>›</span>
    </Link>
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

function CircleRow({ circle }: { circle: CircleSummary }) {
  return (
    <Link href={`/circles/${circle.id}`} className="rounded-xl p-3 flex items-center gap-3" style={cardStyle}>
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0"
        style={{ background: circle.colour ?? "var(--c4-bg-elevated-2)" }}
        aria-hidden
      >
        {circle.emblem ?? "⭘"}
      </div>
      <p className="flex-1 min-w-0 font-medium truncate text-sm">{circle.name}</p>
      <span className="text-xs" style={{ color: "var(--c4-text-muted)" }}>
        {circle.memberCount} member{circle.memberCount === 1 ? "" : "s"}
      </span>
    </Link>
  );
}

export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) return null; // the (app) layout already redirects unauthenticated users to /login

  const name = user.displayName || user.email.split("@")[0] || "there";

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

  const sessionSummaries = listUpcomingSessionsForUser(gamesClient.db, user.id);
  const sessionCards = sessionSummaries.map(toSessionCardData);
  const activeFourthCalls = sessionSummaries.filter((s) => isFourthCallActive(s));

  const hasNoCircles = circles.length === 0;
  const showPlacementNudge = glass !== null && glass.status === "unrated";

  const hasActionItems = pendingConfirmations.length > 0 || activeFourthCalls.length > 0 || showPlacementNudge;

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <div>
        <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
          Welcome back
        </p>
        <h1 className="text-2xl font-semibold">{name}</h1>
      </div>

      {hasActionItems && (
        <section className="flex flex-col gap-3">
          <SectionHeader title="Needs your attention" />
          <div className="flex flex-col gap-2">
            {pendingConfirmations.map((m: PendingConfirmationView) => (
              <ActionItem
                key={m.matchId}
                href={`/matches/${m.matchId}`}
                emoji="✅"
                title={`Confirm your result vs ${m.opponentNames}`}
                subtitle="Both teams need to confirm before Glass moves."
              />
            ))}
            {activeFourthCalls.map((s) => (
              <ActionItem
                key={s.session.id}
                href={`/games/${s.session.id}`}
                emoji="🔔"
                title={`${s.circleName} needs a fourth`}
                subtitle={`${s.confirmed.length}/${s.slots} confirmed — kicks off soon.`}
              />
            ))}
            {showPlacementNudge && (
              <ActionItem
                href="/profile"
                emoji="🧊"
                title="Your Glass number is still hidden"
                subtitle={
                  glass!.matchesUntilPlacement === 0
                    ? "Placement Trio complete — your number appears once your latest match verifies."
                    : `${glass!.matchesUntilPlacement} of 3 placement matches to go — log a result to keep going.`
                }
              />
            )}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <SectionHeader title="Your games this week" seeAllHref={sessionCards.length > 0 ? "/games" : undefined} />
        {sessionCards.length === 0 ? (
          <EmptyCard
            title="No games yet"
            body={
              hasNoCircles
                ? "Once you're in a Circle with a Standing Game, it'll show up here — RSVP without leaving the app."
                : "None of your Circles has an active Standing Game yet — set one up so your weekly four organises itself."
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            {sessionCards.slice(0, 3).map((c) => (
              <SessionCard key={c.sessionId} data={c} viewerUserId={user.id} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeader title="Your Circles" seeAllHref={circles.length > 3 ? "/circles" : undefined} />
        {hasNoCircles ? (
          <div className="rounded-2xl p-5 flex flex-col gap-3" style={cardStyle}>
            <div>
              <p className="font-medium">You&apos;re not in a Circle yet</p>
              <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
                Join one with a link or QR code from a friend, or create your own to bring your padel group over
                from WhatsApp.
              </p>
            </div>
            <Link
              href="/circles/new"
              className="rounded-xl py-3 text-center text-sm font-semibold"
              style={{
                minHeight: "var(--c4-touch-target)",
                background: "var(--c4-accent)",
                color: "var(--c4-accent-contrast)",
              }}
            >
              + Create a Circle
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {circles.slice(0, 3).map((c) => (
              <CircleRow key={c.id} circle={c} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
