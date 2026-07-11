import Link from "next/link";
import { Avatar, Card, Chip, Fact, InfoTerm, Meta } from "@/components/ui";
import { formatGlass } from "@/lib/design";
import { PLACEMENT_TRIO_SIZE } from "@cuatro/glass";
import { PlacementTrioProgress } from "@/components/glass/placement-trio-progress";
import { GlassIntroCard } from "@/components/glass/glass-intro-card";
import { courtSideFact, dominantHand } from "@/lib/player-attrs";

export interface MemberListItem {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  role: "organiser" | "member";
  rating: number | null;
  confidence: number;
  reliability: number | null;
  joinedAt: string | Date;
  verifiedMatchCount: number;
  /** Guests have no public profile — their row renders unlinked. Optional: upstream mappers may not set it, in which case a guest tapped through lands on the graceful guest presence page. */
  isGuest?: boolean;
  /** Optional profile facts (issue #21) — soft signals shown as mono facts when set, never a gate or filter. Optional: upstream mappers may not carry them. */
  dominantHand?: string | null;
  courtSide?: string | null;
}

/**
 * " · left hand · Left side (backhand)" — the issue #21 mono facts appended to
 * a member's status line, empty when neither is set. Real padel lingo via
 * courtSideFact; hand reads "left hand" / "right hand" / "either hand".
 */
export function memberAttrFacts(m: Pick<MemberListItem, "dominantHand" | "courtSide">): string {
  const parts: string[] = [];
  const hand = dominantHand(m.dominantHand);
  if (hand) parts.push(hand.id === "both" ? "either hand" : `${hand.label.toLowerCase()} hand`);
  const side = courtSideFact(m.courtSide);
  if (side) parts.push(side);
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
}

const NEW_MEMBER_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Members tab (prototype screen 4): Glass + confidence, a reliability line
 * ("✓ shows up 97%"), and one role chip per row — ORGANISER > YOU > NEW,
 * matching the prototype's precedence (a row never carries two badges).
 * Unrated rows (rating === null) render `?.??` plus the 3-dot Placement
 * Trio progress indicator instead of a confidence line.
 */
export function MemberList({ members, currentUserId }: { members: MemberListItem[]; currentUserId: string }) {
  return (
    <div className="flex flex-col gap-3">
      <GlassIntroCard userId={currentUserId} />
      <Card padded={false} className="overflow-hidden">
      {members.map((m, i) => {
        const isYou = m.userId === currentUserId;
        const isNew =
          !isYou && m.role !== "organiser" && Date.now() - new Date(m.joinedAt).getTime() < NEW_MEMBER_WINDOW_MS;
        const reliabilityLabel =
          m.rating == null ? (
            <>
              <InfoTerm term="placementTrio" label="Placement Trio" /> ·{" "}
              {Math.min(m.verifiedMatchCount, PLACEMENT_TRIO_SIZE)} of {PLACEMENT_TRIO_SIZE} played
            </>
          ) : m.reliability != null ? (
            `✓ shows up ${Math.round(m.reliability * 100)}%`
          ) : (
            "no RSVP history yet"
          );

        // Tap a member to view their profile. Guests have no profile (unlinked);
        // your own row goes to your canonical /profile.
        const href = m.isGuest ? null : isYou ? "/profile" : `/players/${m.userId}`;
        const rowClass = `flex items-center gap-3 px-4 py-3.5 ${i < members.length - 1 ? "border-b border-ink-hairline-1" : ""}`;
        const rowInner = (
          <>
            <Avatar src={m.avatarUrl} name={m.displayName} size="md" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-cu-body font-bold text-ink truncate">{m.displayName}</span>
                {m.role === "organiser" ? (
                  <Chip tone="neutral" className="text-[9px] tracking-[0.06em]">
                    ORGANISER
                  </Chip>
                ) : isYou ? (
                  <Chip tint={{ bg: "rgba(255,92,61,0.16)", text: "var(--color-action-strong)" }} className="text-[9px] tracking-[0.06em]">
                    YOU
                  </Chip>
                ) : isNew ? (
                  <Chip tone="positive" className="text-[9px] tracking-[0.06em]">
                    NEW
                  </Chip>
                ) : null}
              </div>
              <Meta as="p" className="mt-1">
                {reliabilityLabel}
                {memberAttrFacts(m)}
              </Meta>
            </div>
            <div className="text-right shrink-0">
              <Fact size="lg" weight="bold" tone={m.rating == null ? "muted" : "neutral"}>
                {formatGlass(m.rating)}
              </Fact>
              {m.rating != null ? (
                <Meta as="p" className="mt-0.5">
                  <InfoTerm term="confidence" label="conf" /> {Math.round(m.confidence * 100)}%
                </Meta>
              ) : (
                <div className="mt-1 flex flex-col items-end gap-1">
                  <Meta>not rated yet</Meta>
                  <PlacementTrioProgress verifiedMatchCount={m.verifiedMatchCount} />
                </div>
              )}
            </div>
          </>
        );

        return href ? (
          <Link key={m.userId} href={href} className={`${rowClass} transition-cu-state active:bg-ink-hairline-1`}>
            {rowInner}
          </Link>
        ) : (
          <div key={m.userId} className={rowClass}>
            {rowInner}
          </div>
        );
      })}
      </Card>
    </div>
  );
}
