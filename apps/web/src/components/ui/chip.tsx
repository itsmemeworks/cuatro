import type { ReactNode } from "react";

/**
 * Status chips (Directions turn 9d): "chips state facts, never demand."
 * A dashed border means "a space waiting for a person" — pair with
 * `dashed` wherever a slot, invite or open spot is being described.
 */
export type ChipTone = "neutral" | "positive" | "negative" | "streak";

const TONE_CLASS: Record<ChipTone, string> = {
  neutral: "bg-ink-hairline-2 text-ink",
  positive: "bg-win-tint text-win",
  negative: "bg-loss-tint text-loss",
  streak: "bg-streak-tint text-streak",
};

export function Chip({
  tone = "neutral",
  dashed = false,
  className = "",
  children,
}: {
  tone?: ChipTone;
  /** Dashed coral border, transparent fill — "a space waiting for a person." Overrides `tone` visually. */
  dashed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={[
        "rounded-chip inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold whitespace-nowrap",
        dashed ? "bg-transparent text-action border border-dashed border-action" : `border border-transparent ${TONE_CLASS[tone]}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}
