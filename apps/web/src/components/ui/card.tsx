import type { ElementType, HTMLAttributes } from "react";

/**
 * Card: radius 20, padding 16, hairline border — the base surface for
 * everything from game rows to ledger entries.
 *
 * `variant="feature"` is the surface-feature treatment: a deliberately
 * darker/moodier card reserved for the single most important thing on a
 * screen (the "up next" / needs-your-answer card). The rule from
 * design/HANDOFF.md is strict: **max ONE surface-feature card per screen.**
 */
export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  variant?: "default" | "feature";
  /** Set false to opt out of the default 16px padding (e.g. list containers that pad their own rows). */
  padded?: boolean;
}

export function Card({ as: As = "div", variant = "default", padded = true, className = "", ...props }: CardProps) {
  return (
    <As
      className={[
        "rounded-card",
        variant === "feature" ? "bg-surface-feature border border-ink-hairline-2" : "bg-surface border border-ink-hairline-1",
        padded ? "p-4" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
