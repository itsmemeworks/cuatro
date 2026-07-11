"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SegmentedControl, DashedSlot, Meta, QrShareSheet, Avatar, AvatarStack } from "@/components/ui";
import { CircleChat, type ChatMessage } from "@/components/circles/circle-chat";
import { MemberList, type MemberListItem } from "@/components/circles/member-list";
import { MembersManager } from "@/components/circles/members-manager";
import { LeaveCircleButton } from "@/components/circles/leave-circle-button";
import { InviteShareButton, InviteLinkText } from "@/components/circles/invite-share-button";
import { KnockPanel, type KnockPanelItem } from "@/components/circles/knock-panel";
import { DoorControls } from "@/components/circles/door-controls";
import { EditCircleSheet, type EditAnchor, type EditVenueOption } from "@/components/circles/edit-circle-sheet";
import type { SessionCardData } from "@/components/games/SessionCard";
import { useCircleLive } from "@/lib/realtime/hooks";
import { setChatDockPref, useChatDockActive, useHydrated } from "@/lib/chat-dock";
import { formatGlass } from "@/lib/design";
import type { PendingSealCardData, SettingsStandingGameView } from "@/app/(app)/circles/[id]/load-circle";
import type { MoneyOptIn } from "@/lib/booking";
import { PinnedGameBar } from "./pinned-game-bar";
import { WideSettings } from "./wide/wide-settings";
import { ResultPost, type ResultPostData } from "./result-post";
import { PlacementRevealPost, type PlacementRevealPostData } from "./placement-reveal-post";
import { RivalryCallout } from "./rivalry-callout";
import { memberStatusLine, memberBadge, memberHref, MemberBadge, GlassCell, MemberRowLink } from "./wide/member-bits";

type Tab = "feed" | "chat" | "members" | "settings";

/** Serialized mirror of server/feed.ts's FeedItem — result posts ∪ placement reveals, already time-sorted by the caller. */
export type FeedItemData =
  | { kind: "result"; post: ResultPostData }
  | { kind: "placement_reveal"; reveal: PlacementRevealPostData };

function formatWhen(startsAt: Date): string {
  return startsAt.toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit" }).replace(",", "");
}

