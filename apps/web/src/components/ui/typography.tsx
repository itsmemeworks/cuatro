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

export function Meta({
  as: As = "span",
  tone = "muted",
  className = "",
  children,
}: {
  as?: ElementType;
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <As className={`text-cu-meta tabular-nums ${TONE_CLASS[tone]} ${className}`}>{children}</As>
  );
}

const FACT_SIZE_CLASS = {
  meta: "text-[10px]",
  sm: "text-[11px]",
  md: "text-[13px]",
  lg: "text-[15px]",
} as const;

export function Fact({
  as: As = "span",
  size = "sm",
  tone = "neutral",
  weight = "semibold",
  className = "",
  children,
}: {
  as?: ElementType;
  size?: keyof typeof FACT_SIZE_CLASS;
  tone?: Tone;
  weight?: "normal" | "medium" | "semibold" | "bold";
  className?: string;
  children: ReactNode;
}) {
  const weightClass = {
    normal: "font-normal",
    medium: "font-medium",
    semibold: "font-semibold",
    bold: "font-bold",
  }[weight];

  return (
    <As className={`font-mono tabular-nums ${weightClass} ${FACT_SIZE_CLASS[size]} ${TONE_CLASS[tone]} ${className}`}>
      {children}
    </As>
  );
}
