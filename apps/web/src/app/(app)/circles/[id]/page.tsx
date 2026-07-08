import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { NotMemberError, getCirclesStore, type CircleMessageView } from "@/server/circles";
import { getGamesClient } from "@/server/games-db";
import { listUpcomingSessionsForCircle, isFourthCallActive } from "@/server/games-service";
import { InviteShareButton } from "@/components/circles/invite-share-button";
import { MemberList } from "@/components/circles/member-list";
import { CircleChat, type ChatMessage } from "@/components/circles/circle-chat";
import { SessionCard, type SessionCardData } from "@/components/games/SessionCard";

function serializeMessages(messages: CircleMessageView[]): ChatMessage[] {
  return messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }));
}

export default async function CircleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return null; // the (app) layout already redirects unauthenticated users to /login

  const store = await getCirclesStore();

  let detail;
  try {
    detail = await store.getCircleDetail(id, user.id);
  } catch (err) {
    // Not a member — treat identically to "doesn't exist" so a guessed
    // Circle id can't confirm a group's existence to an outsider.
    if (err instanceof NotMemberError) notFound();
    throw err;
  }
  if (!detail) notFound();

  const messages = await store.listMessages(id, user.id);

  const { db } = await getGamesClient();
  const sessionSummaries = listUpcomingSessionsForCircle(db, id, user.id);
  const sessionCards: SessionCardData[] = sessionSummaries.map((s) => ({
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
  }));

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center text-2xl shrink-0"
          style={{ background: detail.colour ?? "var(--c4-bg-elevated-2)" }}
          aria-hidden
        >
          {detail.emblem ?? "⭘"}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold truncate">{detail.name}</h1>
          <p className="text-xs" style={{ color: "var(--c4-text-muted)" }}>
            {detail.members.length} member{detail.members.length === 1 ? "" : "s"}
          </p>
        </div>
        <InviteShareButton inviteCode={detail.inviteCode} circleName={detail.name} />
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--c4-text-muted)" }}>
            Upcoming sessions
          </h2>
          {detail.myRole === "organiser" && (
            <Link href={`/games/standing/new?circleId=${id}`} className="text-sm font-medium" style={{ color: "var(--c4-accent)" }}>
              + Standing Game
            </Link>
          )}
        </div>
        {sessionCards.length === 0 ? (
          <div
            className="rounded-2xl p-4"
            style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
          >
            <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
              No Standing Game yet — set one up so this Circle&apos;s weekly game runs itself.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sessionCards.map((c) => (
              <Link key={c.sessionId} href={`/games/${c.sessionId}`} className="block">
                <SessionCard data={c} viewerUserId={user.id} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--c4-text-muted)" }}>
          Members
        </h2>
        <MemberList members={detail.members} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--c4-text-muted)" }}>
          Chat
        </h2>
        <CircleChat circleId={detail.id} currentUserId={user.id} initialMessages={serializeMessages(messages)} />
      </section>
    </main>
  );
}