/**
 * The circle-context tab host (WEB-SHELL-SPEC.md Wave A + B). ONE responsive
 * tree: below 900px it is the phone experience byte-for-byte (segmented pills +
 * the active tab's phone layout); at 900px+ the pills hide (the sidebar owns
 * nav), the phone header chrome hides (see CirclePhone), and the active tab
 * renders its wide layout. The phone/wide difference is CSS-responsive around
 * SINGLE component instances — one PinnedGameBar, one CircleChat, mounted once
 * whatever the width — so nothing that subscribes or marks-read on mount is
 * ever doubled (WEB-SHELL-SPEC Wave B, lead ruling). Wide-only blocks (members
 * side card, pending-seal cards, per-tab headers) are `hidden min-[900px]:block`
 * so the <900 render is unchanged.
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
  defaultGameType,
  anchor,
  headerImage,
  homeVenueId,
  maxMembers,
  memberCount,
  venueOptions,
  pendingKnocks,
  feedItems,
  pendingSeals = [],
  rivalry,
  initialTab = "feed",
  pinnedMoneyOptIn = null,
  settingsStandingGames = [],
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
  defaultGameType: "competitive" | "friendly";
  anchor: EditAnchor | null;
  headerImage: string | null;
  homeVenueId: string | null;
  maxMembers: number | null;
  memberCount: number;
  venueOptions: EditVenueOption[];
  pendingKnocks: KnockPanelItem[];
  feedItems: FeedItemData[];
  /** Pending (unsealed) matches for the wide feed's "waiting on a confirm" card; the phone feed never shows these. */
  pendingSeals?: PendingSealCardData[];
  rivalry: { opponentName: string; opponentAvatarUrl: string | null; count: number; direction: "beaten" | "lost_to" } | null;
  initialTab?: Tab;
  /** Issue #21: the pinned session's resolved money opt-in — the pinned bar shows a BookingChip when it's a booking. */
  pinnedMoneyOptIn?: MoneyOptIn;
  /** Organiser-only — the wide Settings panel's standing-game cards. */
  settingsStandingGames?: SettingsStandingGameView[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const activeTab: Tab = tab === "settings" && !isOrganiser ? "feed" : tab;
  const [unread, setUnread] = useState(unreadChatBadge);
  const [qrOpen, setQrOpen] = useState(false);
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  const inviteUrl = `${origin ?? ""}/join/${inviteCode}`;
  const inviteLinkReadable = `${origin ? origin.replace(/^https?:\/\//, "") : ""}/join/${inviteCode}`;
  const primary = sessionCards[0] ?? null;
  const soloCircle = members.length <= 1;
  const organiserCount = members.filter((m) => m.role === "organiser").length;
  const myRole = members.find((m) => m.userId === currentUserId)?.role ?? "member";
  const mustTransferFirst = myRole === "organiser" && organiserCount === 1 && members.length > 1;
  const isLastMember = members.length === 1;

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

  // Wave D dock coordination (lib/chat-dock.ts): while the dock is active
  // (>=1440, docked) chat lives in DockedChat and the Chat tab shows a
  // "docked" note instead of a second CircleChat — the single-instance /
  // single-mark-read rule (see circle-chat.tsx's header).
  const dockActive = useChatDockActive();
  const hydrated = useHydrated();

  // Chat is on screen either in the dock or in the visible Chat tab. While
  // it is, CircleChat owns read state (it marks read as messages land), so
  // the badge watcher below must not refetch the unread count — the fetch
  // could race the mark-read POST and resurrect a badge for a message the
  // viewer is looking at.
  const chatVisible = dockActive || activeTab === "chat";
  const chatVisibleRef = useRef(chatVisible);
  chatVisibleRef.current = chatVisible;

  // Always registered: the shared channel pool (lib/realtime/shared-channels.ts)
  // multiplexes this handler with CircleChat's over ONE websocket channel per
  // circle, so there is no double-subscribe to gate against any more — the old
  // `tab === "chat" ? null : circleId` null-gating predated the pool and broke
  // once the dock meant chat could be visible outside the Chat tab.
  useCircleLive(circleId, (event) => {
    if ((event.type === "message" || event.type === "reconnect") && !chatVisibleRef.current) refreshUnread();
    if (isOrganiser && event.type === "notification") router.refresh();
  });

  useEffect(() => {
    if (chatVisible) setUnread(0);
  }, [chatVisible]);

  const pinnedBar = primary && (
    <PinnedGameBar
      sessionId={primary.sessionId}
      circleColour={circleColour}
      venueLabel={primary.venueName ?? "Venue TBC"}
      whenLabel={formatWhen(primary.startsAt)}
      slots={primary.slots}
      confirmedCount={primary.confirmed.length}
      viewerStatus={primary.viewerStatus}
      rsvpWindowOpensAt={primary.rsvpWindowOpensAt}
      startsAt={primary.startsAt}
      booking={pinnedMoneyOptIn?.kind === "booking" ? pinnedMoneyOptIn.booking : null}
    />
  );

  // Wide-only per-tab header (design "Desktop · Circle <tab>"): a 24px title, a
  // muted subline, and (feed) the top-4 avatar stack. `hidden min-[900px]:block`
  // so it never shows on phone.
  const wideHeader = (title: string, subtitle: string, right?: React.ReactNode) => (
    <div className="hidden min-[900px]:flex items-end gap-3.5">
      <div className="flex-1 min-w-0">
        <h1 className="font-sans font-extrabold text-[24px] leading-none text-ink">{title}</h1>
        <p className="font-sans text-[12px] text-ink-muted mt-1">{subtitle}</p>
      </div>
      {right}
    </div>
  );

  // The feed's members side column collapses while the dock is active (the
  // design gives its 300px to the dock rail: feedCols 1fr, feedMemD none).
  // Pre-hydration the preference/viewport are unknown, so CSS assumes the
  // default (docked at >=1440) and the live values take over once hydrated.
  const feedGridCols = hydrated
    ? dockActive
      ? "min-[900px]:grid-cols-[1fr]"
      : "min-[900px]:grid-cols-[1fr_300px]"
    : "min-[900px]:grid-cols-[1fr_300px] min-[1440px]:grid-cols-[1fr]";
  const membersCardVisibility = hydrated
    ? dockActive
      ? "hidden"
      : "hidden min-[900px]:block"
    : "hidden min-[900px]:block min-[1440px]:hidden";

  const membersSideCard = (
    <div className={`${membersCardVisibility} bg-surface border border-ink-hairline-1 rounded-[20px] overflow-hidden self-start`}>
      <Link href={`/circles/${circleId}/members`} className="flex items-center justify-between px-4 py-3 bg-ink-hairline-1">
        <span className="font-sans font-extrabold text-[10px] tracking-[0.14em] text-ink-muted">MEMBERS · {members.length}</span>
        <span className="font-sans font-bold text-[11px] text-action-strong">all →</span>
      </Link>
      {members.slice(0, 6).map((m, i, arr) => {
        const isYou = m.userId === currentUserId;
        return (
          <MemberRowLink
            key={m.userId}
            href={memberHref(m, isYou)}
            className={`flex items-center gap-2.5 px-4 py-3 transition-cu-state hover:bg-ink-hairline-1 ${i < arr.length - 1 ? "border-b border-ink-hairline-1" : ""}`}
          >
            <Avatar src={m.avatarUrl} name={m.displayName} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="font-sans font-bold text-[12.5px] text-ink truncate">
                {m.displayName}
                {isYou && <span className="text-action-strong font-normal"> · you</span>}
              </div>
              <div className="font-mono text-[10px] text-ink-muted truncate">{memberStatusLine(m)}</div>
            </div>
            <span className={`font-sans font-extrabold text-[13.5px] ${m.rating == null ? "text-ink-muted" : "text-ink"}`}>{formatGlass(m.rating)}</span>
          </MemberRowLink>
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Phone tab nav. Hidden at 900+, where the context sidebar owns navigation. */}
      <div className="min-[900px]:hidden">
        <SegmentedControl
          options={[
            { value: "feed", label: "Feed" },
            { value: "chat", label: "Chat", badge: unread > 0 ? unread : undefined },
            { value: "members", label: "Members" },
            ...(isOrganiser ? [{ value: "settings" as const, label: "Settings" }] : []),
          ]}
          value={activeTab}
          onChange={setTab}
        />
      </div>

      {activeTab === "feed" && (
        <>
          {wideHeader(
            "Feed",
            `what ${circleName} has been up to`,
            members.length > 0 ? (
              <AvatarStack people={members.slice(0, 4).map((m) => ({ src: m.avatarUrl, name: m.displayName }))} size="sm" ring="ground" />
            ) : undefined,
          )}
          <div className={`flex flex-col gap-3 min-[900px]:grid ${feedGridCols} min-[900px]:gap-[18px] min-[900px]:items-start`}>
            <div className="flex flex-col gap-3 min-w-0">
              {soloCircle && (
                <div className="rounded-button border-[1.5px] border-dashed border-action px-3.5 py-3 flex flex-col gap-2.5">
                  <div className="flex items-center gap-3">
                    <DashedSlot label="+" size="md" />
                    <div className="flex-1 min-w-0">
                      <p className="text-cu-body font-bold text-ink">Invite your group</p>
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
              {/* Pending-seal cards — wide feed only (the phone feed never showed them). */}
              {pendingSeals.map((p) => {
                const score = p.sets.map((s) => `${s.a}–${s.b}`).join(" ");
                return (
                  <div key={p.matchId} className="hidden min-[900px]:flex items-center gap-3 border border-ink-hairline-3 rounded-[20px] px-4 py-3.5">
                    <span className="w-2 h-2 rounded-full border-2 border-ink-hairline-4 box-border flex-none" aria-hidden />
                    <div className="flex-1 min-w-0">
                      <p className="font-sans font-bold text-[13px] text-ink">
                        {p.winnerNames} sent {score} over {p.loserNames}
                      </p>
                      <p className="font-mono text-[10.5px] text-ink-muted mt-0.5">waiting on a confirm · Glass moves once the other side seals it</p>
                    </div>
                    <span className="font-mono text-[10px] font-semibold text-ink-muted border border-ink-hairline-3 rounded-full px-2.5 py-1 flex-none">PENDING</span>
                  </div>
                );
              })}
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
            {membersSideCard}
          </div>
        </>
      )}

      {activeTab === "chat" && (
        <>
          {wideHeader(
            "Chat",
            `${members.length} member${members.length === 1 ? "" : "s"}`,
            // Re-dock affordance — only meaningful where the dock can exist
            // (>=1440) and only once hydration knows it is undocked.
            hydrated && !dockActive ? (
              <button
                type="button"
                onClick={() => setChatDockPref(true)}
                className="hidden min-[1440px]:inline-flex rounded-chip border border-ink-hairline-3 px-2.5 py-1.5 font-mono text-[10px] font-semibold text-ink-muted transition-cu-state hover:bg-ink-hairline-1 hover:text-ink"
              >
                dock →
              </button>
            ) : undefined,
          )}
          {/* Dock handoff (Wave D): while the dock is active the tab shows a
              quiet note (chat already on screen in the right-hand pane); the
              inline chat mounts only while it is not. Pre-hydration both
              render with complementary min-[1440px] classes assuming the
              docked default, so a desktop load doesn't flash the full thread
              before hydration hands it to the dock. */}
          {(!hydrated || dockActive) && (
            <div className="hidden min-[1440px]:flex items-center gap-3 border border-ink-hairline-3 rounded-[20px] px-4 py-3.5">
              <div className="flex-1 min-w-0">
                <p className="font-sans font-bold text-[13px] text-ink">Chat is docked</p>
                <p className="font-mono text-[10.5px] text-ink-muted mt-0.5">already open on the right, it follows you around this Circle</p>
              </div>
              <button
                type="button"
                onClick={() => setChatDockPref(false)}
                className="rounded-chip border border-ink-hairline-3 px-2.5 py-1.5 font-mono text-[10px] font-semibold text-ink-muted transition-cu-state hover:bg-ink-hairline-1 hover:text-ink"
              >
                undock
              </button>
            </div>
          )}
          {(!hydrated || !dockActive) && (
            /* Single PinnedGameBar + single CircleChat; wide styling wraps them in a tall card. */
            <div
              className={`flex flex-col gap-3 min-[900px]:bg-surface min-[900px]:border min-[900px]:border-ink-hairline-1 min-[900px]:rounded-[22px] min-[900px]:px-5 min-[900px]:pt-[18px] min-[900px]:pb-4 min-[900px]:min-h-[560px]${hydrated ? "" : " min-[1440px]:hidden"}`}
            >
              {pinnedBar}
              <CircleChat circleId={circleId} currentUserId={currentUserId} initialMessages={messages} />
            </div>
          )}
        </>
      )}

      {activeTab === "members" && (
        <>
          {wideHeader("Members", "ratings are everyone's business here. That's the point")}

          {/* Phone members block — the shipped MemberList + organiser tools + leave. */}
          <div className="min-[900px]:hidden flex flex-col gap-3">
            <MemberList members={members} currentUserId={currentUserId} />
            {isOrganiser && <MembersManager circleId={circleId} members={members} currentUserId={currentUserId} />}
            <div className="rounded-button border-[1.5px] border-dashed border-action px-3.5 py-3 flex flex-col gap-2.5">
              <div className="flex items-center gap-3">
                <DashedSlot label="+" size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-cu-body font-bold text-ink">Invite a mate</p>
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
            <LeaveCircleButton circleId={circleId} circleName={circleName} mustTransferFirst={mustTransferFirst} isLastMember={isLastMember} />
          </div>

          {/* Wide members roster — the design's big rows + dashed invite card. Static (no mount effects), so it may render alongside the phone block. */}
          <div className="hidden min-[900px]:block">
            <div className="max-w-[680px] bg-surface border border-ink-hairline-1 rounded-[20px] overflow-hidden">
              {members.map((m, i) => {
                const isYou = m.userId === currentUserId;
                const badge = memberBadge(m, isYou);
                return (
                  <MemberRowLink
                    key={m.userId}
                    href={memberHref(m, isYou)}
                    className={`flex items-center gap-3 px-[18px] py-3.5 transition-cu-state hover:bg-ink-hairline-1 ${i < members.length - 1 ? "border-b border-ink-hairline-1" : ""}`}
                  >
                    <Avatar src={m.avatarUrl} name={m.displayName} size="md" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-sans font-bold text-[14px] text-ink truncate">{m.displayName}</span>
                        {badge && <MemberBadge badge={badge} />}
                      </div>
                      <div className="font-mono text-[10px] text-ink-muted mt-[3px] truncate">{memberStatusLine(m)}</div>
                    </div>
                    <GlassCell m={m} />
                  </MemberRowLink>
                );
              })}
            </div>
            <div className="max-w-[680px] mt-3 border-[1.5px] border-dashed border-action rounded-[16px] px-4 py-3 flex items-center gap-3">
              <DashedSlot label="+" size="md" />
              <div className="flex-1 min-w-0">
                <p className="font-sans font-bold text-[13px] text-action-strong">Invite a mate</p>
                <p className="font-mono text-[10px] text-ink-muted mt-0.5">share the Circle link. They&apos;re in before their first game</p>
              </div>
              <InviteShareButton inviteCode={inviteCode} circleName={circleName} label="Copy ↗" />
            </div>
          </div>
        </>
      )}

      {activeTab === "settings" && isOrganiser && (
        <>
          {/* Phone settings — the shipped surface, byte-for-byte below 900px. */}
          <div className="min-[900px]:hidden flex flex-col gap-6">
            <section className="flex flex-col gap-3">
              <div>
                <p className="text-cu-body font-bold text-ink">Circle details</p>
                <Meta as="p" className="mt-0.5">
                  Name, colour, emblem, header image, home court and size.
                </Meta>
              </div>
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
            </section>

            <section className="flex flex-col gap-3">
              <DoorControls
                circleId={circleId}
                initialOpenDoor={openDoor}
                initialBoardEnabled={boardEnabled}
                initialVibeLine={vibeLine}
                initialDefaultGameType={defaultGameType}
              />
            </section>

            <KnockPanel knocks={pendingKnocks} />
          </div>

          {/* Wide settings — the design's two-column organiser panel. Its own
              EditCircleSheet instance (idPrefix keeps label targets unique;
              only one tree is ever visible). */}
          <div className="hidden min-[900px]:block">
            <WideSettings
              circleId={circleId}
              circleName={circleName}
              initialOpenDoor={openDoor}
              initialBoardEnabled={boardEnabled}
              initialDefaultGameType={defaultGameType}
              members={members}
              currentUserId={currentUserId}
              knocks={pendingKnocks}
              standingGames={settingsStandingGames}
              editCircleSlot={
                <EditCircleSheet
                  idPrefix="wide-"
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
              }
            />
          </div>
        </>
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
