import Link from "next/link";
import { Card } from "@/components/ui";

/**
 * The "Start your own Circle" card that closes the "Circles open to join" grid.
 * A quiet directory tile (no coral — starting a Circle is a calm, deliberate
 * act, and the page's coral budget belongs to the in-band games). Links to the
 * existing create flow; no new route.
 */
export function StartCircleCard() {
  return (
    <Link href="/circles/new" className="block h-full">
      <Card className="h-full flex flex-col items-center justify-center text-center gap-2 transition-cu-state active:opacity-80">
        <span
          aria-hidden
          className="rounded-[13px] flex items-center justify-center border border-ink-hairline-2 bg-ink-hairline-1 text-ink-muted text-[18px] font-semibold"
          style={{ width: 40, height: 40 }}
        >
          +
        </span>
        <p className="text-cu-card-title text-[13.5px] text-ink">Start your own Circle</p>
        <p className="text-cu-meta font-mono text-ink-muted leading-relaxed">
          name it, pick a flag,
          <br />
          share one link. Done
        </p>
      </Card>
    </Link>
  );
}
