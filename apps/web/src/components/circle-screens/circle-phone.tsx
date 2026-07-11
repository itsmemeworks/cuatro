import { RememberLastCircle } from "@/components/circles/remember-last-circle";
import { CircleSwitcher } from "@/components/circles/circle-switcher";
import { CircleHeaderHero } from "@/components/circles/circle-header";
import { InviteShareButton } from "@/components/circles/invite-share-button";
import { AvatarStack } from "@/components/ui";
import { CircleTabs } from "@/components/circle-screens/circle-tabs";
import { ToastBoundary } from "@/components/circle-screens/toast-boundary";
import type { CircleContext } from "@/app/(app)/circles/[id]/load-circle";

type PhoneTab = "feed" | "chat" | "members" | "settings";

/**
 * The circle-context page (WEB-SHELL-SPEC.md Wave B). ONE responsive tree: below
 * 900px it is the phone circle page, pixel-identical to the pre-Wave-B markup
 * (the header chrome + CircleTabs pills), differing only in which CircleTabs
 * segment opens; at 900px+ the phone chrome hides and CircleTabs renders the
 * active tab's wide layout (the context sidebar owns nav). Shared by the base
 * feed route and the nested chat/members routes.
 */
export function CirclePhone({ ctx, currentUserId, initialTab }: { ctx: CircleContext; currentUserId: string; initialTab: PhoneTab }) {
  const { detail, colour, gamesCount, foundedYear } = ctx;

  // The `<main>` is the phone circle page below 900px (px-5/pt-8/pb-6, unchanged
  // and pixel-identical to baseline) and the wide 1000px content column at 900+
  // (c4-wide opts the shell out of the 448 clamp). The phone-only header chrome
  // (switcher, hero, avatar row, home court) is `min-[900px]:hidden` — the wide
  // context sidebar + CircleTabs' per-tab wide header own that at 900+.
  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-5 c4-wide min-[900px]:px-[30px] min-[900px]:pt-0 min-[900px]:pb-0 min-[900px]:max-w-[1000px] min-[900px]:mx-auto">
      <RememberLastCircle circleId={detail.id} />
      <div className="min-[900px]:hidden flex flex-col gap-5">
        <CircleSwitcher circles={ctx.allCircles} activeCircleId={detail.id} />

        <CircleHeaderHero
          circleId={detail.id}
          headerImage={detail.headerImage}
          colour={colour}
          emblem={detail.emblem}
          name={detail.name}
          facts={
            <>
              {detail.members.length} member{detail.members.length === 1 ? "" : "s"} · {gamesCount} game
              {gamesCount === 1 ? "" : "s"}
              {foundedYear != null && ` · est. ${foundedYear}`}
            </>
          }
        />

        <div className="flex items-center gap-3">
          <AvatarStack
            people={detail.members.slice(0, 4).map((m) => ({ src: m.avatarUrl, name: m.displayName }))}
            size="sm"
            ring="ground"
          />
          <div className="flex-1" />
          <InviteShareButton
            inviteCode={detail.inviteCode}
            circleName={detail.name}
            label={detail.members.length <= 1 ? "Invite" : "Copy ↗"}
          />
        </div>

        {ctx.homeCourtName ? (
          <p className="text-cu-meta text-ink-muted">
            Home court: <span className="text-ink">{ctx.homeCourtName}</span>
            {ctx.homeCourtExplicit ? " · set by organiser" : " · based on where you play"}
          </p>
        ) : (
          <p className="text-cu-meta text-ink-muted">
            No home court yet. Set one in Edit Circle, or play a venue with an address and it pins itself.
          </p>
        )}
      </div>

      <ToastBoundary>
        <CircleTabs
          circleId={detail.id}
          circleColour={colour}
          circleEmblem={detail.emblem}
          unreadChatBadge={ctx.unreadChatBadge}
          sessionCards={ctx.sessionCards}
          messages={ctx.messages}
          members={detail.members}
          currentUserId={currentUserId}
          inviteCode={detail.inviteCode}
          circleName={detail.name}
          isOrganiser={detail.myRole === "organiser"}
          openDoor={detail.openDoor}
          boardEnabled={detail.boardEnabled}
          vibeLine={detail.vibeLine}
          defaultGameType={detail.defaultGameType}
          anchor={ctx.anchor}
          headerImage={detail.headerImage}
          homeVenueId={detail.homeVenueId}
          maxMembers={detail.maxMembers}
          memberCount={detail.memberCount}
          venueOptions={ctx.venueOptions}
          pendingKnocks={ctx.pendingKnocks}
          feedItems={ctx.feedItems}
          pendingSeals={ctx.pendingSeals}
          initialTab={initialTab}
          rivalry={ctx.rivalry}
        />
      </ToastBoundary>
    </main>
  );
}

