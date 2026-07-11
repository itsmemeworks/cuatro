import type { ReactNode } from "react";

/*
 * Wide circle-context primitives (WEB-SHELL-SPEC.md Wave B), used by the Games
 * and Tab routes' wide siblings (which are `hidden min-[900px]:block`), so they
 * carry no responsive prefixes — they reproduce the design's main content
 * column: max-width 1000px, centred, 30px side padding (the shell content
 * column supplies the 26/34 top/bottom).
 * Colours come from the theme tokens, whose dark values are pixel-identical to
 * the design's literal hexes, so the dark gate matches and light mode still
 * works (resolving the Wave A "dark content in light mode" deviation).
 */

export function WidePage({ children }: { children: ReactNode }) {
  // `c4-wide` is the opt-in the shell CSS keys off (globals.css
  // `.c4-shell-content:has(.c4-wide)`): its presence lifts the 448 clamp at
  // 900px+. The wide sibling is `hidden min-[900px]:block`; the rule only fires
  // inside a 900px media query, so below 900 the phone column stays clamped.
  return <div className="c4-wide mx-auto w-full max-w-[1000px] px-[30px]">{children}</div>;
}

/**
 * The page header every wide circle tab shares: a 24px title, a muted subline,
 * and an optional right-aligned slot (avatar stack, "+ Add" button, net total).
 */
export function WideHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end gap-3.5">
      <div className="flex-1 min-w-0">
        <h1 className="font-sans font-extrabold text-[24px] leading-none text-ink">{title}</h1>
        {subtitle != null && <p className="font-sans text-[12px] text-ink-muted mt-1">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

/** A titled surface card with the design's uppercase mono-ish section header bar. */
export function WideCard({ label, right, children, className = "" }: { label?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`bg-surface border border-ink-hairline-1 rounded-[20px] overflow-hidden ${className}`}>
      {label != null && (
        <div className="flex items-center justify-between px-[18px] py-3 bg-ink-hairline-1">
          <span className="font-sans font-extrabold text-[10px] tracking-[0.14em] text-ink-muted">{label}</span>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}
