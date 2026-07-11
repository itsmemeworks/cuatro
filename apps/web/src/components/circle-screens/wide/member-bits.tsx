import Link from "next/link";
import { PLACEMENT_TRIO_SIZE } from "@cuatro/glass";
import { formatGlass } from "@/lib/design";
import { PlacementTrioProgress } from "@/components/glass/placement-trio-progress";
import { memberAttrFacts, type MemberListItem } from "@/components/circles/member-list";

/**
 * Shared member-row pieces for the wide circle tabs (WEB-SHELL-SPEC.md Wave B).
 * The design's Members tab (big rows) and the Feed's side card (compact rows)
 * both key off the same facts: role, reliability, rating, Placement Trio
 * progress. All strings are derived from real data — no invented streaks.
 */

/**
 * The mono status subline: reliability, or Placement Trio for the unrated. Role
 * ("organiser"/"you") is carried by the chip beside the name, not repeated here
 * (matches the design's Members rows), so this stays reliability-only.
 */
export function memberStatusLine(m: MemberListItem): string {
  const base =
    m.rating == null
      ? `Placement Trio · ${Math.min(m.verifiedMatchCount, PLACEMENT_TRIO_SIZE)} of ${PLACEMENT_TRIO_SIZE} played`
      : m.reliability != null
        ? `✓ shows up ${Math.round(m.reliability * 100)}%`
        : "no RSVP history yet";
  // Issue #21 soft signals ride the same mono line when set (design Members
  // rows: "✓ shows up 97% · … · drive") — rated or not.
  return `${base}${memberAttrFacts(m)}`;
}

/** Role/you/new badge, matching the phone MemberList precedence (organiser > you > new). */
const NEW_MEMBER_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export function memberBadge(m: MemberListItem, isYou: boolean): { text: string; kind: "organiser" | "you" | "new" } | null {
  if (m.role === "organiser") return { text: "ORGANISER", kind: "organiser" };
  if (isYou) return { text: "YOU", kind: "you" };
  if (Date.now() - new Date(m.joinedAt).getTime() < NEW_MEMBER_WINDOW_MS) return { text: "NEW", kind: "new" };
  return null;
}

const BADGE_STYLE: Record<"organiser" | "you" | "new", string> = {
  organiser: "bg-ink-hairline-2 text-ink",
  you: "text-action-strong",
  new: "bg-win-tint text-win",
};

/** A tappable wrapper — a member's profile, your own /profile, or unlinked for guests. */
export function memberHref(m: MemberListItem, isYou: boolean): string | null {
  return m.isGuest ? null : isYou ? "/profile" : `/players/${m.userId}`;
}

export function MemberBadge({ badge }: { badge: { text: string; kind: "organiser" | "you" | "new" } }) {
  const extra = badge.kind === "you" ? "" : "px-2.5 py-[3px] rounded-full";
  const base = badge.kind === "you" ? "text-[10px]" : "text-[10px] font-bold tracking-[0.06em]";
  const bg = badge.kind === "you" ? "text-action-strong" : BADGE_STYLE[badge.kind];
  return <span className={`font-sans ${base} ${extra} ${bg}`}>{badge.kind === "you" ? "· you" : badge.text}</span>;
}

/** The right-hand Glass cell: number + conf, or ?.?? + Placement Trio ticks. */
export function GlassCell({ m }: { m: MemberListItem }) {
  return (
    <div className="text-right shrink-0">
      <div className={`font-sans font-extrabold text-[17px] ${m.rating == null ? "text-ink-muted" : "text-ink"}`}>{formatGlass(m.rating)}</div>
      {m.rating != null ? (
        <div className="font-mono text-[10px] text-ink-muted mt-0.5">conf {Math.round(m.confidence * 100)}%</div>
      ) : (
        <div className="mt-1 flex justify-end">
          <PlacementTrioProgress verifiedMatchCount={m.verifiedMatchCount} />
        </div>
      )}
    </div>
  );
}

/** Optional link wrapper shared by both densities. */
export function MemberRowLink({ href, className, children }: { href: string | null; className: string; children: React.ReactNode }) {
  return href ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}
