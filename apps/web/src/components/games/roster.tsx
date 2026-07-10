import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar, DashedSlot, Fact, type AvatarSize, type RingSurface } from "@/components/ui";
import { circleColorFor, formatGlass } from "@/lib/design";

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

/**
 * The Circle's colour. Prefers the organiser's explicitly-chosen `colour`
 * (a hex from the curated palette, see components/circles/presets.ts); falls
 * back to the deterministic per-seed colour only when none is set, so a game
 * card always matches its Circle's chosen identity where one exists.
 */
export function circleColour(seed: string, explicit?: string | null): string {
  return explicit ?? circleColorFor(seed);
}

/**
 * The Circle's coloured identity chip: its emblem (or name initials) on the
 * Circle's own colour. Mirrors the emblem disc the Circle header uses, sized
 * down for a card. Decorative — the Circle name always reads beside it.
 * `colour`/`emblem` are the organiser's explicit choices; each falls back
 * (colour → deterministic seed colour, emblem → name initials) when null.
 */
export function CircleEmblem({
  seed,
  name,
  emblem,
  colour,
  px = 26,
}: {
  seed: string;
  name: string;
  emblem?: string | null;
  colour?: string | null;
  px?: number;
}) {
  return (
    <span
      className="rounded-[7px] inline-flex items-center justify-center shrink-0 text-white font-extrabold"
      style={{ background: colour ?? circleColorFor(seed), width: px, height: px, fontSize: px * 0.4 }}
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

/**
 * "who you'd be playing with" as one inline, readable line — the confirmed
 * players' names, each linked to their profile (guests unlinked), optionally
 * trailed by their Glass in mono. For tight spots (a Board card, a Home row)
 * where a full row-list would be too heavy. Names inherit the surrounding
 * text colour so this reads correctly on any surface; the parent sets tone.
 *
 * `linkPlayers` is off for logged-out surfaces (public /fc + /join), where the
 * (app) profile route would bounce the viewer — plain names still tell them
 * who's in. `firstNameOnly` keeps it to first names where space is tightest.
 */
export function RosterNames({
  players,
  linkPlayers = true,
  showGlass = false,
  firstNameOnly = false,
  prefix,
  className = "",
}: {
  players: RosterPlayer[];
  linkPlayers?: boolean;
  showGlass?: boolean;
  firstNameOnly?: boolean;
  prefix?: string;
  className?: string;
}) {
  if (players.length === 0) return null;
  return (
    <span className={className}>
      {prefix}
      {players.map((p, i) => {
        const label = firstNameOnly ? p.displayName.split(" ")[0] : p.displayName;
        const linked = linkPlayers && !p.isGuest;
        return (
          <span key={p.userId}>
            {i > 0 ? ", " : ""}
            {linked ? (
              <PlayerLink userId={p.userId} className="font-semibold underline-offset-2 hover:underline">
                {label}
              </PlayerLink>
            ) : (
              <span className="font-semibold">{label}</span>
            )}
            {showGlass && p.rating !== undefined && (
              <Fact as="span" size="meta" tone="muted" className="ml-1">
                {formatGlass(p.rating)}
              </Fact>
            )}
          </span>
        );
      })}
    </span>
  );
}

/**
 * "who you'd be playing with" as a column of rows: avatar + name + Glass,
 * each row a tap-through to the player's profile (guests unlinked). For the
 * surfaces that invite a decision and have room for it (the Fourth Call
 * receive takeover). Glass renders as mono per the design system's facts rule.
 */
export function RosterList({
  players,
  linkPlayers = true,
  size = "sm",
}: {
  players: RosterPlayer[];
  linkPlayers?: boolean;
  size?: AvatarSize;
}) {
  if (players.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 w-full">
      {players.map((p) => {
        const inner = (
          <>
            <Avatar src={p.avatarUrl} name={p.displayName} size={size} />
            <span className="flex-1 text-cu-body font-semibold text-ink truncate text-left">{p.displayName}</span>
            {p.rating !== undefined && (
              <Fact size="sm" tone="muted" className="whitespace-nowrap">
                {formatGlass(p.rating)}
              </Fact>
            )}
          </>
        );
        const cls = "flex items-center gap-2.5";
        return linkPlayers && !p.isGuest ? (
          <PlayerLink key={p.userId} userId={p.userId} className={cls}>
            {inner}
          </PlayerLink>
        ) : (
          <div key={p.userId} className={cls}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
