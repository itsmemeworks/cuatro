import Link from "next/link";
import { formatMoney } from "./money";

export interface TabSummaryRowProps {
  circleId: string;
  /** The viewer's net position per currency (see @/server/tab's getTabView) — positive: owed money; negative: owes money; empty object: all square. */
  netPositionByCurrency: Record<string, number>;
}

/**
 * A single-line net-position summary meant for the Circle page (see
 * HANDOFF.md screen 3's "Tab settle row"). Exported for wiring in from
 * there — this component does not add itself to circles/[id]/page.tsx,
 * since that page belongs to another agent (see the Tab build's path
 * ownership rules).
 */
export function TabSummaryRow({ circleId, netPositionByCurrency }: TabSummaryRowProps) {
  const balances = Object.entries(netPositionByCurrency).filter(([, minor]) => minor !== 0);

  return (
    <Link
      href={`/circles/${circleId}/tab`}
      className="tab-summary-row flex items-center justify-between gap-3 rounded-xl p-3"
      style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
    >
      <span className="tab-summary-row__label text-sm font-medium">The Tab</span>
      {balances.length === 0 ? (
        <span className="tab-summary-row__status text-sm" style={{ color: "var(--c4-text-muted)" }}>
          All square ✓
        </span>
      ) : (
        <span className="tab-summary-row__net flex gap-2 font-mono text-sm">
          {balances.map(([currency, minor]) => (
            <span key={currency} style={{ color: minor > 0 ? "var(--c4-accent)" : "var(--c4-danger)" }}>
              {minor > 0 ? "+" : ""}
              {formatMoney(minor, currency)}
            </span>
          ))}
        </span>
      )}
    </Link>
  );
}
