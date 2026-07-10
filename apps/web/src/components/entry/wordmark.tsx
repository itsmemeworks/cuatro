/**
 * The CUATRO wordmark: a type-only lockup (Archivo 900, tracking -2%) so the
 * working title can be renamed in exactly one place (design/HANDOFF.md's
 * "Fidelity" note). Change APP_NAME here — nowhere else in the app should
 * hardcode the product name in a heading.
 *
 * Brand lockup (Pete, 2026-07-10): the final letter renders in coral — the
 * "coloured O" — matching the marketing site. The old ◆ mark above the
 * wordmark was retired at the same time.
 */
export const APP_NAME = "CUATRO";

export function Wordmark({
  size = "hero",
  onDark = true,
  className = "",
}: {
  size?: "hero" | "md";
  /**
   * The onboarding hero always sits on the dark ambient-court art regardless
   * of the visitor's OS theme (the art itself is an always-dark scene, per
   * design/HANDOFF.md) — so its wordmark needs fixed bone/coral colours
   * rather than the theme-reactive `text-ink`/`text-action` tokens, which
   * would flip to near-black on a light OS theme and disappear. Set false
   * only for a wordmark placed on a theme-following surface.
   */
  onDark?: boolean;
  className?: string;
}) {
  const sizeClass = size === "hero" ? "text-[44px]" : "text-[22px]";
  const wordClass = onDark ? "text-[#F5F2EC]" : "text-ink";
  const accentClass = onDark ? "text-[#FF5C3D]" : "text-action";
  const body = APP_NAME.slice(0, -1);
  const accent = APP_NAME.slice(-1);
  return (
    <div className={className}>
      <div className={`text-cu-wordmark ${sizeClass} ${wordClass}`}>
        {body}
        <span className={accentClass}>{accent}</span>
      </div>
    </div>
  );
}
