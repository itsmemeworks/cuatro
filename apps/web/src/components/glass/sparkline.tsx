/**
 * Zero-dependency inline-SVG season sparkline: bars, oldest -> newest, the
 * most recent bar always in the action colour — mirrors the little
 * eight-bar chart next to the Glass hero number in design/CUATRO-Prototype
 * (screen 8). Older bars fade in from a low ink opacity so the eye reads
 * "building up to now" left-to-right.
 */
export function Sparkline({ values, height = 34 }: { values: number[]; height?: number }) {
  if (values.length < 2) {
    return (
      <div style={{ height }} className="flex items-center">
        <p className="text-cu-meta text-ink-muted">One more verified match unlocks your trend line.</p>
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const barW = 9;
  const gap = 3;
  const width = values.length * barW + (values.length - 1) * gap;
  const minBarH = 4;

  const bars = values.map((v, i) => {
    const h = minBarH + ((v - min) / span) * (height - minBarH);
    return { x: i * (barW + gap), y: height - h, h, isLast: i === values.length - 1, fade: 0.12 + (i / (values.length - 1)) * 0.1 };
  });

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Season trend">
      {bars.map((b, i) => (
        <rect
          key={i}
          x={b.x}
          y={b.y}
          width={barW}
          height={b.h}
          rx={3}
          style={b.isLast ? { fill: "var(--color-action)" } : { fill: "var(--color-ink)", opacity: b.fade }}
        />
      ))}
    </svg>
  );
}
