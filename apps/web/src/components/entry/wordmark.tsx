/**
 * The CUATRO wordmark: a type-only lockup (Archivo 900, tracking -2%) so the
 * working title can be renamed in exactly one place (design/HANDOFF.md's
 * "Fidelity" note). Change APP_NAME here — nowhere else in the app should
 * hardcode the product name in a heading.
 */
export const APP_NAME = "CUATRO";

export function Wordmark({
  size = "hero",
  showMark = true,
  onDark = true,
  className = "",
}: {
  size?: "hero" | "md";
  /** The small coral ◆ mark above the wordmark — omit when space is tight. */
  showMark?: boolean;
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
  const markClass = onDark ? "text-[#FF7A5C]" : "text-action";
  const wordClass = onDark ? "text-[#F5F2EC]" : "text-ink";
  return (
    <div className={className}>
      {showMark && (
        <div className={`font-extrabold text-[13px] leading-none mb-3 ${markClass}`} aria-hidden>
          ◆
        </div>
      )}
      <div className={`text-cu-wordmark ${sizeClass} ${wordClass}`}>{APP_NAME}</div>
    </div>
  );
}
