import Link from "next/link";
import type { WeekData } from "@/server/week";

/**
 * First-run "Your week" for a viewer in no Circle yet (design "Home · Your
 * week empty"): the empty NEXT 7 DAYS frame over three path cards. One solid
 * coral action for the whole screen — "Create" — everything else is an outline
 * (a circle-less user's single most valuable next step is getting into a
 * Circle, matching the phone home's empty state).
 */
export function WeekEmpty({ data }: { data: WeekData }) {
  return (
    <div>
      <h1 className="text-[29px] leading-none font-extrabold tracking-[-0.01em] text-ink">Your week</h1>
      <p className="text-[12.5px] text-ink-muted mt-1.5">let&apos;s get you on court</p>

      <div className="rounded-card bg-surface border border-ink-hairline-1 overflow-hidden mt-5">
        <div className="flex justify-between items-center px-[18px] py-3 bg-ink-hairline-1/60">
          <span className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-muted">NEXT 7 DAYS</span>
          <span className="text-[10px] font-mono text-ink-muted tabular-nums">{data.rangeLabel}</span>
        </div>
        <div className="px-[18px] py-8 text-center text-[12px] font-mono text-ink-muted/70">
          nothing yet. Your games will live here, one glance for the whole week
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3.5 mt-4">
        <div className="rounded-card bg-surface-feature border border-ink-hairline-2 p-[18px]">
          <p className="text-[14px] font-extrabold text-ink-on-feature">Start a Circle</p>
          <p className="text-[10.5px] leading-[1.6] font-mono text-ink-on-feature-muted mt-1.5">name it, pick a flag, share one link</p>
          <Link
            href="/circles/new"
            className="mt-3.5 block rounded-[11px] bg-action text-action-contrast text-center py-2.5 text-[12.5px] font-extrabold"
          >
            Create
          </Link>
        </div>
        <div className="rounded-card bg-surface border border-ink-hairline-1 p-[18px]">
          <p className="text-[14px] font-extrabold text-ink">Got an invite link?</p>
          <p className="text-[10.5px] leading-[1.6] font-mono text-ink-muted mt-1.5">open it, you&apos;re in before your first game</p>
          <Link
            href="/circles"
            className="mt-3.5 block rounded-[11px] border border-ink-hairline-4 text-ink text-center py-2.5 text-[12.5px] font-bold"
          >
            See how it works
          </Link>
        </div>
        <div className="rounded-card bg-surface border border-ink-hairline-1 p-[18px]">
          <p className="text-[14px] font-extrabold text-ink">Find a game nearby</p>
          <p className="text-[10.5px] leading-[1.6] font-mono text-ink-muted mt-1.5">public games around your patch</p>
          <Link
            href="/discover"
            className="mt-3.5 block rounded-[11px] border border-ink-hairline-4 text-ink text-center py-2.5 text-[12.5px] font-bold"
          >
            Discover
          </Link>
        </div>
      </div>
    </div>
  );
}
