"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SegmentedControl, DashedSlot, Meta, QrShareSheet } from "@/components/ui";
import { CircleChat, type ChatMessage } from "@/components/circles/circle-chat";
import { MemberList, type MemberListItem } from "@/components/circles/member-list";
import { InviteShareButton, InviteLinkText } from "@/components/circles/invite-share-button";
import { KnockPanel, type KnockPanelItem } from "@/components/circles/knock-panel";
import { DoorControls } from "@/components/circles/door-controls";
import { EditCircleSheet, type EditAnchor, type EditVenueOption } from "@/components/circles/edit-circle-sheet";
import type { SessionCardData } from "@/components/games/SessionCard";
import { useCircleLive } from "@/lib/realtime/hooks";
import { PinnedGameBar } from "./pinned-game-bar";
import { ResultPost, type ResultPostData } from "./result-post";
import { PlacementRevealPost, type PlacementRevealPostData } from "./placement-reveal-post";
import { RivalryCallout } from "./rivalry-callout";

type Tab = "feed" | "chat" | "members";

/** Serialized mirror of server/feed.ts's FeedItem — result posts ∪ placement reveals, already time-sorted by the caller. */
export type FeedItemData =
  | { kind: "result"; post: ResultPostData }
  | { kind: "placement_reveal"; reveal: PlacementRevealPostData };

function formatWhen(startsAt: Date): string {
  return startsAt.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" }).replace(",", "");
}

/**
 * The Feed / Chat / Members segmented view (prototype screen 4). Feed's
 * pinned bar and Chat's pinned bar are the same live session, so both read
 * from the same `sessionCards` prop rather than each fetching separately.
 *
 * Feed items (result posts + placement reveals) + the rivalry callout come
 * from server/feed.ts's listCircleFeed (design/DESIGN-AUDIT.md F2).
 *
 * `unreadChatBadge` is the server-rendered initial count (design/
 * DESIGN-AUDIT.md F3); it's kept live here — not just inside CircleChat,
 * which only mounts while the Chat segment is active — so the "Chat ·N"
 * label still updates while the viewer is looking at Feed/Members.
 */
