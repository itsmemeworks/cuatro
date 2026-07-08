"use client";

import { useState } from "react";
import Link from "next/link";
import { SegmentedControl, Card, DashedSlot, Meta } from "@/components/ui";
import { CircleChat, type ChatMessage } from "@/components/circles/circle-chat";
import { MemberList, type MemberListItem } from "@/components/circles/member-list";
import { InviteShareButton } from "@/components/circles/invite-share-button";
import type { SessionCardData } from "@/components/games/SessionCard";
import { PinnedGameBar } from "./pinned-game-bar";
import { SessionCardWithToast } from "./session-card-with-toast";
import { ResultPost, type ResultPostData } from "./result-post";
import { RivalryCallout } from "./rivalry-callout";

type Tab = "feed" | "chat" | "members";

function formatWhen(startsAt: Date): string {
  return startsAt.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" }).replace(",", "");
}

/**
 * The Feed / Chat / Members segmented view (prototype screen 4). Feed's
 * pinned bar and Chat's pinned bar are the same live session, so both read
 * from the same `sessionCards` prop rather than each fetching separately.
 *
 * Result posts + the rivalry callout come from server/feed.ts's
 * listRecentResultsForCircle (verified matches + Glass deltas + 👏 Respect
 * counts). Note: 💬 counts from the prototype are NOT rendered — there's no
 * comments backend in v0 (see result-post.tsx's header); Respect + a
 * "rematch?" link stand in for that row instead.
 */
export function CircleTabs({
  circleId,
  circleColour,
  unreadChatBadge,
  sessionCards,
  messages,
  members,
  currentUserId,
  inviteCode,
  circleName,
  isOrganiser,
  resultPosts,
  rivalry,
}: {
  circleId: string;
  circleColour: string;
  unreadChatBadge?: number;
  sessionCards: SessionCardData[];
  messages: ChatMessage[];
  members: MemberListItem[];
  currentUserId: string;
  inviteCode: string;
  circleName: string;
  isOrganiser: boolean;
  resultPosts: ResultPostData[];
  rivalry: { opponentName: string; count: number; direction: "beaten" | "lost_to" } | null;
}) {
  const [tab, setTab] = useState<Tab>("feed");
  const primary = sessionCards[0] ?? null;
  const rest = sessionCards.slice(1);

  const pinnedBar = primary && (
    <PinnedGameBar
      sessionId={primary.sessionId}
      circleColour={circleColour}
      venueLabel={primary.venueName ?? "Venue TBC"}
      whenLabel={formatWhen(primary.startsAt)}
      slots={primary.slots}
      confirmedCount={primary.confirmed.length}
      viewerStatus={primary.viewerStatus}
      rsvpOpen={Date.now() >= primary.rsvpWindowOpensAt.getTime() && Date.now() < primary.startsAt.getTime()}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        options={[
          { value: "feed", label: "Feed" },
          { value: "chat", label: "Chat", badge: unreadChatBadge && unreadChatBadge > 0 ? unreadChatBadge : undefined },
          { value: "members", label: "Members" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "feed" && (
        <div className="flex flex-col gap-3">
          {pinnedBar}
          {rivalry && (
            <RivalryCallout opponentName={rivalry.opponentName} count={rivalry.count} direction={rivalry.direction} />
          )}
          {rest.length > 0 && (
            <div className="flex flex-col gap-3">
              {rest.map((c) => (
                <SessionCardWithToast key={c.sessionId} data={c} viewerUserId={currentUserId} linkToSession />
              ))}
            </div>
          )}
          {!primary && (
            <Card>
              <p className="text-cu-body text-ink-muted">
                No Standing Game yet — set one up so this Circle&apos;s weekly game runs itself.
              </p>
              {isOrganiser && (
                <Link href={`/games/standing/new?circleId=${circleId}`} className="text-cu-body font-bold text-action mt-2 inline-block">
                  + Standing Game
                </Link>
              )}
            </Card>
          )}
          {resultPosts.length > 0 ? (
            <div className="flex flex-col gap-3">
              {resultPosts.map((post) => (
                <ResultPost key={post.matchId} data={post} />
              ))}
            </div>
          ) : (
            <Meta as="p" className="text-center px-4">
              results, reactions and rivalries land here once this Circle plays its first match
            </Meta>
          )}
        </div>
      )}

      {tab === "chat" && (
        <div className="flex flex-col gap-3">
          {pinnedBar}
          <CircleChat circleId={circleId} currentUserId={currentUserId} initialMessages={messages} />
        </div>
      )}

      {tab === "members" && (
        <div className="flex flex-col gap-3">
          <MemberList members={members} currentUserId={currentUserId} />
          <div className="rounded-button border-[1.5px] border-dashed border-action px-3.5 py-3 flex items-center gap-3">
            <DashedSlot label="+" size="md" />
            <div className="flex-1 min-w-0">
              <p className="text-cu-body font-bold text-action-strong">Invite a mate</p>
              <Meta as="p" className="mt-0.5">
                share the Circle link — they&apos;re in before their first game
              </Meta>
            </div>
            <InviteShareButton inviteCode={inviteCode} circleName={circleName} />
          </div>
          <Meta as="p" className="text-center">
            ratings are everyone&apos;s business here — that&apos;s the point
          </Meta>
        </div>
      )}
    </div>
  );
}
