import type { ElementType, ReactNode } from "react";

/**
 * "If it's a fact, it's mono." (design/HANDOFF.md)
 *
 * IBM Plex Mono is reserved for metadata: timestamps, money, rating
 * context, ledger explanations. Archivo carries everything else,
 * including the Glass number itself — the display face is for the
 * hero number, mono is for the context around it, never the reverse.
 *
 * `Meta` is quiet, small, muted context text (timestamps, captions,
 * confidence/context lines). `Fact` is a fact that matters — money,
 * Glass deltas, counts — mono + tabular-nums, with a `tone` for the
 * win/loss colour a number can carry.
 */

type Tone = "neutral" | "muted" | "win" | "loss" | "streak" | "action";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "text-ink",
  muted: "text-ink-muted",
  win: "text-win",
  loss: "text-loss",
  streak: "text-streak",
  action: "text-action",
};

/**
 * `onFeature` overrides for the tones whose theme-reactive token would go
 * dark-on-dark on Card variant="feature" (a fixed-dark surface in BOTH
 * themes). `win`/`streak` are left out — nothing on surface-feature uses
 * them yet, and their theme-reactive greens/ambers already read fine on a
 * dark card in both themes.
 */
const ON_FEATURE_TONE_CLASS: Partial<Record<Tone, string>> = {
  neutral: "text-ink-on-feature",
  muted: "text-ink-on-feature-muted",
  loss: "text-loss-on-feature",
  action: "text-action-on-feature-label",
};

export function Meta({
  as: As = "span",
  tone = "muted",
  onFeature = false,
  className = "",
  children,
}: {
  as?: ElementType;
  tone?: Tone;
  /** See Button's `onFeature` — this card's tones need fixed bone/coral colours, not the theme-reactive ones. */
  onFeature?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const toneClass = (onFeature && ON_FEATURE_TONE_CLASS[tone]) || TONE_CLASS[tone];
  return (
    <As className={`text-cu-meta tabular-nums ${toneClass} ${className}`}>{children}</As>
  );
}

const FACT_SIZE_CLASS = {
  meta: "text-[10px]",
  sm: "text-[11px]",
  md: "text-[13px]",
  lg: "text-[15px]",
  /** The one-per-screen hero score (Feed result posts) — bigger than `lg` on purpose, still mono/tabular. */
  xl: "text-[28px]",
} as const;

export function Fact({
  as: As = "span",
  size = "sm",
  tone = "neutral",
  weight = "semibold",
  onFeature = false,
  className = "",
  children,
}: {
  as?: ElementType;
  size?: keyof typeof FACT_SIZE_CLASS;
  tone?: Tone;
  weight?: "normal" | "medium" | "semibold" | "bold";
  /** See Button's `onFeature` — this card's tones need fixed bone/coral colours, not the theme-reactive ones. */
  onFeature?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const weightClass = {
    normal: "font-normal",
    medium: "font-medium",
    semibold: "font-semibold",
    bold: "font-bold",
  }[weight];
  const toneClass = (onFeature && ON_FEATURE_TONE_CLASS[tone]) || TONE_CLASS[tone];

  return (
    <As className={`font-mono tabular-nums ${weightClass} ${FACT_SIZE_CLASS[size]} ${toneClass} ${className}`}>
      {children}
    </As>
  );
}