export function CircleTabs({
  circleId,
  circleColour,
  circleEmblem,
  unreadChatBadge = 0,
  sessionCards,
  messages,
  members,
  currentUserId,
  inviteCode,
  circleName,
  isOrganiser,
  openDoor,
  boardEnabled,
  vibeLine,
  anchor,
  headerImage,
  homeVenueId,
  maxMembers,
  memberCount,
  venueOptions,
  pendingKnocks,
  feedItems,
  rivalry,
}: {
  circleId: string;
  circleColour: string;
  circleEmblem: string | null;
  unreadChatBadge?: number;
  sessionCards: SessionCardData[];
  messages: ChatMessage[];
  members: MemberListItem[];
  currentUserId: string;
  inviteCode: string;
  circleName: string;
  isOrganiser: boolean;
  openDoor: boolean;
  boardEnabled: boolean;
  vibeLine: string | null;
  anchor: EditAnchor | null;
  headerImage: string | null;
  homeVenueId: string | null;
  maxMembers: number | null;
  memberCount: number;
  venueOptions: EditVenueOption[];
  pendingKnocks: KnockPanelItem[];
  feedItems: FeedItemData[];
  rivalry: { opponentName: string; opponentAvatarUrl: string | null; count: number; direction: "beaten" | "lost_to" } | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("feed");
  const [unread, setUnread] = useState(unreadChatBadge);
  // The invite QR (shared by the solo-circle and Members invite blocks). The
  // origin is resolved after mount — same reason as InviteLinkText — so the
  // link rendered under the code matches what people read off the screen.
  const [qrOpen, setQrOpen] = useState(false);
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  const inviteUrl = `${origin ?? ""}/join/${inviteCode}`;
  const inviteLinkReadable = `${origin ? origin.replace(/^https?:\/\//, "") : ""}/join/${inviteCode}`;
  // The Feed's pinned bar (prototype screen 4) is a compact one-liner for
  // whichever Standing Game session is next — never the full SessionCard
  // (dashed-slot grid, full-width "I'm in"), which stays on the session's
  // own page (games/[sessionId]/page.tsx renders it). A circle with more
  // than one upcoming session only pins the soonest; Home already lists
  // every upcoming game across circles.
  const primary = sessionCards[0] ?? null;
  // A one-member Circle's most urgent action is inviting, not reading an empty
  // Feed — surface it right at the top of the landing tab.
  const soloCircle = members.length <= 1;

  const refreshUnread = useCallback(async () => {
    try {
      const res = await fetch(`/api/circles/${circleId}/unread-count`);
      if (!res.ok) return;
      const body = await res.json();
      if (typeof body.count === "number") setUnread(body.count);
    } catch {
      // Best-effort — stays at its last known value until the next live event.
    }
  }, [circleId]);

  // While the Chat segment is open, CircleChat itself marks the circle read
  // on mount and on every new message — this listener exists so a viewer
  // sitting on Feed/Members still sees "Chat ·N" tick up/down live.
  useCircleLive(tab === "chat" ? null : circleId, (event) => {
    if (event.type === "message" || event.type === "reconnect") refreshUnread();
    // A knock arriving/withdrawing/being decided broadcasts a "notification"
    // ping on the circle channel — reload so an organiser's pending-knocks
    // panel stays live without a manual refresh.
    if (isOrganiser && event.type === "notification") router.refresh();
  });

  useEffect(() => {
    if (tab === "chat") setUnread(0); // CircleChat's own mount-time markCircleRead call is about to zero this server-side
  }, [tab]);

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
          { value: "chat", label: "Chat", badge: unread > 0 ? unread : undefined },
          { value: "members", label: "Members" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "feed" && (
        <div className="flex flex-col gap-3">
          {soloCircle && (
            <div className="rounded-button border-[1.5px] border-dashed border-action px-3.5 py-3 flex flex-col gap-2.5">
              <div className="flex items-center gap-3">
                <DashedSlot label="+" size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-cu-body font-bold text-action-strong">Invite your group</p>
                  <Meta as="p" className="mt-0.5">
                    it&apos;s just you so far, share the link and your four fills up
                  </Meta>
                </div>
                <InviteShareButton inviteCode={inviteCode} circleName={circleName} label="Share ↗" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <InviteLinkText inviteCode={inviteCode} className="flex-1" />
                <button
                  type="button"
                  onClick={() => setQrOpen(true)}
                  className="rounded-chip border border-ink-hairline-3 text-ink font-bold text-[11px] px-3 py-2 shrink-0 transition-cu-state active:opacity-80"
                >
                  Show QR
                </button>
              </div>
            </div>
          )}
          {pinnedBar}
          {rivalry && (
            <RivalryCallout
              opponentName={rivalry.opponentName}
              opponentAvatarUrl={rivalry.opponentAvatarUrl}
              count={rivalry.count}
              direction={rivalry.direction}
            />
          )}
          {!primary && (
            <p className="text-cu-body text-ink-muted">
              No Standing Game yet
              {isOrganiser && (
                <>
                  {", "}
                  <Link href={`/games/standing/new?circleId=${circleId}`} className="font-bold text-action-strong">
                    set one up →
                  </Link>
                </>
              )}
            </p>
          )}
          {feedItems.length > 0 ? (
            <div className="flex flex-col gap-3">
              {feedItems.map((item) =>
                item.kind === "result" ? (
                  <ResultPost key={`result-${item.post.matchId}`} data={item.post} />
                ) : (
                  <PlacementRevealPost key={`reveal-${item.reveal.ratingEventId}`} data={item.reveal} />
                ),
              )}
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
          {isOrganiser && <KnockPanel knocks={pendingKnocks} />}
          <MemberList members={members} currentUserId={currentUserId} />
          {isOrganiser && (
            <>
              <EditCircleSheet
                circleId={circleId}
                initialName={circleName}
                initialColour={circleColour}
                initialEmblem={circleEmblem}
                initialHeaderImage={headerImage}
                initialHomeVenueId={homeVenueId}
                initialMaxMembers={maxMembers}
                memberCount={memberCount}
                venueOptions={venueOptions}
                anchor={anchor}
              />
              <DoorControls
                circleId={circleId}
                initialOpenDoor={openDoor}
                initialBoardEnabled={boardEnabled}
                initialVibeLine={vibeLine}
              />
            </>
          )}
          <div className="rounded-button border-[1.5px] border-dashed border-action px-3.5 py-3 flex flex-col gap-2.5">
            <div className="flex items-center gap-3">
              <DashedSlot label="+" size="md" />
              <div className="flex-1 min-w-0">
                <p className="text-cu-body font-bold text-action-strong">Invite a mate</p>
                <Meta as="p" className="mt-0.5">
                  share the Circle link, they&apos;re in before their first game
                </Meta>
              </div>
              <InviteShareButton inviteCode={inviteCode} circleName={circleName} label="Share ↗" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <InviteLinkText inviteCode={inviteCode} className="flex-1" />
              <button
                type="button"
                onClick={() => setQrOpen(true)}
                className="rounded-chip border border-ink-hairline-3 text-ink font-bold text-[11px] px-3 py-2 shrink-0 transition-cu-state active:opacity-80"
              >
                Show QR
              </button>
            </div>
          </div>
          <Meta as="p" className="text-center">
            ratings are everyone&apos;s business here, that&apos;s the point
          </Meta>
        </div>
      )}

      <QrShareSheet
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title={circleName}
        url={inviteUrl}
        readableLink={inviteLinkReadable}
        caption="scan to join the Circle, no account needed to see what it is"
      />
    </div>
  );
}
