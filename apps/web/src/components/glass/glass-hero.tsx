import Link from "next/link";
import type { ProfileGlassView } from "@/server/matches-db";

/**
 * The big Glass number (or the Unrated placement-progress state). This is
 * the hero treatment for /profile — see DESIGN.md section 2 ("GLASS") and
 * the design brief's "anticipation framing" for the pre-placement state.
 */
export function GlassHero({ glass }: { glass: ProfileGlassView }) {
  if (glass.status === "unrated") {
    const played = glass.verifiedMatchCount;
    const remaining = glass.matchesUntilPlacement;
    return (
      <section
        className="rounded-2xl p-5 flex flex-col gap-3"
        style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-sm font-semibold"
            style={{ background: "var(--c4-bg-elevated-2)", border: "1px dashed var(--c4-border)", color: "var(--c4-text-muted)" }}
          >
            {played}/3
          </div>
          <div>
            <p className="font-medium">Glass: Unrated</p>
            <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
              {remaining === 0
                ? "Your Placement Trio is complete — your number appears the moment this match verifies."
                : remaining === 1
                  ? "One more verified match and your Glass number appears."
                  : `${remaining} of 3 placement matches to go.`}
            </p>
          </div>
        </div>
        <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "var(--c4-bg-elevated-2)" }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${(played / 3) * 100}%`, background: "var(--c4-accent)" }}
          />
        </div>
        <p className="text-xs" style={{ color: "var(--c4-text-muted)" }}>
          No questionnaire. No guessing. Your number only shows once real matches have earned it.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl p-5 flex flex-col gap-2"
      style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
    >
      <div className="flex items-end gap-3">
        <span className="text-5xl font-semibold tabular-nums" style={{ color: "var(--c4-accent)" }}>
          {glass.rating!.toFixed(2)}
        </span>
        <span className="text-sm mb-1.5" style={{ color: "var(--c4-text-muted)" }}>
          Glass
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--c4-bg-elevated-2)" }}>
          <div className="h-full rounded-full" style={{ width: `${glass.confidencePct}%`, background: "var(--c4-accent-strong)" }} />
        </div>
        <span className="text-xs font-medium tabular-nums" style={{ color: "var(--c4-text-muted)" }}>
          {glass.confidencePct}% confidence
        </span>
      </div>
      <p className="text-xs" style={{ color: "var(--c4-text-muted)" }}>
        {glass.verifiedMatchCount} verified {glass.verifiedMatchCount === 1 ? "match" : "matches"}. Confidence grows
        with opponent variety, not volume.
      </p>
      <Link href="/profile/ledger" className="text-sm font-medium" style={{ color: "var(--c4-accent)" }}>
        See exactly why in the Ledger →
      </Link>
    </section>
  );
}
