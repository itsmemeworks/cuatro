/** Show-up rate + RSVP discipline badge — see DESIGN.md "RELIABILITY". */
export function ReliabilityBadge({ pct, lateCancelCount }: { pct: number | null; lateCancelCount: number }) {
  if (pct === null) {
    return (
      <p className="text-xs" style={{ color: "var(--c4-text-muted)" }}>
        Reliability badge appears after your first RSVP.
      </p>
    );
  }

  const color = pct >= 90 ? "var(--c4-accent)" : pct >= 70 ? "var(--c4-warning)" : "var(--c4-danger)";

  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
        style={{ background: "var(--c4-bg-elevated-2)", color, border: "1px solid var(--c4-border)" }}
      >
        ✓ {pct}%
      </span>
      <span className="text-xs" style={{ color: "var(--c4-text-muted)" }}>
        show-up rate{lateCancelCount > 0 ? ` · ${lateCancelCount} late cancel${lateCancelCount === 1 ? "" : "s"}` : ""}
      </span>
    </div>
  );
}
