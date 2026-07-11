import Link from "next/link";
import type { WeekTabPrompt } from "@/server/week";
import { formatMoneyWhole } from "@/components/tab/money";

/**
 * The Tab settle row on the wide "Your week" surface (design "Desktop · Your
 * week"): the single most-pressing "you owe" with a quiet Settle that links
 * into the circle's Tab. Settle is `strong` (bone), not coral — the coral on
 * this surface belongs to the needs-answer panel. Money renders whole-pounds
 * (formatMoneyWhole); amounts are amount_minor integers (CLAUDE.md #4).
 */
export function TabSettleCard({ prompt }: { prompt: WeekTabPrompt }) {
  return (
    <div className="rounded-card bg-surface border border-ink-hairline-1 p-4 flex items-center gap-2.5">
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-bold text-ink">
          The Tab · you owe {prompt.counterpartyName} <span className="font-mono tabular-nums">{formatMoneyWhole(prompt.amountMinor, prompt.currency)}</span>
        </p>
        {prompt.description && <p className="text-[10.5px] text-ink-muted mt-0.5">from {prompt.description}</p>}
      </div>
      <Link
        href={`/circles/${prompt.circleId}/tab`}
        className="rounded-chip bg-strong-bg text-strong-fg text-[11.5px] font-bold px-3.5 py-2 whitespace-nowrap"
      >
        Settle
      </Link>
    </div>
  );
}
