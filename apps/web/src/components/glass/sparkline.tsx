/** Zero-dependency inline-SVG sparkline of ratingAfter across Ledger entries, oldest -> newest. */
export function Sparkline({ values, width = 240, height = 48 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) {
    return (
      <div style={{ height, display: "flex", alignItems: "center" }}>
        <p className="text-xs" style={{ color: "var(--c4-text-muted)" }}>
          One more verified match unlocks your trend line.
        </p>
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 4;
  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const rising = values.at(-1)! >= values[0]!;
  const stroke = rising ? "var(--c4-accent)" : "var(--c4-danger)";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Rating trend">
      <polyline points={points.join(" ")} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={points.at(-1)!.split(",")[0]} cy={points.at(-1)!.split(",")[1]} r={3} fill={stroke} />
    </svg>
  );
}
