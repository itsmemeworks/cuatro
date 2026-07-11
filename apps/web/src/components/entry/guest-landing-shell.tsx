/*
 * GuestLandingShell — the responsive wrapper for the standalone guest routes
 * (/fc/[token], /join/[code]), which live OUTSIDE the (app) shell.
 *
 * Below 900px it reproduces components/shell/phone-frame.tsx byte-for-byte
 * (the centred 448 column on bg-ground) so nothing on a phone shifts. At
 * 900px+ (design "Guest link landing", CUATRO-Web-LATEST.dc.html) the 448
 * clamp lifts — the pages' own content columns take the design's per-step
 * widths via their additive min-[900px]: classes — and the design's soft
 * radial glow appears behind the content. The glow strength follows the
 * theme (the design file is dark; a light OS theme gets a fainter wash) via
 * the same prefers-color-scheme + [data-theme] override pattern globals.css
 * uses. Wave A/B's sibling-tree split is for static trees only — these
 * landings are stateful claim/join flows, so this is the single-tree,
 * additive-classes variant of the same <900-untouched rule.
 */
const GLOW_CSS = `
.c4-guest-glow{display:none;--c4-guest-glow-c:rgba(46,84,150,.22)}
@media (prefers-color-scheme: light){.c4-guest-glow{--c4-guest-glow-c:rgba(46,84,150,.08)}}
:root[data-theme="dark"] .c4-guest-glow{--c4-guest-glow-c:rgba(46,84,150,.22)}
:root[data-theme="light"] .c4-guest-glow{--c4-guest-glow-c:rgba(46,84,150,.08)}
@media (min-width: 900px){.c4-guest-glow{display:block;background:radial-gradient(ellipse at 50% -10%, var(--c4-guest-glow-c), transparent 60%)}}
`;

export function GuestLandingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh bg-ground">
      <style>{GLOW_CSS}</style>
      <div aria-hidden className="c4-guest-glow pointer-events-none absolute inset-0" />
      {/* min-[900px]:bg-transparent lets the glow (a sibling layer behind this
          column) read through at wide; below 900 the column stays opaque
          bg-ground exactly like PhoneFrame. */}
      <div className="relative mx-auto min-h-dvh max-w-[448px] min-[900px]:max-w-none bg-ground text-ink min-[900px]:bg-transparent">{children}</div>
    </div>
  );
}
