import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar, DashedSlot, type AvatarSize, type RingSurface } from "@/components/ui";
import { circleColorFor } from "@/lib/design";

/**
 * Shared game-surface roster bits: the Circle's colour identity, an
 * overlapping stack of confirmed faces trailed by the canonical dashed-coral
 * open slots, and a link that carries a player through to their profile.
 *
 * Kept local to components/games (not promoted to components/ui/avatar) so the
 * Circles surfaces, worked on in parallel, keep the shared Avatar/AvatarStack
 * to themselves. Circle colour is identity, never an action — coral stays the
 * one action per screen (see cuatro/CLAUDE.md §7).
 */

/** A player rendered on a game surface, enriched where the surface can supply it. */
export type RosterPlayer = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /** Glass rating; null while unrated, undefined when the surface doesn't carry it. */
  rating?: number | null;
  /** Guests have no profile to link to; undefined when the surface can't tell. */
  isGuest?: boolean;
};

/** The Circle's colour, derived from a stable seed (its id, or its name when no id is to hand). */
export function circleColour(seed: string): string {
  return circleColorFor(seed);
}

/**
 * The Circle's coloured identity chip: its emblem (or name initials) on the
 * Circle's own colour. Mirrors the emblem disc the Circle header uses, sized
 * down for a card. Decorative — the Circle name always reads beside it.
 */
export function CircleEmblem({
  seed,
  name,
  emblem,
  px = 26,
}: {
  seed: string;
  name: string;
  emblem?: string | null;
  px?: number;
}) {
  return (
    <span
      className="rounded-[7px] inline-flex items-center justify-center shrink-0 text-white font-extrabold"
      style={{ background: circleColorFor(seed), width: px, height: px, fontSize: px * 0.4 }}
      aria-hidden
    >
      {emblem ?? name.slice(0, 2).toUpperCase()}
    </span>
  );
}

/**
 * A player linked through to their profile. Guests have no profile, so they
 * render unlinked. The /players/:id route is owned elsewhere; this only links.
 */
export function PlayerLink({
  userId,
  isGuest,
  className = "",
  children,
}: {
  userId: string;
  isGuest?: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (isGuest) return <span className={className}>{children}</span>;
  return (
    <Link href={`/players/${userId}`} className={className}>
      {children}
    </Link>
  );
}

/**
 * Confirmed faces overlapping left-to-right, trailed by one dashed-coral circle
 * per open slot — "who's playing, and how many spots are still waiting for a
 * person" in a single glance. Display-only: use it where the whole card is
 * already a tap target (a row link), so nested profile links can't apply.
 */
export function RosterStack({
  confirmed,
  slots,
  size = "sm",
  ring = "surface",
}: {
  confirmed: { userId: string; displayName: string; avatarUrl: string | null }[];
  slots: number;
  size?: AvatarSize;
  ring?: RingSurface;
}) {
  const openCount = Math.max(0, slots - confirmed.length);
  return (
    <div className="flex items-center">
      {confirmed.map((p, i) => (
        <Avatar key={p.userId} src={p.avatarUrl} name={p.displayName} size={size} ring={ring} overlap={i > 0} />
      ))}
      {Array.from({ length: openCount }, (_, i) => (
        <DashedSlot key={`open-${i}`} size={size} label="" overlap={confirmed.length > 0 || i > 0} />
      ))}
    </div>
  );
}
