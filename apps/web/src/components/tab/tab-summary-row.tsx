import Link from "next/link";
import { Fact, Meta } from "@/components/ui";
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
      className="tab-summary-row flex items-center justify-between gap-3 rounded-card bg-surface border border-ink-hairline-1 p-3"
    >
      <span className="tab-summary-row__label text-cu-body font-bold text-ink">The Tab</span>
      {balances.length === 0 ? (
        <Meta as="span" className="tab-summary-row__status">All square ✓</Meta>
      ) : (
        <span className="tab-summary-row__net flex gap-2">
          {balances.map(([currency, minor]) => (
            <Fact key={currency} size="sm" weight="bold" tone={minor > 0 ? "win" : "loss"}>
              {minor > 0 ? "+" : ""}
              {formatMoney(minor, currency)}
            </Fact>
          ))}
        </span>
      )}
    </Link>
  );
}
