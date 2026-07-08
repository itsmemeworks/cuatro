import type { ReactNode } from "react";

/**
 * Avatar, AvatarStack and DashedSlot — the fourth's empty chair.
 *
 * DashedSlot is called out in the handoff as "the brand's most important
 * component": a dashed coral circle standing in for a person who hasn't
 * joined yet. It appears as the open 4th in a slot grid, the "invite a
 * mate" row, and the claim-in-progress state of a Fourth Call. Use `pulse`
 * when the slot is actively waiting on a live action (e.g. mid Fourth
 * Call) — not on every static render of an open slot, or the pulse stops
 * meaning anything.
 *
 * Overlap convention: stacks overlap avatars by -10px (sm) / -11px (md) /
 * -16px (lg), with a 2px ring in the colour of whatever surface the stack
 * sits on (default `surface`, i.e. a card) so overlapping circles read as
 * cut into each other rather than just stacked flat.
 */

export type AvatarSize = "xs" | "sm" | "md" | "lg";
export type RingSurface = "ground" | "surface" | "surface-feature" | "none";

const SIZE_PX: Record<AvatarSize, number> = { xs: 22, sm: 26, md: 34, lg: 58 };
const OVERLAP_PX: Record<AvatarSize, number> = { xs: 8, sm: 10, md: 11, lg: 16 };

const RING_CLASS: Record<Exclude<RingSurface, "none">, string> = {
  ground: "ring-[var(--color-ground)]",
  surface: "ring-[var(--color-surface)]",
  "surface-feature": "ring-[var(--color-surface-feature)]",
};

function initialsOf(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

export function Avatar({
  src,
  name,
  size = "md",
  ring = "none",
  overlap = false,
  className = "",
}: {
  src?: string | null;
  name: string;
  size?: AvatarSize;
  ring?: RingSurface;
  /** Apply the stack's negative left-margin so this avatar can sit inline after another. */
  overlap?: boolean;
  className?: string;
}) {
  const px = SIZE_PX[size];
  const style = {
    width: px,
    height: px,
    marginLeft: overlap ? -OVERLAP_PX[size] : undefined,
  };
  const ringClass = ring !== "none" ? `ring-2 ${RING_CLASS[ring]}` : "";

  if (!src) {
    return (
      <div
        className={`rounded-full flex-none flex items-center justify-center bg-action text-action-contrast font-extrabold ${ringClass} ${className}`}
        style={{ ...style, fontSize: px * 0.42 }}
        aria-label={name}
      >
        {initialsOf(name)}
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element -- avatars are frequently remote/user-uploaded; next/image adds little here.
  return <img src={src} alt={name} className={`rounded-full flex-none object-cover ${ringClass} ${className}`} style={style} />;
}

export function AvatarStack({
  people,
  size = "md",
  ring = "surface",
  max,
  className = "",
}: {
  people: { src?: string | null; name: string }[];
  size?: AvatarSize;
  ring?: RingSurface;
  /** Cap the number of avatars shown, replacing the rest with a "+N" indicator. */
  max?: number;
  className?: string;
}) {
  const shown = max ? people.slice(0, max) : people;
  const overflow = max ? Math.max(0, people.length - max) : 0;
  const px = SIZE_PX[size];

  return (
    <div className={`flex items-center ${className}`}>
      {shown.map((person, i) => (
        <Avatar key={i} src={person.src} name={person.name} size={size} ring={ring} overlap={i > 0} />
      ))}
      {overflow > 0 && (
        <div
          className={`rounded-full flex-none flex items-center justify-center bg-ink-hairline-2 text-ink font-bold ${ring !== "none" ? `ring-2 ${RING_CLASS[ring]}` : ""}`}
          style={{ width: px, height: px, marginLeft: -OVERLAP_PX[size], fontSize: px * 0.32 }}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}

export function DashedSlot({
  label = "4",
  size = "md",
  pulse = false,
  overlap = false,
  className = "",
  children,
}: {
  label?: ReactNode;
  size?: AvatarSize;
  /** Reserve for a slot that's live/actively awaiting a claim — not every static open slot. */
  pulse?: boolean;
  overlap?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const px = SIZE_PX[size];
  return (
    <div
      className={`rounded-full flex-none flex items-center justify-center border-2 border-dashed border-action text-action font-extrabold bg-transparent ${pulse ? "animate-cu-pulse" : ""} ${className}`}
      style={{ width: px, height: px, marginLeft: overlap ? -OVERLAP_PX[size] : undefined, fontSize: px * 0.4 }}
    >
      {children ?? label}
    </div>
  );
}
