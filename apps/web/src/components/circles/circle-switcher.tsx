"use client";

import Link from "next/link";
import { circleColorFor } from "@/lib/design";

/**
 * Compact multi-Circle switcher for the Circle and Tab nav tabs. Not in the
 * prototype (design/CUATRO-Prototype-LATEST.dc.html demos a single Circle,
 * "Tuesday Night Lot") — this app is multi-circle, so both tabs need a way
 * to jump between them. Follows the app's existing idioms rather than
 * inventing a new one: Circle colour discs (see circles/page.tsx's row
 * markers) for identity, a dashed coral "+" slot (components/ui/avatar.tsx's
 * DashedSlot convention) for "add one", and never coral for a Circle's own
 * identity — coral is reserved for actions (design/HANDOFF.md's colour
 * rule).
 */
export function CircleSwitcher({
  circles,
  activeCircleId,
  suffix = "",
}: {
  circles: { id: string; name: string; colour: string | null; emblem: string | null }[];
  activeCircleId: string;
  /** Appended to `/circles/{id}` — "" for the Circle tab, "/tab" for the Tab tab. */
  suffix?: string;
}) {
  if (circles.length <= 1) return null; // nothing to switch between

  return (
    <div className="flex items-center gap-2 overflow-x-auto -mx-5 px-5" role="tablist" aria-label="Switch Circle">
      {circles.map((c) => {
        const active = c.id === activeCircleId;
        return (
          <Link
            key={c.id}
            href={`/circles/${c.id}${suffix}`}
            role="tab"
            aria-selected={active}
            aria-label={c.name}
            className="shrink-0 flex items-center justify-center rounded-full font-extrabold text-white transition-cu-state"
            style={{
              width: 32,
              height: 32,
              fontSize: 12,
              background: c.colour ?? circleColorFor(c.id),
              opacity: active ? 1 : 0.5,
              boxShadow: active ? "0 0 0 2px var(--color-ink)" : "none",
            }}
          >
            {c.emblem ?? c.name.slice(0, 2).toUpperCase()}
          </Link>
        );
      })}
      <Link
        href="/circles/new"
        aria-label="Create a Circle"
        className="shrink-0 flex items-center justify-center rounded-full border-[1.5px] border-dashed border-action text-action font-extrabold"
        style={{ width: 32, height: 32, fontSize: 15 }}
      >
        +
      </Link>
      <Link
        href="/circles"
        className="shrink-0 rounded-chip border border-ink-hairline-3 text-ink-muted font-bold text-[11px] px-3 py-1.5 whitespace-nowrap transition-cu-state active:opacity-80"
      >
        All circles
      </Link>
    </div>
  );
}
