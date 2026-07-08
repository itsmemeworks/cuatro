import type { ButtonHTMLAttributes } from "react";

/**
 * The button system from design/HANDOFF.md + Directions turn 9d:
 *
 * - `primary` (coral) is THE action. Exactly one per screen — if a screen
 *   already has a primary button, every other button on it must be
 *   `quiet` or `strong`. Don't reach for a second primary because
 *   something "feels important"; that's what `strong` is for.
 * - `strong` inverts ink/ground (bone-on-dark in dark theme, ink-on-cream
 *   in light theme) — for a decisive but non-coral action ("Send to both
 *   teams", "Enter CUATRO").
 * - `quiet` is an outline button for secondary actions.
 * - `destructiveQuiet` is for drop-out / cancel actions ("Can't make it").
 *   It is visually identical to `quiet` on purpose: dropping out carries
 *   the same weight as opting in, never red, never guilt.
 *
 * Sizing: `default` meets the 44px touch-target floor; `lg` is 48px+ for
 * RSVP/settle-class actions the spec calls out as needing extra room.
 */
export type ButtonVariant = "primary" | "strong" | "quiet" | "destructiveQuiet";
export type ButtonSize = "default" | "lg";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-action text-action-contrast border border-transparent",
  strong: "bg-strong-bg text-strong-fg border border-transparent",
  quiet: "bg-transparent text-ink border border-ink-hairline-4",
  destructiveQuiet: "bg-transparent text-ink border border-ink-hairline-4",
};

/**
 * `quiet`/`destructiveQuiet` on Card variant="feature" — see the `onFeature`
 * prop below. `primary`/`strong` don't need an entry: bg-action/text-action-
 * contrast and bg-strong-bg/text-strong-fg are already theme-independent.
 */
const ON_FEATURE_QUIET_CLASS = "bg-transparent text-ink-on-feature border border-ink-on-feature-hairline";

const SIZE_CLASS: Record<ButtonSize, string> = {
  default: "min-h-11 px-4 text-[14px]", // 44px
  lg: "min-h-12 px-5 text-[15px]", // 48px
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /**
   * Set true when this button sits on Card variant="feature" — that card is
   * a fixed-dark surface in BOTH themes, so `quiet`/`destructiveQuiet` need
   * bone ink/border instead of the theme-reactive `text-ink`/`border-ink-
   * hairline-4`, which would render dark-on-dark under a light OS theme.
   * No-op for `primary`/`strong`.
   */
  onFeature?: boolean;
}

export function Button({
  variant = "primary",
  size = "default",
  fullWidth = false,
  onFeature = false,
  className = "",
  ...props
}: ButtonProps) {
  const isQuiet = variant === "quiet" || variant === "destructiveQuiet";
  const weight = isQuiet ? "font-semibold" : "font-extrabold";
  return (
    <button
      className={[
        "rounded-button inline-flex items-center justify-center gap-2 select-none",
        "transition-cu-state active:opacity-80 disabled:opacity-40 disabled:pointer-events-none",
        weight,
        onFeature && isQuiet ? ON_FEATURE_QUIET_CLASS : VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        fullWidth ? "w-full" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
